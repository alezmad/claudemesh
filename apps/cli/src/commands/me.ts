/**
 * `claudemesh me` — cross-mesh workspace overview for the caller's user.
 *
 * Calls GET /v1/me/workspace which aggregates over every mesh the
 * authenticated user belongs to: peer count, online count, topic count,
 * unread @-mention count per mesh + global totals.
 *
 * Auth: mints a temporary read-scoped REST apikey on whichever mesh
 * the user has joined first (any mesh works — the endpoint resolves
 * to the issuing user, not the apikey's mesh).
 *
 * v0.4.0 substrate. Future verbs (`me topics`, `me notifications`,
 * `me activity`, `me search`) layer on top of similar aggregating
 * endpoints once they ship.
 */

import { withRestKey } from "~/services/api/with-rest-key.js";
import { request } from "~/services/api/client.js";
import { readConfig } from "~/services/config/facade.js";
import { render } from "~/ui/render.js";
import { bold, clay, cyan, dim, green, yellow } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

/**
 * /v1/me/* endpoints resolve the caller's user from the apikey issuer
 * regardless of which mesh issued the key — every mesh works. When the
 * user didn't pass --mesh, silently pick the first joined mesh for
 * apikey-mint instead of prompting; the endpoint sees the same user.
 */
function resolveMeshForMint(explicit: string | null | undefined): string | null {
  if (explicit) return explicit;
  const cfg = readConfig();
  return cfg.meshes[0]?.slug ?? null;
}

interface WorkspaceMesh {
  meshId: string;
  slug: string;
  name: string;
  memberId: string;
  myRole: string;
  joinedAt: string;
  peers: number;
  online: number;
  topics: number;
  unreadMentions: number;
}

interface WorkspaceResponse {
  userId: string;
  meshes: WorkspaceMesh[];
  totals: {
    meshes: number;
    peers: number;
    online: number;
    topics: number;
    unreadMentions: number;
  };
}

export interface MeFlags {
  mesh?: string;
  json?: boolean;
}

export async function runMe(flags: MeFlags): Promise<number> {
  return withRestKey(
    {
      meshSlug: resolveMeshForMint(flags.mesh),
      purpose: "workspace-overview",
      capabilities: ["read"],
    },
    async ({ secret }) => {
      const ws = await request<WorkspaceResponse>({
        path: "/api/v1/me/workspace",
        token: secret,
      });

      if (flags.json) {
        console.log(JSON.stringify(ws, null, 2));
        return EXIT.SUCCESS;
      }

      render.section(
        `${clay("workspace")} — ${bold(ws.userId.slice(0, 8))}  ${dim(
          `· ${ws.totals.meshes} mesh${ws.totals.meshes === 1 ? "" : "es"}`,
        )}`,
      );

      const totalsLine = [
        `${green(String(ws.totals.online))}/${ws.totals.peers} online`,
        `${ws.totals.topics} topic${ws.totals.topics === 1 ? "" : "s"}`,
        ws.totals.unreadMentions > 0
          ? yellow(`${ws.totals.unreadMentions} unread @you`)
          : dim("0 unread @you"),
      ].join(dim(" · "));
      process.stdout.write("  " + totalsLine + "\n\n");

      if (ws.meshes.length === 0) {
        process.stdout.write(
          dim("  no meshes joined — run `claudemesh new` or accept an invite\n"),
        );
        return EXIT.SUCCESS;
      }

      const slugWidth = Math.max(...ws.meshes.map((m) => m.slug.length), 8);
      for (const m of ws.meshes) {
        const slug = cyan(m.slug.padEnd(slugWidth));
        const peers = `${m.online}/${m.peers}`;
        const role = dim(m.myRole);
        const unread =
          m.unreadMentions > 0
            ? "  " + yellow(`${m.unreadMentions} @you`)
            : "";
        process.stdout.write(
          `  ${slug}  ${peers.padStart(5)} online  ${dim(
            String(m.topics).padStart(2) + " topics",
          )}  ${role}${unread}\n`,
        );
      }
      return EXIT.SUCCESS;
    },
  );
}

interface WorkspaceTopic {
  topicId: string;
  name: string;
  description: string | null;
  visibility: string;
  createdAt: string;
  meshId: string;
  meshSlug: string;
  meshName: string;
  memberId: string;
  unread: number;
  lastMessageAt: string | null;
}

interface WorkspaceTopicsResponse {
  topics: WorkspaceTopic[];
  totals: { topics: number; unread: number };
}

export interface MeTopicsFlags extends MeFlags {
  unread?: boolean;
}

export async function runMeTopics(flags: MeTopicsFlags): Promise<number> {
  return withRestKey(
    {
      meshSlug: resolveMeshForMint(flags.mesh),
      purpose: "workspace-topics",
      capabilities: ["read"],
    },
    async ({ secret }) => {
      const ws = await request<WorkspaceTopicsResponse>({
        path: "/api/v1/me/topics",
        token: secret,
      });

      const visible = flags.unread
        ? ws.topics.filter((t) => t.unread > 0)
        : ws.topics;

      if (flags.json) {
        console.log(
          JSON.stringify(
            { topics: visible, totals: ws.totals },
            null,
            2,
          ),
        );
        return EXIT.SUCCESS;
      }

      render.section(
        `${clay("topics")} — ${ws.totals.topics} across all meshes  ${dim(
          ws.totals.unread > 0
            ? `· ${ws.totals.unread} unread`
            : "· all read",
        )}`,
      );

      if (visible.length === 0) {
        process.stdout.write(
          dim(
            flags.unread
              ? "  no unread topics\n"
              : "  no topics — run `claudemesh topic create #general`\n",
          ),
        );
        return EXIT.SUCCESS;
      }

      const slugWidth = Math.max(...visible.map((t) => t.meshSlug.length), 6);
      const nameWidth = Math.max(...visible.map((t) => t.name.length), 8);

      for (const t of visible) {
        const slug = dim(t.meshSlug.padEnd(slugWidth));
        const name = cyan(t.name.padEnd(nameWidth));
        const unread =
          t.unread > 0
            ? yellow(`${t.unread} unread`.padStart(10))
            : dim("·".padStart(10));
        const last = t.lastMessageAt
          ? dim(formatRelativeTime(t.lastMessageAt))
          : dim("never");
        process.stdout.write(`  ${slug}  ${name}  ${unread}  ${last}\n`);
      }
      return EXIT.SUCCESS;
    },
  );
}

interface WorkspaceNotification {
  notificationId: string;
  messageId: string;
  topicId: string;
  topicName: string;
  meshId: string;
  meshSlug: string;
  meshName: string;
  senderName: string | null;
  snippet: string | null;
  ciphertext: string | null;
  bodyVersion: number;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

interface WorkspaceNotificationsResponse {
  notifications: WorkspaceNotification[];
  totals: { unread: number; total: number };
}

export interface MeNotificationsFlags extends MeFlags {
  all?: boolean;
  since?: string;
}

export async function runMeNotifications(
  flags: MeNotificationsFlags,
): Promise<number> {
  return withRestKey(
    {
      meshSlug: resolveMeshForMint(flags.mesh),
      purpose: "workspace-notifications",
      capabilities: ["read"],
    },
    async ({ secret }) => {
      const params = new URLSearchParams();
      if (flags.all) params.set("include", "all");
      if (flags.since) params.set("since", flags.since);
      const path =
        "/api/v1/me/notifications" +
        (params.toString() ? `?${params.toString()}` : "");
      const ws = await request<WorkspaceNotificationsResponse>({
        path,
        token: secret,
      });

      if (flags.json) {
        console.log(JSON.stringify(ws, null, 2));
        return EXIT.SUCCESS;
      }

      const headerLabel = flags.all ? "@-mentions (all)" : "@-mentions (unread)";
      render.section(
        `${clay(headerLabel)} — ${ws.totals.total} ${dim(
          ws.totals.unread > 0 ? `· ${ws.totals.unread} unread` : "· nothing pending",
        )}`,
      );

      if (ws.notifications.length === 0) {
        process.stdout.write(
          dim(
            flags.all
              ? "  no @-mentions in window\n"
              : "  inbox zero — nothing waiting\n",
          ),
        );
        return EXIT.SUCCESS;
      }

      const slugWidth = Math.max(
        ...ws.notifications.map((n) => n.meshSlug.length),
        6,
      );

      for (const n of ws.notifications) {
        const slug = dim(n.meshSlug.padEnd(slugWidth));
        const topic = cyan(`#${n.topicName}`);
        const sender = n.senderName ? `from ${n.senderName}` : "from ?";
        const ago = formatRelativeTime(n.createdAt);
        const dot = n.read ? dim("·") : yellow("●");
        const snippet =
          n.snippet ?? (n.ciphertext ? dim("[encrypted]") : dim("[empty]"));
        process.stdout.write(
          `  ${dot}  ${slug}  ${topic}  ${dim(sender)}  ${dim(ago)}\n` +
            `     ${snippet.length > 200 ? snippet.slice(0, 200) + "…" : snippet}\n`,
        );
      }
      return EXIT.SUCCESS;
    },
  );
}

interface WorkspaceActivity {
  messageId: string;
  topicId: string;
  topicName: string;
  meshId: string;
  meshSlug: string;
  meshName: string;
  senderName: string;
  senderMemberId: string;
  snippet: string | null;
  ciphertext: string | null;
  bodyVersion: number;
  createdAt: string;
}

interface WorkspaceActivityResponse {
  activity: WorkspaceActivity[];
  totals: { events: number };
}

export interface MeActivityFlags extends MeFlags {
  since?: string;
}

export async function runMeActivity(flags: MeActivityFlags): Promise<number> {
  return withRestKey(
    {
      meshSlug: resolveMeshForMint(flags.mesh),
      purpose: "workspace-activity",
      capabilities: ["read"],
    },
    async ({ secret }) => {
      const params = new URLSearchParams();
      if (flags.since) params.set("since", flags.since);
      const path =
        "/api/v1/me/activity" +
        (params.toString() ? `?${params.toString()}` : "");
      const ws = await request<WorkspaceActivityResponse>({
        path,
        token: secret,
      });

      if (flags.json) {
        console.log(JSON.stringify(ws, null, 2));
        return EXIT.SUCCESS;
      }

      render.section(
        `${clay("activity")} — ${ws.totals.events} ${dim(
          flags.since ? `since ${flags.since}` : "in the last 24h",
        )}`,
      );

      if (ws.activity.length === 0) {
        process.stdout.write(dim("  quiet — no activity in window\n"));
        return EXIT.SUCCESS;
      }

      const slugWidth = Math.max(
        ...ws.activity.map((a) => a.meshSlug.length),
        6,
      );

      for (const a of ws.activity) {
        const slug = dim(a.meshSlug.padEnd(slugWidth));
        const topic = cyan(`#${a.topicName}`);
        const sender = a.senderName ?? "?";
        const ago = formatRelativeTime(a.createdAt);
        const snippet =
          a.snippet ?? (a.ciphertext ? dim("[encrypted]") : dim("[empty]"));
        process.stdout.write(
          `  ${slug}  ${topic}  ${dim(sender + " ·")} ${dim(ago)}\n` +
            `     ${snippet.length > 200 ? snippet.slice(0, 200) + "…" : snippet}\n`,
        );
      }
      return EXIT.SUCCESS;
    },
  );
}

interface WorkspaceSearchTopicHit {
  id: string;
  name: string;
  description: string | null;
  meshId: string;
  meshSlug: string;
  meshName: string;
}

interface WorkspaceSearchMessageHit {
  messageId: string;
  topicId: string;
  topicName: string;
  meshId: string;
  meshSlug: string;
  senderName: string;
  snippet: string | null;
  bodyVersion: number;
  createdAt: string;
}

interface WorkspaceSearchResponse {
  query: string;
  topics: WorkspaceSearchTopicHit[];
  messages: WorkspaceSearchMessageHit[];
  totals: { topics: number; messages: number };
}

export interface MeSearchFlags extends MeFlags {
  query: string;
}

export async function runMeSearch(flags: MeSearchFlags): Promise<number> {
  if (!flags.query || flags.query.length < 2) {
    process.stderr.write(
      "Usage: claudemesh me search <query> (min 2 chars)\n",
    );
    return EXIT.INVALID_ARGS;
  }

  return withRestKey(
    {
      meshSlug: resolveMeshForMint(flags.mesh),
      purpose: "workspace-search",
      capabilities: ["read"],
    },
    async ({ secret }) => {
      const params = new URLSearchParams({ q: flags.query });
      const ws = await request<WorkspaceSearchResponse>({
        path: `/api/v1/me/search?${params.toString()}`,
        token: secret,
      });

      if (flags.json) {
        console.log(JSON.stringify(ws, null, 2));
        return EXIT.SUCCESS;
      }

      render.section(
        `${clay("search")} — "${flags.query}"  ${dim(
          `${ws.totals.topics} topic${ws.totals.topics === 1 ? "" : "s"}, ` +
            `${ws.totals.messages} message${ws.totals.messages === 1 ? "" : "s"}`,
        )}`,
      );

      if (ws.topics.length === 0 && ws.messages.length === 0) {
        process.stdout.write(dim("  no matches\n"));
        return EXIT.SUCCESS;
      }

      if (ws.topics.length > 0) {
        process.stdout.write(dim("\n  topics\n"));
        const slugWidth = Math.max(
          ...ws.topics.map((t) => t.meshSlug.length),
          6,
        );
        for (const t of ws.topics) {
          const slug = dim(t.meshSlug.padEnd(slugWidth));
          const name = cyan(`#${t.name}`);
          const desc = t.description ? dim(` — ${t.description}`) : "";
          process.stdout.write(`  ${slug}  ${name}${desc}\n`);
        }
      }

      if (ws.messages.length > 0) {
        process.stdout.write(dim("\n  messages\n"));
        const slugWidth = Math.max(
          ...ws.messages.map((m) => m.meshSlug.length),
          6,
        );
        for (const m of ws.messages) {
          const slug = dim(m.meshSlug.padEnd(slugWidth));
          const topic = cyan(`#${m.topicName}`);
          const sender = m.senderName;
          const ago = formatRelativeTime(m.createdAt);
          const snippet =
            m.snippet ??
            (m.bodyVersion === 2 ? dim("[encrypted — open the topic to decrypt]") : dim("[empty]"));
          const highlighted =
            m.snippet
              ? highlightMatch(snippet, flags.query)
              : snippet;
          process.stdout.write(
            `  ${slug}  ${topic}  ${dim(sender + " ·")} ${dim(ago)}\n` +
              `     ${highlighted}\n`,
          );
        }
      }
      return EXIT.SUCCESS;
    },
  );
}

function highlightMatch(text: string, query: string): string {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return `${before}${yellow(match)}${after}`;
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(0, Math.floor((now - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86_400 * 30) return `${Math.floor(sec / 86_400)}d ago`;
  if (sec < 86_400 * 365)
    return `${Math.floor(sec / (86_400 * 30))}mo ago`;
  return `${Math.floor(sec / (86_400 * 365))}y ago`;
}
