/**
 * /api/v1/* — REST surface for external clients (humans, scripts, bots).
 *
 * Auth: Bearer cm_<secret>. Capability + topic-scope checks per route.
 * Cross-mesh isolation: every endpoint scopes to apiKey.meshId — a key
 * for mesh A cannot read or write mesh B.
 *
 * Endpoints (v0.2.0 minimum):
 *   POST /v1/messages                       — send to a topic
 *   GET  /v1/topics                         — list topics in the key's mesh
 *   GET  /v1/topics/:name/messages          — fetch topic history (paginated)
 *   GET  /v1/topics/:name/stream            — SSE: live message firehose for a topic
 *   PATCH /v1/topics/:name/read             — mark a topic read up to now
 *   GET  /v1/peers                          — list peers in the mesh
 *
 * Live delivery: writes to mesh.message_queue + mesh.topic_message. The
 * broker's existing pendingTimer drains the queue and pushes to live
 * peers. The /stream endpoint server-side polls topic_message every
 * 2s and pushes new rows as SSE events — clients see new messages
 * within 2s without burning a poll-per-tab.
 *
 * Spec: .artifacts/specs/2026-05-02-v0.2.0-scope.md
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { db } from "@turbostarter/db/server";
import {
  mesh,
  meshApiKey,
  meshMember,
  meshNotification,
  meshTopic,
  meshTopicMember,
  meshTopicMemberKey,
  meshTopicMessage,
  messageQueue,
  presence,
} from "@turbostarter/db/schema/mesh";
import { aliasedTable, and, asc, count, desc, eq, gt, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";

import { validate } from "../../middleware";
import {
  enforceApiKey,
  requireCapability,
  requireTopicScope,
  type AuthedApiKey,
} from "./api-key-auth";

type Env = { Variables: { apiKey: AuthedApiKey } };

const sendMessageSchema = z.object({
  topic: z.string().min(1),
  /** base64-encoded ciphertext; client encrypts before sending. */
  ciphertext: z.string().min(1),
  /** base64 nonce. */
  nonce: z.string().min(1),
  priority: z.enum(["now", "next", "low"]).optional().default("next"),
  /**
   * Body format version. 1 = base64-of-plaintext (v0.2.0 placeholder),
   * 2 = crypto_secretbox under the topic's symmetric key (v0.3.0). The
   * server does not look inside ciphertext either way; this field
   * tells readers how to interpret it.
   */
  bodyVersion: z.literal(1).or(z.literal(2)).optional().default(1),
  /**
   * Optional list of `@<displayName>` mentions extracted client-side
   * from the plaintext. Capped at 16 to bound notification fan-out
   * (anti-spam). Server intersects with the mesh roster — anything
   * that doesn't resolve to a member is silently dropped.
   *
   * Falls back to a server-side regex on the base64 plaintext when
   * absent (v0.2.0 messages still ship plaintext). After per-topic
   * encryption lands the regex path stops working and the client
   * MUST send this array.
   */
  mentions: z.array(z.string().min(1).max(64)).max(16).optional(),
  /**
   * Optional id of a previous topic message this one replies to. Server
   * verifies the parent exists in the same topic; otherwise silently
   * drops the reference (treated as a top-level post).
   */
  replyToId: z.string().min(1).max(128).optional(),
});

/**
 * Extract `@<token>` mentions from base64-encoded plaintext. Returns
 * the lowercased display names found in the body, deduped and capped
 * at 16. Used as the legacy fallback when the client doesn't send a
 * `mentions` array on POST /messages.
 */
function extractMentionsFromBase64(b64: string): string[] {
  let text: string;
  try {
    text = Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return [];
  }
  const found = new Set<string>();
  const re = /(^|[^A-Za-z0-9_-])@([A-Za-z0-9_-]{1,64})(?=$|[^A-Za-z0-9_-])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    found.add(m[2]!.toLowerCase());
    if (found.size >= 16) break;
  }
  return [...found];
}

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  before: z.string().optional(),
});

export const v1Router = new Hono<Env>()
  .use(enforceApiKey)

  // POST /v1/messages — send to a topic
  .post("/messages", validate("json", sendMessageSchema), async (c) => {
    const key = c.var.apiKey;
    requireCapability(key, "send");

    const body = c.req.valid("json");
    requireTopicScope(key, body.topic);

    // Resolve topic by name within the key's mesh.
    const [topic] = await db
      .select({ id: meshTopic.id })
      .from(meshTopic)
      .where(
        and(
          eq(meshTopic.meshId, key.meshId),
          eq(meshTopic.name, body.topic),
          isNull(meshTopic.archivedAt),
        ),
      );
    if (!topic) {
      return c.json({ error: "topic_not_found", topic: body.topic }, 404);
    }

    // External keys aren't tied to a specific member. Use the mesh owner
    // as the sender placeholder so the FK on senderMemberId resolves.
    // (Future: introduce a synthetic "external" member per key.)
    const [meshRow] = await db
      .select({ ownerUserId: mesh.ownerUserId })
      .from(mesh)
      .where(eq(mesh.id, key.meshId));
    if (!meshRow) return c.json({ error: "mesh_not_found" }, 404);

    const [ownerMember] = await db
      .select({ id: meshMember.id })
      .from(meshMember)
      .where(
        and(eq(meshMember.meshId, key.meshId), isNull(meshMember.revokedAt)),
      )
      .orderBy(asc(meshMember.joinedAt))
      .limit(1);
    if (!ownerMember) return c.json({ error: "no_mesh_member" }, 500);

    // Sender attribution: prefer the apikey's issuing member (so the
    // dashboard chat user shows up correctly in /v1/peers and as the
    // notification sender). Fall back to the oldest mesh member for
    // legacy keys with no issuer.
    const senderMemberId = key.issuedByMemberId ?? ownerMember.id;

    // Validate replyToId belongs to the same topic before insert.
    let validatedReplyTo: string | null = null;
    if (body.replyToId) {
      const [parent] = await db
        .select({
          id: meshTopicMessage.id,
          topicId: meshTopicMessage.topicId,
        })
        .from(meshTopicMessage)
        .where(eq(meshTopicMessage.id, body.replyToId));
      if (parent && parent.topicId === topic.id) {
        validatedReplyTo = parent.id;
      }
    }

    // Persist to history (topic_message) + ephemeral queue (message_queue).
    // Broker's drain loop picks up the queue entry and pushes to live peers.
    const [historyRow] = await db
      .insert(meshTopicMessage)
      .values({
        topicId: topic.id,
        senderMemberId,
        nonce: body.nonce,
        ciphertext: body.ciphertext,
        bodyVersion: body.bodyVersion,
        replyToId: validatedReplyTo,
      })
      .returning({ id: meshTopicMessage.id });

    const [queueRow] = await db
      .insert(messageQueue)
      .values({
        meshId: key.meshId,
        senderMemberId,
        targetSpec: "#" + topic.id,
        priority: body.priority,
        nonce: body.nonce,
        ciphertext: body.ciphertext,
      })
      .returning({ id: messageQueue.id });

    // Mention fan-out → notification rows. Client-extracted mentions
    // win when present (v2 ciphertext clients MUST extract and send;
    // server can't read v2 bodies). v1 plaintext falls back to a regex
    // on the body so legacy senders don't lose mention notifications.
    let mentionTokens = body.mentions?.map((s) => s.toLowerCase().replace(/^@/, ""));
    if (
      (!mentionTokens || mentionTokens.length === 0) &&
      body.bodyVersion === 1
    ) {
      mentionTokens = extractMentionsFromBase64(body.ciphertext);
    }
    if (!mentionTokens) mentionTokens = [];
    let notifications = 0;
    if (historyRow && mentionTokens.length > 0) {
      const recipients = await db
        .select({
          id: meshMember.id,
          displayName: meshMember.displayName,
        })
        .from(meshMember)
        .where(
          and(eq(meshMember.meshId, key.meshId), isNull(meshMember.revokedAt)),
        );
      const lowerTokens = new Set(mentionTokens);
      const targets = recipients
        .filter(
          (r) =>
            lowerTokens.has(r.displayName.toLowerCase()) &&
            r.id !== senderMemberId,
        )
        .slice(0, 32); // hard cap on per-message fan-out
      if (targets.length > 0) {
        await db
          .insert(meshNotification)
          .values(
            targets.map((t) => ({
              meshId: key.meshId,
              topicId: topic.id,
              messageId: historyRow.id,
              recipientMemberId: t.id,
              senderMemberId,
              kind: "mention",
            })),
          )
          .onConflictDoNothing();
        notifications = targets.length;
      }
    }

    // For topic posts the durable identity is the topic_message row;
    // the message_queue row is ephemeral (drains on delivery). Return
    // historyRow.id as `messageId` so callers that paste the response
    // back into `--reply-to` actually find the parent in history.
    // `historyId` and `queueId` are kept as explicit aliases.
    return c.json({
      messageId: historyRow?.id ?? queueRow?.id ?? null,
      historyId: historyRow?.id ?? null,
      queueId: queueRow?.id ?? null,
      topic: body.topic,
      topicId: topic.id,
      notifications,
      bodyVersion: body.bodyVersion,
      ...(validatedReplyTo ? { replyToId: validatedReplyTo } : {}),
    });
  })

  // POST /v1/me/peer-pubkey — register the caller's persistent peer pubkey.
  //
  // Browser users get a throwaway ed25519 pubkey at mesh-create time
  // (no secret retained). To participate in v0.3.0 per-topic encryption
  // they must replace it with a pubkey whose secret they actually hold
  // (persisted in IndexedDB). This endpoint writes the new pubkey on the
  // mesh.member row identified by the apikey's issuer; the broker / CLI
  // re-seal loop then picks them up as a regular topic-key recipient
  // within ~30s.
  //
  // Idempotent: same pubkey → no-op; different pubkey → updates and
  // bumps `joined_at` so re-sealers notice the change. We do NOT
  // invalidate the existing sealed topic_member_key rows here —
  // they're keyed by member, not pubkey, and the next CLI re-seal pass
  // will overwrite them with copies sealed to the new pubkey.
  .post(
    "/me/peer-pubkey",
    validate(
      "json",
      z.object({
        pubkey: z
          .string()
          .length(64)
          .regex(/^[0-9a-f]{64}$/i, "must be 64 lowercase hex chars"),
      }),
    ),
    async (c) => {
      const key = c.var.apiKey;
      if (!key.issuedByMemberId) {
        return c.json({ error: "api_key_has_no_issuer" }, 400);
      }
      const body = c.req.valid("json");
      const newPubkey = body.pubkey.toLowerCase();
      const [existing] = await db
        .select({
          peerPubkey: meshMember.peerPubkey,
          dashboardUserId: meshMember.dashboardUserId,
        })
        .from(meshMember)
        .where(eq(meshMember.id, key.issuedByMemberId));
      if (!existing) {
        return c.json({ error: "member_not_found" }, 404);
      }
      // Safety: only web-managed members (dashboardUserId set) can have
      // their peer_pubkey rewritten via this endpoint. CLI-created
      // members hold a real on-disk secret that matches their existing
      // peer_pubkey; overwriting it would break their next WS hello
      // (signature verification fails because the stored pubkey no
      // longer matches the secret they sign with). The browser flow
      // always mints its apikey against the dashboard member, so this
      // restriction is invisible to legitimate callers.
      if (!existing.dashboardUserId) {
        return c.json(
          {
            error: "not_web_member",
            detail:
              "this endpoint only updates web-managed members (mesh.member.dashboard_user_id IS NOT NULL); CLI members own their on-disk keypair and can't have peer_pubkey rewritten remotely",
          },
          409,
        );
      }
      const changed = existing.peerPubkey !== newPubkey;
      if (changed) {
        await db
          .update(meshMember)
          .set({ peerPubkey: newPubkey })
          .where(eq(meshMember.id, key.issuedByMemberId));
      }
      return c.json({
        memberId: key.issuedByMemberId,
        pubkey: newPubkey,
        changed,
      });
    },
  )

  // GET /v1/me/workspace — cross-mesh overview for the caller's user.
  //
  // The first user-scoped (vs mesh-scoped) endpoint. Resolves the api
  // key's issuing member to a user_id, then aggregates over every
  // non-revoked member row that user holds across the system. Emits
  // one row per joined mesh with: peer count, online count, topic
  // count, unread @-mention count for that user.
  //
  // Auth model: any apikey whose issuer carries a non-null user_id
  // can call this. The caller is implicitly trusting the apikey
  // they're using, and this endpoint never reveals data outside that
  // user's own membership graph.
  //
  // Spec: .artifacts/specs/2026-05-02-workspace-view.md
  .get("/me/workspace", async (c) => {
    const key = c.var.apiKey;
    requireCapability(key, "read");
    if (!key.issuedByMemberId) {
      return c.json({ error: "api_key_has_no_issuer" }, 400);
    }

    // Resolve user_id from the issuing member.
    const [issuer] = await db
      .select({ userId: meshMember.userId })
      .from(meshMember)
      .where(eq(meshMember.id, key.issuedByMemberId));
    if (!issuer?.userId) {
      return c.json({ error: "issuer_member_has_no_user" }, 400);
    }

    // All meshes the user is a member of (any role, not revoked).
    const memberships = await db
      .select({
        memberId: meshMember.id,
        meshId: meshMember.meshId,
        meshSlug: mesh.slug,
        meshName: mesh.name,
        myRole: meshMember.role,
        joinedAt: meshMember.joinedAt,
      })
      .from(meshMember)
      .innerJoin(mesh, eq(mesh.id, meshMember.meshId))
      .where(
        and(
          eq(meshMember.userId, issuer.userId),
          isNull(meshMember.revokedAt),
          isNull(mesh.archivedAt),
        ),
      )
      .orderBy(asc(mesh.slug));

    if (memberships.length === 0) {
      return c.json({
        userId: issuer.userId,
        meshes: [],
        totals: { meshes: 0, peers: 0, online: 0, topics: 0, unreadMentions: 0 },
      });
    }

    const meshIds = memberships.map((m) => m.meshId);
    const myMemberIds = memberships.map((m) => m.memberId);

    // Per-mesh stats: peer count, topic count, online count.
    const peerCounts = await db
      .select({
        meshId: meshMember.meshId,
        peers: count(meshMember.id),
      })
      .from(meshMember)
      .where(
        and(inArray(meshMember.meshId, meshIds), isNull(meshMember.revokedAt)),
      )
      .groupBy(meshMember.meshId);

    const topicCounts = await db
      .select({
        meshId: meshTopic.meshId,
        topics: count(meshTopic.id),
      })
      .from(meshTopic)
      .where(
        and(inArray(meshTopic.meshId, meshIds), isNull(meshTopic.archivedAt)),
      )
      .groupBy(meshTopic.meshId);

    const onlineCounts = await db
      .select({
        meshId: meshMember.meshId,
        online: sql<number>`count(distinct ${presence.memberId})`,
      })
      .from(presence)
      .innerJoin(meshMember, eq(presence.memberId, meshMember.id))
      .where(
        and(
          inArray(meshMember.meshId, meshIds),
          isNull(meshMember.revokedAt),
          isNull(presence.disconnectedAt),
        ),
      )
      .groupBy(meshMember.meshId);

    // Per-mesh unread @-mentions for this user (mentions targeting
    // any of the user's member rows that haven't been read).
    const unreadMentions = await db
      .select({
        meshId: meshNotification.meshId,
        unread: count(meshNotification.id),
      })
      .from(meshNotification)
      .where(
        and(
          inArray(meshNotification.meshId, meshIds),
          inArray(meshNotification.recipientMemberId, myMemberIds),
          isNull(meshNotification.readAt),
        ),
      )
      .groupBy(meshNotification.meshId);

    const peersBy = new Map(peerCounts.map((r) => [r.meshId, Number(r.peers)]));
    const topicsBy = new Map(topicCounts.map((r) => [r.meshId, Number(r.topics)]));
    const onlineBy = new Map(onlineCounts.map((r) => [r.meshId, Number(r.online)]));
    const unreadBy = new Map(unreadMentions.map((r) => [r.meshId, Number(r.unread)]));

    const meshes = memberships.map((m) => ({
      meshId: m.meshId,
      slug: m.meshSlug,
      name: m.meshName,
      memberId: m.memberId,
      myRole: m.myRole,
      joinedAt: m.joinedAt.toISOString(),
      peers: peersBy.get(m.meshId) ?? 0,
      online: onlineBy.get(m.meshId) ?? 0,
      topics: topicsBy.get(m.meshId) ?? 0,
      unreadMentions: unreadBy.get(m.meshId) ?? 0,
    }));

    return c.json({
      userId: issuer.userId,
      meshes,
      totals: {
        meshes: meshes.length,
        peers: meshes.reduce((a, m) => a + m.peers, 0),
        online: meshes.reduce((a, m) => a + m.online, 0),
        topics: meshes.reduce((a, m) => a + m.topics, 0),
        unreadMentions: meshes.reduce((a, m) => a + m.unreadMentions, 0),
      },
    });
  })

  // GET /v1/me/notifications — cross-mesh @-mention feed.
  //
  // Returns recent unread notifications (default) or all notifications
  // (?include=all) targeting the caller's member rows across every
  // joined mesh. Each row carries mesh + topic + sender context plus a
  // 240-char ciphertext-base64 snippet (clients decrypt under the
  // topic key they already cached). 7-day window keeps the response
  // bounded; use ?since=<iso> to override.
  .get("/me/notifications", async (c) => {
    const key = c.var.apiKey;
    requireCapability(key, "read");
    if (!key.issuedByMemberId) {
      return c.json({ error: "api_key_has_no_issuer" }, 400);
    }
    const [issuer] = await db
      .select({ userId: meshMember.userId })
      .from(meshMember)
      .where(eq(meshMember.id, key.issuedByMemberId));
    if (!issuer?.userId) {
      return c.json({ error: "issuer_member_has_no_user" }, 400);
    }

    const memberships = await db
      .select({ memberId: meshMember.id })
      .from(meshMember)
      .innerJoin(mesh, eq(mesh.id, meshMember.meshId))
      .where(
        and(
          eq(meshMember.userId, issuer.userId),
          isNull(meshMember.revokedAt),
          isNull(mesh.archivedAt),
        ),
      );

    if (memberships.length === 0) {
      return c.json({
        notifications: [],
        totals: { unread: 0, total: 0 },
      });
    }

    const myMemberIds = memberships.map((m) => m.memberId);
    const includeAll = c.req.query("include") === "all";
    const sinceParam = c.req.query("since");
    const sinceDate = sinceParam
      ? new Date(sinceParam)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const senderMember = aliasedTable(meshMember, "sender_member");
    const where = and(
      inArray(meshNotification.recipientMemberId, myMemberIds),
      isNull(meshTopic.archivedAt),
      gt(meshTopicMessage.createdAt, sinceDate),
      ...(includeAll ? [] : [isNull(meshNotification.readAt)]),
    );

    const rows = await db
      .select({
        notificationId: meshNotification.id,
        messageId: meshTopicMessage.id,
        topicId: meshTopicMessage.topicId,
        topicName: meshTopic.name,
        meshId: meshTopic.meshId,
        meshSlug: mesh.slug,
        meshName: mesh.name,
        senderName: senderMember.displayName,
        senderMemberId: senderMember.id,
        ciphertext: meshTopicMessage.ciphertext,
        bodyVersion: meshTopicMessage.bodyVersion,
        readAt: meshNotification.readAt,
        createdAt: meshTopicMessage.createdAt,
      })
      .from(meshNotification)
      .innerJoin(
        meshTopicMessage,
        eq(meshTopicMessage.id, meshNotification.messageId),
      )
      .innerJoin(meshTopic, eq(meshTopic.id, meshNotification.topicId))
      .innerJoin(mesh, eq(mesh.id, meshTopic.meshId))
      .innerJoin(
        senderMember,
        eq(senderMember.id, meshNotification.senderMemberId),
      )
      .where(where)
      .orderBy(desc(meshTopicMessage.createdAt))
      .limit(100);

    const decode = (b64: string) => {
      try {
        return Buffer.from(b64, "base64").toString("utf-8");
      } catch {
        return "";
      }
    };

    const notifications = rows.map((r) => ({
      notificationId: r.notificationId,
      messageId: r.messageId,
      topicId: r.topicId,
      topicName: r.topicName,
      meshId: r.meshId,
      meshSlug: r.meshSlug,
      meshName: r.meshName,
      senderName: r.senderName,
      // For v1 (plaintext-base64) messages, surface a decoded snippet so
      // CLI/dashboard can render it without doing crypto. v2 messages
      // ship ciphertext only — the client decrypts with the topic key.
      snippet:
        r.bodyVersion === 1 ? decode(r.ciphertext).slice(0, 240) : null,
      ciphertext: r.bodyVersion === 2 ? r.ciphertext : null,
      bodyVersion: r.bodyVersion,
      read: !!r.readAt,
      readAt: r.readAt ? r.readAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));

    const unreadCount = notifications.filter((n) => !n.read).length;

    return c.json({
      notifications,
      totals: {
        unread: unreadCount,
        total: notifications.length,
      },
    });
  })

  // GET /v1/me/topics — cross-mesh topic list for the caller's user.
  //
  // For each topic across every mesh the user belongs to, returns
  // mesh context + unread count (vs that user's `topic_member.last_read_at`
  // in that mesh) + last-message timestamp. Sorted by lastMessageAt
  // desc so the most-active topics surface first — the natural "what
  // should I read" view.
  .get("/me/topics", async (c) => {
    const key = c.var.apiKey;
    requireCapability(key, "read");
    if (!key.issuedByMemberId) {
      return c.json({ error: "api_key_has_no_issuer" }, 400);
    }
    const [issuer] = await db
      .select({ userId: meshMember.userId })
      .from(meshMember)
      .where(eq(meshMember.id, key.issuedByMemberId));
    if (!issuer?.userId) {
      return c.json({ error: "issuer_member_has_no_user" }, 400);
    }

    const memberships = await db
      .select({
        memberId: meshMember.id,
        meshId: meshMember.meshId,
        meshSlug: mesh.slug,
        meshName: mesh.name,
      })
      .from(meshMember)
      .innerJoin(mesh, eq(mesh.id, meshMember.meshId))
      .where(
        and(
          eq(meshMember.userId, issuer.userId),
          isNull(meshMember.revokedAt),
          isNull(mesh.archivedAt),
        ),
      );

    if (memberships.length === 0) {
      return c.json({ topics: [], totals: { topics: 0, unread: 0 } });
    }

    const meshIds = memberships.map((m) => m.meshId);
    const memberByMeshId = new Map(memberships.map((m) => [m.meshId, m]));

    const topics = await db
      .select({
        id: meshTopic.id,
        meshId: meshTopic.meshId,
        name: meshTopic.name,
        description: meshTopic.description,
        visibility: meshTopic.visibility,
        createdAt: meshTopic.createdAt,
      })
      .from(meshTopic)
      .where(
        and(inArray(meshTopic.meshId, meshIds), isNull(meshTopic.archivedAt)),
      )
      .orderBy(asc(meshTopic.name));

    if (topics.length === 0) {
      return c.json({ topics: [], totals: { topics: 0, unread: 0 } });
    }

    const topicIds = topics.map((t) => t.id);
    const myMemberIds = memberships.map((m) => m.memberId);

    // Last message timestamp per topic.
    const lastMessages = await db
      .select({
        topicId: meshTopicMessage.topicId,
        lastAt: sql<Date>`max(${meshTopicMessage.createdAt})`,
      })
      .from(meshTopicMessage)
      .where(inArray(meshTopicMessage.topicId, topicIds))
      .groupBy(meshTopicMessage.topicId);
    const lastByTopic = new Map(
      lastMessages.map((r) => [r.topicId, r.lastAt]),
    );

    // Unread count per topic — compares topic_message.created_at against
    // the user's own member row's last_read_at in that mesh's topic.
    // A message authored by the user themselves doesn't count as unread.
    const unreadCounts = await db
      .select({
        topicId: meshTopicMessage.topicId,
        unread: count(meshTopicMessage.id),
      })
      .from(meshTopicMessage)
      .leftJoin(
        meshTopicMember,
        and(
          eq(meshTopicMember.topicId, meshTopicMessage.topicId),
          inArray(meshTopicMember.memberId, myMemberIds),
        ),
      )
      .where(
        and(
          inArray(meshTopicMessage.topicId, topicIds),
          sql`${meshTopicMessage.createdAt} > COALESCE(${meshTopicMember.lastReadAt}, '1970-01-01'::timestamp)`,
          notInArray(meshTopicMessage.senderMemberId, myMemberIds),
        ),
      )
      .groupBy(meshTopicMessage.topicId);
    const unreadByTopic = new Map(
      unreadCounts.map((r) => [r.topicId, Number(r.unread)]),
    );

    const items = topics.map((t) => {
      const m = memberByMeshId.get(t.meshId)!;
      const lastAt = lastByTopic.get(t.id);
      return {
        topicId: t.id,
        name: t.name,
        description: t.description,
        visibility: t.visibility,
        createdAt: t.createdAt.toISOString(),
        meshId: t.meshId,
        meshSlug: m.meshSlug,
        meshName: m.meshName,
        memberId: m.memberId,
        unread: unreadByTopic.get(t.id) ?? 0,
        lastMessageAt: lastAt ? new Date(lastAt).toISOString() : null,
      };
    });

    // Sort by lastMessageAt desc, with never-posted topics last (alphabetical).
    items.sort((a, b) => {
      if (a.lastMessageAt && b.lastMessageAt) {
        return b.lastMessageAt.localeCompare(a.lastMessageAt);
      }
      if (a.lastMessageAt) return -1;
      if (b.lastMessageAt) return 1;
      return a.name.localeCompare(b.name);
    });

    return c.json({
      topics: items,
      totals: {
        topics: items.length,
        unread: items.reduce((a, t) => a + t.unread, 0),
      },
    });
  })

  // GET /v1/topics — list topics in the key's mesh
  // Includes per-topic unread counts when the key has an issuing member
  // (i.e. dashboard keys; CLI-minted keys also carry it). Counts are
  // computed against topic_member.last_read_at; if no membership row
  // exists for this member, the topic counts as 0 unread (member is
  // not subscribed — surfacing the topic without nagging them).
  .get("/topics", async (c) => {
    const key = c.var.apiKey;
    requireCapability(key, "read");
    const rows = await db
      .select({
        id: meshTopic.id,
        name: meshTopic.name,
        description: meshTopic.description,
        visibility: meshTopic.visibility,
        createdAt: meshTopic.createdAt,
      })
      .from(meshTopic)
      .where(and(eq(meshTopic.meshId, key.meshId), isNull(meshTopic.archivedAt)))
      .orderBy(asc(meshTopic.name));
    const filtered = key.topicScopes
      ? rows.filter((r) => key.topicScopes!.includes(r.name))
      : rows;

    // Build an unread-count map keyed by topic id. Only meaningful when
    // we know whose last_read_at to compare against.
    const unreadByTopic = new Map<string, number>();
    if (key.issuedByMemberId && filtered.length > 0) {
      const topicIds = filtered.map((t) => t.id);
      const counts = await db
        .select({
          topicId: meshTopicMessage.topicId,
          unread: count(meshTopicMessage.id),
        })
        .from(meshTopicMessage)
        .leftJoin(
          meshTopicMember,
          and(
            eq(meshTopicMember.topicId, meshTopicMessage.topicId),
            eq(meshTopicMember.memberId, key.issuedByMemberId),
          ),
        )
        .where(
          and(
            inArray(meshTopicMessage.topicId, topicIds),
            sql`${meshTopicMessage.createdAt} > COALESCE(${meshTopicMember.lastReadAt}, '1970-01-01'::timestamp)`,
            sql`${meshTopicMessage.senderMemberId} <> ${key.issuedByMemberId}`,
          ),
        )
        .groupBy(meshTopicMessage.topicId);
      for (const row of counts) {
        unreadByTopic.set(row.topicId, Number(row.unread));
      }
    }

    return c.json({
      topics: filtered.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        visibility: t.visibility,
        createdAt: t.createdAt.toISOString(),
        unread: unreadByTopic.get(t.id) ?? 0,
      })),
    });
  })

  // PATCH /v1/topics/:name/read — mark a topic read up to now for the
  // member that issued this api key. Upserts topic_member if no row
  // exists yet (e.g. dashboard owner who joined the mesh before #general
  // existed and hadn't been auto-subscribed). No-op if the api key has
  // no issuing member (legacy keys without issuedByMemberId).
  .patch("/topics/:name/read", async (c) => {
    const key = c.var.apiKey;
    requireCapability(key, "read");
    const name = c.req.param("name");
    requireTopicScope(key, name);

    if (!key.issuedByMemberId) {
      return c.json({ error: "api_key_has_no_issuer" }, 400);
    }

    const [topic] = await db
      .select({ id: meshTopic.id })
      .from(meshTopic)
      .where(
        and(
          eq(meshTopic.meshId, key.meshId),
          eq(meshTopic.name, name),
          isNull(meshTopic.archivedAt),
        ),
      );
    if (!topic) {
      return c.json({ error: "topic_not_found", topic: name }, 404);
    }

    const now = new Date();
    await db
      .insert(meshTopicMember)
      .values({
        topicId: topic.id,
        memberId: key.issuedByMemberId,
        lastReadAt: now,
      })
      .onConflictDoUpdate({
        target: [meshTopicMember.topicId, meshTopicMember.memberId],
        set: { lastReadAt: now },
      });

    return c.json({
      topic: name,
      topicId: topic.id,
      readAt: now.toISOString(),
    });
  })

  // GET /v1/topics/:name/messages?limit=50&before=<id>
  .get(
    "/topics/:name/messages",
    validate("query", historyQuerySchema),
    async (c) => {
      const key = c.var.apiKey;
      requireCapability(key, "read");
      const name = c.req.param("name");
      requireTopicScope(key, name);

      const [topic] = await db
        .select({ id: meshTopic.id })
        .from(meshTopic)
        .where(
          and(
            eq(meshTopic.meshId, key.meshId),
            eq(meshTopic.name, name),
            isNull(meshTopic.archivedAt),
          ),
        );
      if (!topic) {
        return c.json({ error: "topic_not_found", topic: name }, 404);
      }

      const { limit, before } = c.req.valid("query");
      let beforeAt: Date | null = null;
      if (before) {
        const [b] = await db
          .select({ createdAt: meshTopicMessage.createdAt })
          .from(meshTopicMessage)
          .where(eq(meshTopicMessage.id, before));
        beforeAt = b?.createdAt ?? null;
      }

      const rows = await db
        .select({
          id: meshTopicMessage.id,
          senderMemberId: meshTopicMessage.senderMemberId,
          senderPubkey: meshMember.peerPubkey,
          senderName: meshMember.displayName,
          nonce: meshTopicMessage.nonce,
          ciphertext: meshTopicMessage.ciphertext,
          bodyVersion: meshTopicMessage.bodyVersion,
          replyToId: meshTopicMessage.replyToId,
          createdAt: meshTopicMessage.createdAt,
        })
        .from(meshTopicMessage)
        .innerJoin(
          meshMember,
          eq(meshTopicMessage.senderMemberId, meshMember.id),
        )
        .where(
          beforeAt
            ? and(
                eq(meshTopicMessage.topicId, topic.id),
                lt(meshTopicMessage.createdAt, beforeAt),
              )
            : eq(meshTopicMessage.topicId, topic.id),
        )
        .orderBy(desc(meshTopicMessage.createdAt))
        .limit(limit);

      return c.json({
        topic: name,
        topicId: topic.id,
        messages: rows.map((r) => ({
          id: r.id,
          senderMemberId: r.senderMemberId,
          senderPubkey: r.senderPubkey,
          senderName: r.senderName,
          nonce: r.nonce,
          ciphertext: r.ciphertext,
          bodyVersion: r.bodyVersion,
          replyToId: r.replyToId,
          createdAt: r.createdAt.toISOString(),
        })),
      });
    },
  )

  // GET /v1/topics/:name/stream — live SSE firehose for a topic.
  //
  // Server-side polls mesh.topic_message every STREAM_POLL_MS for rows
  // newer than the last seen createdAt and pushes each as an SSE
  // `message` event. First connection sample establishes the watermark
  // (no historical replay — clients fetch /messages for that). The
  // stream ends when the client disconnects or the topic is archived.
  //
  // Heartbeats every 30s as SSE comments (`:keep-alive`) keep the
  // connection through proxies that drop idle TCP. Postgres LISTEN/
  // NOTIFY is the obvious upgrade path when message volume grows; the
  // poll loop here is fine for v0.2.0's low write rate.
  .get("/topics/:name/stream", async (c) => {
    const key = c.var.apiKey;
    requireCapability(key, "read");
    const name = c.req.param("name");
    requireTopicScope(key, name);

    const [topic] = await db
      .select({ id: meshTopic.id })
      .from(meshTopic)
      .where(
        and(
          eq(meshTopic.meshId, key.meshId),
          eq(meshTopic.name, name),
          isNull(meshTopic.archivedAt),
        ),
      );
    if (!topic) {
      return c.json({ error: "topic_not_found", topic: name }, 404);
    }

    const STREAM_POLL_MS = 2000;
    const HEARTBEAT_MS = 30_000;

    return streamSSE(c, async (stream) => {
      // Watermark: skip messages older than connect time so we don't
      // replay history. Clients backfill via GET /messages.
      let cursor = new Date();
      let lastHeartbeat = Date.now();
      let aborted = false;

      stream.onAbort(() => {
        aborted = true;
      });

      // Initial hello so clients know the stream is alive.
      await stream.writeSSE({
        event: "ready",
        data: JSON.stringify({
          topic: name,
          topicId: topic.id,
          connectedAt: cursor.toISOString(),
        }),
      });

      while (!aborted) {
        try {
          const rows = await db
            .select({
              id: meshTopicMessage.id,
              senderMemberId: meshTopicMessage.senderMemberId,
              senderPubkey: meshMember.peerPubkey,
              senderName: meshMember.displayName,
              nonce: meshTopicMessage.nonce,
              ciphertext: meshTopicMessage.ciphertext,
              bodyVersion: meshTopicMessage.bodyVersion,
              replyToId: meshTopicMessage.replyToId,
              createdAt: meshTopicMessage.createdAt,
            })
            .from(meshTopicMessage)
            .innerJoin(
              meshMember,
              eq(meshTopicMessage.senderMemberId, meshMember.id),
            )
            .where(
              and(
                eq(meshTopicMessage.topicId, topic.id),
                gt(meshTopicMessage.createdAt, cursor),
              ),
            )
            .orderBy(asc(meshTopicMessage.createdAt))
            .limit(100);

          for (const r of rows) {
            await stream.writeSSE({
              event: "message",
              id: r.id,
              data: JSON.stringify({
                id: r.id,
                senderMemberId: r.senderMemberId,
                senderPubkey: r.senderPubkey,
                senderName: r.senderName,
                nonce: r.nonce,
                ciphertext: r.ciphertext,
                bodyVersion: r.bodyVersion,
                replyToId: r.replyToId,
                createdAt: r.createdAt.toISOString(),
              }),
            });
            if (r.createdAt > cursor) cursor = r.createdAt;
          }

          if (Date.now() - lastHeartbeat > HEARTBEAT_MS) {
            await stream.writeSSE({ event: "heartbeat", data: String(Date.now()) });
            lastHeartbeat = Date.now();
          }
        } catch (e) {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({
              error: e instanceof Error ? e.message : String(e),
            }),
          });
        }
        await stream.sleep(STREAM_POLL_MS);
      }
    });
  })

  // GET /v1/members — every (non-revoked) member of the key's mesh,
  // decorated with online status from presence. Unlike /v1/peers this
  // includes humans/agents that haven't opened a WS session yet —
  // useful for Discord-style member sidebars where roster matters more
  // than live activity.
  .get("/members", async (c) => {
    const key = c.var.apiKey;
    requireCapability(key, "read");
    const rows = await db
      .select({
        memberId: meshMember.id,
        pubkey: meshMember.peerPubkey,
        displayName: meshMember.displayName,
        role: meshMember.role,
        joinedAt: meshMember.joinedAt,
        userId: meshMember.userId,
      })
      .from(meshMember)
      .where(
        and(eq(meshMember.meshId, key.meshId), isNull(meshMember.revokedAt)),
      )
      .orderBy(asc(meshMember.joinedAt));
    const onlineRows = await db
      .select({
        memberId: presence.memberId,
        status: presence.status,
        summary: presence.summary,
      })
      .from(presence)
      .innerJoin(meshMember, eq(presence.memberId, meshMember.id))
      .where(
        and(eq(meshMember.meshId, key.meshId), isNull(presence.disconnectedAt)),
      )
      .orderBy(desc(presence.connectedAt));
    const onlineByMember = new Map<
      string,
      { status: string; summary: string | null }
    >();
    for (const r of onlineRows) {
      if (onlineByMember.has(r.memberId)) continue;
      onlineByMember.set(r.memberId, {
        status: r.status,
        summary: r.summary,
      });
    }
    return c.json({
      members: rows.map((r) => {
        const live = onlineByMember.get(r.memberId);
        return {
          memberId: r.memberId,
          pubkey: r.pubkey,
          displayName: r.displayName,
          role: r.role,
          isHuman: r.userId !== null,
          joinedAt: r.joinedAt.toISOString(),
          online: !!live,
          status: live?.status ?? "offline",
          summary: live?.summary ?? null,
        };
      }),
    });
  })

  // GET /v1/topics/:name/key — fetch the calling member's sealed copy
  // of the topic's symmetric key. v0.3.0 phase 2.
  //
  // The broker stores `crypto_box(topic_key, recipient_x25519,
  // ephemeral_sender_x25519)` per (topic, member). Clients decrypt with
  // their ed25519→x25519-converted secret + the topic's ephemeral
  // sender pubkey on `topic.encrypted_key_pubkey`.
  //
  // Returns 404 when no sealed copy exists for this member yet —
  // expected when the member joined a topic after creation and no
  // other peer has re-sealed the key for them. UI surfaces a "pending
  // — waiting for re-seal from another member" state in that case.
  // Spec for the re-seal flow lives at
  // `.artifacts/specs/2026-05-02-topic-key-onboarding.md`.
  .get("/topics/:name/key", async (c) => {
    const key = c.var.apiKey;
    requireCapability(key, "read");
    const name = c.req.param("name");
    requireTopicScope(key, name);

    if (!key.issuedByMemberId) {
      return c.json({ error: "api_key_has_no_issuer" }, 400);
    }

    const [topic] = await db
      .select({
        id: meshTopic.id,
        encryptedKeyPubkey: meshTopic.encryptedKeyPubkey,
      })
      .from(meshTopic)
      .where(
        and(
          eq(meshTopic.meshId, key.meshId),
          eq(meshTopic.name, name),
          isNull(meshTopic.archivedAt),
        ),
      );
    if (!topic) {
      return c.json({ error: "topic_not_found", topic: name }, 404);
    }
    if (!topic.encryptedKeyPubkey) {
      return c.json(
        {
          error: "topic_unencrypted",
          topic: name,
          hint: "legacy v0.2.0 topic — messages are base64 plaintext",
        },
        409,
      );
    }

    const [sealed] = await db
      .select({
        encryptedKey: meshTopicMemberKey.encryptedKey,
        nonce: meshTopicMemberKey.nonce,
        createdAt: meshTopicMemberKey.createdAt,
      })
      .from(meshTopicMemberKey)
      .where(
        and(
          eq(meshTopicMemberKey.topicId, topic.id),
          eq(meshTopicMemberKey.memberId, key.issuedByMemberId),
        ),
      );
    if (!sealed) {
      return c.json(
        {
          error: "key_not_sealed_for_member",
          topic: name,
          hint: "join the topic, then ask an existing member to re-seal",
        },
        404,
      );
    }

    return c.json({
      topic: name,
      topicId: topic.id,
      encryptedKey: sealed.encryptedKey,
      nonce: sealed.nonce,
      senderPubkey: topic.encryptedKeyPubkey,
      createdAt: sealed.createdAt.toISOString(),
    });
  })

  // POST /v1/topics/:name/claim-key — bootstrap encryption on a v1 topic.
  //
  // Used by the dashboard's first encryption-aware client to convert a
  // legacy plaintext topic into v0.3.0 ciphertext. The browser:
  //   1. Generates a fresh 32-byte topic key.
  //   2. Seals it for itself via crypto_box (its IndexedDB-held secret).
  //   3. POSTs encryptedKeyPubkey + encryptedKey + nonce here.
  //
  // The endpoint is *atomic*: the UPDATE only succeeds when the topic
  // currently has no encryption key. If a different client claimed
  // first (race), this returns 409 + the existing senderPubkey so the
  // loser can fall back to the regular fetch-and-decrypt path.
  //
  // Subsequent peers (CLI re-seal loop, browser-side re-seal in a future
  // patch) seal the same topic key for new joiners — they don't go
  // through this endpoint.
  .post(
    "/topics/:name/claim-key",
    validate(
      "json",
      z.object({
        encryptedKeyPubkey: z
          .string()
          .length(64)
          .regex(/^[0-9a-f]{64}$/i, "must be 64 lowercase hex chars"),
        encryptedKey: z.string().min(1).max(4096),
        nonce: z.string().min(1).max(64),
      }),
    ),
    async (c) => {
      const key = c.var.apiKey;
      requireCapability(key, "send");
      const name = c.req.param("name");
      requireTopicScope(key, name);

      if (!key.issuedByMemberId) {
        return c.json({ error: "api_key_has_no_issuer" }, 400);
      }
      const body = c.req.valid("json");
      const newSenderPubkey = body.encryptedKeyPubkey.toLowerCase();

      const [topic] = await db
        .select({
          id: meshTopic.id,
          encryptedKeyPubkey: meshTopic.encryptedKeyPubkey,
        })
        .from(meshTopic)
        .where(
          and(
            eq(meshTopic.meshId, key.meshId),
            eq(meshTopic.name, name),
            isNull(meshTopic.archivedAt),
          ),
        );
      if (!topic) {
        return c.json({ error: "topic_not_found", topic: name }, 404);
      }
      if (topic.encryptedKeyPubkey) {
        return c.json(
          {
            error: "already_encrypted",
            topic: name,
            senderPubkey: topic.encryptedKeyPubkey,
            hint: "another peer claimed first — fetch /key to receive your sealed copy (re-seal pending)",
          },
          409,
        );
      }

      // Atomic claim: only set encryptedKeyPubkey if it's still NULL.
      // Postgres UPDATE ... WHERE encrypted_key_pubkey IS NULL returns
      // 0 rows on race, which we surface as 409.
      const updated = await db
        .update(meshTopic)
        .set({ encryptedKeyPubkey: newSenderPubkey })
        .where(
          and(
            eq(meshTopic.id, topic.id),
            isNull(meshTopic.encryptedKeyPubkey),
          ),
        )
        .returning({ id: meshTopic.id });
      if (updated.length === 0) {
        // Race lost — re-read so the client gets the winning sender pubkey.
        const [latest] = await db
          .select({ encryptedKeyPubkey: meshTopic.encryptedKeyPubkey })
          .from(meshTopic)
          .where(eq(meshTopic.id, topic.id));
        return c.json(
          {
            error: "already_encrypted",
            topic: name,
            senderPubkey: latest?.encryptedKeyPubkey ?? null,
          },
          409,
        );
      }

      // Persist the caller's sealed copy. Idempotent on (topic, member).
      await db
        .insert(meshTopicMemberKey)
        .values({
          topicId: topic.id,
          memberId: key.issuedByMemberId,
          encryptedKey: body.encryptedKey,
          nonce: body.nonce,
        })
        .onConflictDoUpdate({
          target: [meshTopicMemberKey.topicId, meshTopicMemberKey.memberId],
          set: {
            encryptedKey: body.encryptedKey,
            nonce: body.nonce,
            rotatedAt: new Date(),
          },
        });

      return c.json({
        topic: name,
        topicId: topic.id,
        senderPubkey: newSenderPubkey,
        memberId: key.issuedByMemberId,
        claimed: true,
      });
    },
  )

  // GET /v1/topics/:name/pending-seals — list topic members that don't
  // yet have a sealed copy of the topic key. Members who hold the key
  // poll this and re-seal for any pending recipient via POST /seal.
  //
  // Returns roster format so the caller can do the crypto:
  //   { pending: [{ memberId, pubkey, displayName }] }
  //
  // Caps at 50 — if more are pending the next poll picks up the rest.
  // Anyone with read capability + topic scope can list (any holder can
  // re-seal; the trust model accepts that).
  .get("/topics/:name/pending-seals", async (c) => {
    const key = c.var.apiKey;
    requireCapability(key, "read");
    const name = c.req.param("name");
    requireTopicScope(key, name);

    const [topic] = await db
      .select({
        id: meshTopic.id,
        encryptedKeyPubkey: meshTopic.encryptedKeyPubkey,
      })
      .from(meshTopic)
      .where(
        and(
          eq(meshTopic.meshId, key.meshId),
          eq(meshTopic.name, name),
          isNull(meshTopic.archivedAt),
        ),
      );
    if (!topic) {
      return c.json({ error: "topic_not_found", topic: name }, 404);
    }
    if (!topic.encryptedKeyPubkey) {
      return c.json({ pending: [], senderPubkey: null });
    }

    // Member is "pending" iff joined the topic but has no key row yet.
    // LEFT JOIN topic_member_key on the same (topic, member) pair —
    // NULL = pending.
    const rows = await db
      .select({
        memberId: meshTopicMember.memberId,
        pubkey: meshMember.peerPubkey,
        displayName: meshMember.displayName,
      })
      .from(meshTopicMember)
      .innerJoin(meshMember, eq(meshMember.id, meshTopicMember.memberId))
      .leftJoin(
        meshTopicMemberKey,
        and(
          eq(meshTopicMemberKey.topicId, meshTopicMember.topicId),
          eq(meshTopicMemberKey.memberId, meshTopicMember.memberId),
        ),
      )
      .where(
        and(
          eq(meshTopicMember.topicId, topic.id),
          isNull(meshMember.revokedAt),
          isNull(meshTopicMemberKey.id),
        ),
      )
      .limit(50);

    return c.json({
      topic: name,
      topicId: topic.id,
      senderPubkey: topic.encryptedKeyPubkey,
      pending: rows,
    });
  })

  // POST /v1/topics/:name/seal — submit a re-sealed copy of the topic
  // key for a specific member. Body: {memberId, encryptedKey, nonce}.
  // Idempotent on (topicId, memberId) — re-submitting overwrites.
  //
  // The CALLER must already hold the topic key (otherwise their seal
  // would be garbage). Server can't verify that at submission time —
  // the joiner verifies on first decrypt by attempting crypto_box_open
  // and discarding the row if it fails. Bad seals waste a round-trip
  // but can't break the security model.
  .post(
    "/topics/:name/seal",
    validate(
      "json",
      z.object({
        memberId: z.string().min(1),
        encryptedKey: z.string().min(1),
        nonce: z.string().min(1),
      }),
    ),
    async (c) => {
      const key = c.var.apiKey;
      requireCapability(key, "send");
      const name = c.req.param("name");
      requireTopicScope(key, name);

      const body = c.req.valid("json");

      const [topic] = await db
        .select({
          id: meshTopic.id,
          encryptedKeyPubkey: meshTopic.encryptedKeyPubkey,
        })
        .from(meshTopic)
        .where(
          and(
            eq(meshTopic.meshId, key.meshId),
            eq(meshTopic.name, name),
            isNull(meshTopic.archivedAt),
          ),
        );
      if (!topic) {
        return c.json({ error: "topic_not_found", topic: name }, 404);
      }
      if (!topic.encryptedKeyPubkey) {
        return c.json(
          {
            error: "topic_unencrypted",
            topic: name,
            hint: "legacy v0.2.0 topic — no key to seal",
          },
          409,
        );
      }

      // Recipient must be a non-revoked member of the same mesh AND
      // already a topic_member (joined the topic). Otherwise we'd let
      // anyone seal for any member, which the joiner would then accept
      // on first GET /key — that's a denial-of-content vector.
      const [recipient] = await db
        .select({ id: meshMember.id })
        .from(meshTopicMember)
        .innerJoin(meshMember, eq(meshMember.id, meshTopicMember.memberId))
        .where(
          and(
            eq(meshTopicMember.topicId, topic.id),
            eq(meshMember.id, body.memberId),
            eq(meshMember.meshId, key.meshId),
            isNull(meshMember.revokedAt),
          ),
        );
      if (!recipient) {
        return c.json({ error: "recipient_not_in_topic" }, 404);
      }

      const now = new Date();
      await db
        .insert(meshTopicMemberKey)
        .values({
          topicId: topic.id,
          memberId: body.memberId,
          encryptedKey: body.encryptedKey,
          nonce: body.nonce,
        })
        .onConflictDoUpdate({
          target: [meshTopicMemberKey.topicId, meshTopicMemberKey.memberId],
          set: {
            encryptedKey: body.encryptedKey,
            nonce: body.nonce,
            rotatedAt: now,
          },
        });

      return c.json({
        topic: name,
        topicId: topic.id,
        memberId: body.memberId,
        sealedAt: now.toISOString(),
      });
    },
  )

  // GET /v1/notifications — recent @-mentions of the viewer across
  // all topics in the key's mesh. Reads from mesh.notification, which
  // is populated at write time by POST /v1/messages and the broker's
  // topic-send handler. Survives the v0.3.0 per-topic encryption cut
  // (the regex-on-decoded-ciphertext approach won't).
  //
  // Query: ?since=<ISO> for incremental fetch (polling bells), and
  // ?unread=1 to filter to read_at IS NULL only.
  .get("/notifications", async (c) => {
    const key = c.var.apiKey;
    requireCapability(key, "read");
    if (!key.issuedByMemberId) {
      return c.json({ notifications: [] });
    }

    const [me] = await db
      .select({ displayName: meshMember.displayName })
      .from(meshMember)
      .where(eq(meshMember.id, key.issuedByMemberId));
    if (!me) return c.json({ notifications: [] });

    const sinceParam = c.req.query("since");
    const since = sinceParam
      ? new Date(sinceParam)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (Number.isNaN(since.getTime())) {
      return c.json({ error: "invalid_since" }, 400);
    }
    const unreadOnly = c.req.query("unread") === "1";

    const conditions = [
      eq(meshNotification.recipientMemberId, key.issuedByMemberId),
      eq(meshNotification.meshId, key.meshId),
      gt(meshNotification.createdAt, since),
    ];
    if (unreadOnly) conditions.push(isNull(meshNotification.readAt));

    const rows = await db
      .select({
        id: meshTopicMessage.id,
        notificationId: meshNotification.id,
        topicId: meshTopicMessage.topicId,
        topicName: meshTopic.name,
        senderMemberId: meshTopicMessage.senderMemberId,
        senderName: meshMember.displayName,
        senderPubkey: meshMember.peerPubkey,
        ciphertext: meshTopicMessage.ciphertext,
        kind: meshNotification.kind,
        readAt: meshNotification.readAt,
        createdAt: meshTopicMessage.createdAt,
      })
      .from(meshNotification)
      .innerJoin(
        meshTopicMessage,
        eq(meshTopicMessage.id, meshNotification.messageId),
      )
      .innerJoin(meshTopic, eq(meshTopic.id, meshNotification.topicId))
      .innerJoin(
        meshMember,
        eq(meshMember.id, meshNotification.senderMemberId),
      )
      .where(and(...conditions))
      .orderBy(desc(meshTopicMessage.createdAt))
      .limit(50);

    return c.json({
      notifications: rows.map((r) => ({
        id: r.id,
        notificationId: r.notificationId,
        topicId: r.topicId,
        topicName: r.topicName,
        senderName: r.senderName,
        senderPubkey: r.senderPubkey,
        ciphertext: r.ciphertext,
        kind: r.kind,
        readAt: r.readAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      since: since.toISOString(),
      mentionedAs: me.displayName,
    });
  })

  // POST /v1/notifications/read — mark notifications read. Body shape:
  //   { ids: string[] }                — mark these notification ids
  //   { all: true, before?: ISO }      — mark every unread for this
  //                                      member up to `before` (or now)
  // Idempotent. Always 200, even if 0 rows updated.
  .post(
    "/notifications/read",
    validate(
      "json",
      z.union([
        z.object({ ids: z.array(z.string().min(1)).min(1).max(200) }),
        z.object({ all: z.literal(true), before: z.string().optional() }),
      ]),
    ),
    async (c) => {
      const key = c.var.apiKey;
      requireCapability(key, "read");
      if (!key.issuedByMemberId) {
        return c.json({ error: "api_key_has_no_issuer" }, 400);
      }

      const body = c.req.valid("json");
      const now = new Date();

      if ("ids" in body) {
        await db
          .update(meshNotification)
          .set({ readAt: now })
          .where(
            and(
              eq(meshNotification.recipientMemberId, key.issuedByMemberId),
              eq(meshNotification.meshId, key.meshId),
              isNull(meshNotification.readAt),
              sql`${meshNotification.id} = ANY(${body.ids})`,
            ),
          );
        return c.json({ marked: body.ids.length, readAt: now.toISOString() });
      }

      const beforeAt = body.before ? new Date(body.before) : now;
      if (Number.isNaN(beforeAt.getTime())) {
        return c.json({ error: "invalid_before" }, 400);
      }
      await db
        .update(meshNotification)
        .set({ readAt: now })
        .where(
          and(
            eq(meshNotification.recipientMemberId, key.issuedByMemberId),
            eq(meshNotification.meshId, key.meshId),
            isNull(meshNotification.readAt),
            sql`${meshNotification.createdAt} <= ${beforeAt}`,
          ),
        );
      return c.json({ marked: "all", before: beforeAt.toISOString() });
    },
  )

  // GET /v1/peers — connected peers in the key's mesh
  //
  // Sources, deduped by memberId:
  //   1. presence rows — WS-connected peers (CLI sessions, MCP push-pipes)
  //   2. recently-active apikey holders — humans driving the dashboard
  //      chat over REST. We treat any apikey used in the last 5 minutes
  //      as a live "human peer" so other CLIs can see them.
  //
  // Presence wins when both exist (more accurate status). Apikey-only
  // rows get a `via: "rest"` flag and inherit the issuing member's
  // identity — that's the only way the dashboard chat user appears in
  // /list_peers from a CLI today.
  .get("/peers", async (c) => {
    const key = c.var.apiKey;
    requireCapability(key, "read");

    const presenceRows = await db
      .select({
        memberId: meshMember.id,
        pubkey: meshMember.peerPubkey,
        displayName: meshMember.displayName,
        status: presence.status,
        summary: presence.summary,
        groups: presence.groups,
        connectedAt: presence.connectedAt,
      })
      .from(presence)
      .innerJoin(meshMember, eq(presence.memberId, meshMember.id))
      .where(
        and(eq(meshMember.meshId, key.meshId), isNull(presence.disconnectedAt)),
      )
      .orderBy(desc(presence.connectedAt));

    const restCutoff = new Date(Date.now() - 5 * 60 * 1000);
    const restRows = await db
      .select({
        memberId: meshMember.id,
        pubkey: meshMember.peerPubkey,
        displayName: meshMember.displayName,
        lastUsedAt: meshApiKey.lastUsedAt,
      })
      .from(meshApiKey)
      .innerJoin(
        meshMember,
        eq(meshApiKey.issuedByMemberId, meshMember.id),
      )
      .where(
        and(
          eq(meshApiKey.meshId, key.meshId),
          isNull(meshApiKey.revokedAt),
          gt(meshApiKey.lastUsedAt, restCutoff),
        ),
      );

    const seen = new Set<string>();
    const peers: Array<{
      pubkey: string;
      displayName: string;
      status: string;
      summary: string | null;
      groups: unknown;
      via: "ws" | "rest";
    }> = [];

    for (const r of presenceRows) {
      if (seen.has(r.memberId)) continue;
      seen.add(r.memberId);
      peers.push({
        pubkey: r.pubkey,
        displayName: r.displayName,
        status: r.status,
        summary: r.summary,
        groups: r.groups,
        via: "ws",
      });
    }
    for (const r of restRows) {
      if (seen.has(r.memberId)) continue;
      seen.add(r.memberId);
      peers.push({
        pubkey: r.pubkey,
        displayName: r.displayName,
        status: "idle",
        summary: null,
        groups: [],
        via: "rest",
      });
    }
    return c.json({ peers });
  });
