/**
 * `claudemesh topic <verb>` — conversation-scope primitive within a mesh.
 *
 * Topics complement groups: groups are identity tags ("@frontend"); topics
 * are conversation scopes ("#deploys") with persistent history,
 * subscription-based delivery, and per-topic state.
 *
 * Verbs:
 *   create <name> [--description X] [--visibility public|private|dm]
 *   list
 *   join <topic>     [--role lead|member|observer]
 *   leave <topic>
 *   members <topic>
 *   history <topic>  [--limit N] [--before <id>]
 *   read <topic>     (mark all as read)
 *
 * Spec: .artifacts/specs/2026-05-02-v0.2.0-scope.md
 */

import { withMesh } from "./connect.js";
import { render } from "~/ui/render.js";
import { bold, clay, dim, green } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

export interface TopicFlags {
  mesh?: string;
  json?: boolean;
  description?: string;
  visibility?: "public" | "private" | "dm";
  role?: "lead" | "member" | "observer";
  limit?: number | string;
  before?: string;
}

export async function runTopicCreate(name: string, flags: TopicFlags): Promise<number> {
  if (!name) {
    render.err("Usage: claudemesh topic create <name> [--description X] [--visibility V]");
    return EXIT.INVALID_ARGS;
  }
  return await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    const result = await client.topicCreate({
      name,
      description: flags.description,
      visibility: flags.visibility,
    });
    if (!result) {
      render.err("topic create failed");
      return EXIT.INTERNAL_ERROR;
    }
    if (flags.json) {
      console.log(JSON.stringify(result));
      return EXIT.SUCCESS;
    }
    if (result.created) {
      render.ok("created", `${clay("#" + name)} ${dim(result.id.slice(0, 8))}`);
    } else {
      render.info(dim(`already exists: #${name} ${result.id.slice(0, 8)}`));
    }
    return EXIT.SUCCESS;
  });
}

export async function runTopicList(flags: TopicFlags): Promise<number> {
  return await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    const topics = await client.topicList();
    if (flags.json) {
      console.log(JSON.stringify(topics, null, 2));
      return EXIT.SUCCESS;
    }
    if (topics.length === 0) {
      render.info(dim("no topics in this mesh."));
      return EXIT.SUCCESS;
    }
    render.section(`topics (${topics.length})`);
    for (const t of topics) {
      const vis = t.visibility === "public" ? green(t.visibility) : dim(t.visibility);
      process.stdout.write(`  ${clay("#" + t.name)}  ${vis}  ${dim(`${t.memberCount} member${t.memberCount === 1 ? "" : "s"}`)}\n`);
      if (t.description) process.stdout.write(`    ${dim(t.description)}\n`);
    }
    return EXIT.SUCCESS;
  });
}

export async function runTopicJoin(topic: string, flags: TopicFlags): Promise<number> {
  if (!topic) {
    render.err("Usage: claudemesh topic join <topic> [--role lead|member|observer]");
    return EXIT.INVALID_ARGS;
  }
  return await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    await client.topicJoin(topic, flags.role);
    if (flags.json) console.log(JSON.stringify({ joined: topic }));
    else render.ok("joined", clay("#" + topic));
    return EXIT.SUCCESS;
  });
}

export async function runTopicLeave(topic: string, flags: TopicFlags): Promise<number> {
  if (!topic) {
    render.err("Usage: claudemesh topic leave <topic>");
    return EXIT.INVALID_ARGS;
  }
  return await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    await client.topicLeave(topic);
    if (flags.json) console.log(JSON.stringify({ left: topic }));
    else render.ok("left", clay("#" + topic));
    return EXIT.SUCCESS;
  });
}

export async function runTopicMembers(topic: string, flags: TopicFlags): Promise<number> {
  if (!topic) {
    render.err("Usage: claudemesh topic members <topic>");
    return EXIT.INVALID_ARGS;
  }
  return await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    const members = await client.topicMembers(topic);
    if (flags.json) {
      console.log(JSON.stringify(members, null, 2));
      return EXIT.SUCCESS;
    }
    if (members.length === 0) {
      render.info(dim(`no members in ${clay("#" + topic)}.`));
      return EXIT.SUCCESS;
    }
    render.section(`${clay("#" + topic)} members (${members.length})`);
    for (const m of members) {
      process.stdout.write(`  ${bold(m.displayName)}  ${dim(m.role)}  ${dim(m.pubkey.slice(0, 8))}\n`);
    }
    return EXIT.SUCCESS;
  });
}

export async function runTopicHistory(topic: string, flags: TopicFlags): Promise<number> {
  if (!topic) {
    render.err("Usage: claudemesh topic history <topic> [--limit N] [--before <id>]");
    return EXIT.INVALID_ARGS;
  }
  return await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    const limit = flags.limit ? Number(flags.limit) : undefined;
    const messages = await client.topicHistory({
      topic,
      limit,
      beforeId: flags.before,
    });
    if (flags.json) {
      console.log(JSON.stringify(messages, null, 2));
      return EXIT.SUCCESS;
    }
    if (messages.length === 0) {
      render.info(dim(`no messages in ${clay("#" + topic)}.`));
      return EXIT.SUCCESS;
    }
    // History returns newest-first; render oldest-first for chat UX.
    const ordered = [...messages].reverse();
    render.section(`${clay("#" + topic)} history (${ordered.length})`);
    for (const m of ordered) {
      const t = new Date(m.createdAt).toLocaleString();
      process.stdout.write(
        `  ${dim(t)}  ${bold(m.senderPubkey.slice(0, 8))}  ${dim("(encrypted, " + m.ciphertext.length + "b)")}\n`,
      );
    }
    return EXIT.SUCCESS;
  });
}

export async function runTopicMarkRead(topic: string, flags: TopicFlags): Promise<number> {
  if (!topic) {
    render.err("Usage: claudemesh topic read <topic>");
    return EXIT.INVALID_ARGS;
  }
  return await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    await client.topicMarkRead(topic);
    if (flags.json) console.log(JSON.stringify({ read: topic }));
    else render.ok("marked read", clay("#" + topic));
    return EXIT.SUCCESS;
  });
}
