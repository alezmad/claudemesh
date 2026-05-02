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
  meshTopic,
  meshTopicMember,
  meshTopicMessage,
  messageQueue,
  presence,
} from "@turbostarter/db/schema/mesh";
import { and, asc, count, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";

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
});

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

    // Persist to history (topic_message) + ephemeral queue (message_queue).
    // Broker's drain loop picks up the queue entry and pushes to live peers.
    const [historyRow] = await db
      .insert(meshTopicMessage)
      .values({
        topicId: topic.id,
        senderMemberId: ownerMember.id,
        nonce: body.nonce,
        ciphertext: body.ciphertext,
      })
      .returning({ id: meshTopicMessage.id });

    const [queueRow] = await db
      .insert(messageQueue)
      .values({
        meshId: key.meshId,
        senderMemberId: ownerMember.id,
        targetSpec: "#" + topic.id,
        priority: body.priority,
        nonce: body.nonce,
        ciphertext: body.ciphertext,
      })
      .returning({ id: messageQueue.id });

    return c.json({
      messageId: queueRow?.id ?? null,
      historyId: historyRow?.id ?? null,
      topic: body.topic,
      topicId: topic.id,
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
            sql`${meshTopicMessage.topicId} = ANY(${topicIds})`,
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
          senderPubkey: r.senderPubkey,
          senderName: r.senderName,
          nonce: r.nonce,
          ciphertext: r.ciphertext,
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
              senderPubkey: meshMember.peerPubkey,
              senderName: meshMember.displayName,
              nonce: meshTopicMessage.nonce,
              ciphertext: meshTopicMessage.ciphertext,
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
                senderPubkey: r.senderPubkey,
                senderName: r.senderName,
                nonce: r.nonce,
                ciphertext: r.ciphertext,
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

  // GET /v1/notifications — recent @-mentions of the viewer across all
  // topics in the key's mesh. v0.2.0 plaintext-base64 ciphertext lets
  // us regex match server-side; in v0.3.0 (per-topic encryption) this
  // moves to a notification table populated at write time.
  //
  // Query: ?since=<ISO> to incrementally fetch only newer mentions
  // (e.g. for a polling notification bell). Default: last 24h.
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

    // Postgres regex with case-insensitive match + word boundary on
    // both sides. Decode the base64 ciphertext (plaintext envelope in
    // v0.2.0) so we're matching readable text, not the base64 alphabet.
    const escaped = me.displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = `(^|\\s|[^A-Za-z0-9_-])@${escaped}($|[^A-Za-z0-9_-])`;

    const rows = await db
      .select({
        id: meshTopicMessage.id,
        topicId: meshTopicMessage.topicId,
        topicName: meshTopic.name,
        senderMemberId: meshTopicMessage.senderMemberId,
        senderName: meshMember.displayName,
        senderPubkey: meshMember.peerPubkey,
        ciphertext: meshTopicMessage.ciphertext,
        createdAt: meshTopicMessage.createdAt,
      })
      .from(meshTopicMessage)
      .innerJoin(meshTopic, eq(meshTopic.id, meshTopicMessage.topicId))
      .innerJoin(
        meshMember,
        eq(meshMember.id, meshTopicMessage.senderMemberId),
      )
      .where(
        and(
          eq(meshTopic.meshId, key.meshId),
          isNull(meshTopic.archivedAt),
          gt(meshTopicMessage.createdAt, since),
          sql`${meshTopicMessage.senderMemberId} <> ${key.issuedByMemberId}`,
          sql`convert_from(decode(${meshTopicMessage.ciphertext}, 'base64'), 'UTF8') ~* ${pattern}`,
        ),
      )
      .orderBy(desc(meshTopicMessage.createdAt))
      .limit(50);

    return c.json({
      notifications: rows.map((r) => ({
        id: r.id,
        topicId: r.topicId,
        topicName: r.topicName,
        senderName: r.senderName,
        senderPubkey: r.senderPubkey,
        ciphertext: r.ciphertext,
        createdAt: r.createdAt.toISOString(),
      })),
      since: since.toISOString(),
      mentionedAs: me.displayName,
    });
  })

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
