/**
 * Platform CLI verbs — vector / graph / context / stream / sql / skill /
 * vault / watch / webhook / task / clock. These wrap broker methods that
 * previously were only callable via MCP tools.
 *
 * All verbs run cold-path (open own WS via `withMesh`). Bridge expansion
 * for high-frequency reads (vector_search, graph_query, sql_query) lands
 * in 1.3.1.
 *
 * Spec: .artifacts/specs/2026-05-02-architecture-north-star.md
 */

import { withMesh } from "./connect.js";
import { render } from "~/ui/render.js";
import { bold, clay, dim } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

type Flags = { mesh?: string; json?: boolean };

function emitJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

// ════════════════════════════════════════════════════════════════════════
// vector — embedding store + similarity search
// ════════════════════════════════════════════════════════════════════════

export async function runVectorStore(
  collection: string,
  text: string,
  opts: Flags & { metadata?: string },
): Promise<number> {
  if (!collection || !text) {
    render.err("Usage: claudemesh vector store <collection> <text> [--metadata <json>]");
    return EXIT.INVALID_ARGS;
  }
  let metadata: Record<string, unknown> | undefined;
  if (opts.metadata) {
    try { metadata = JSON.parse(opts.metadata) as Record<string, unknown>; }
    catch { render.err("--metadata must be JSON"); return EXIT.INVALID_ARGS; }
  }
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const id = await client.vectorStore(collection, text, metadata);
    if (!id) { render.err("store failed"); return EXIT.INTERNAL_ERROR; }
    if (opts.json) emitJson({ id, collection });
    else render.ok(`stored in ${clay(collection)}`, dim(id));
    return EXIT.SUCCESS;
  });
}

export async function runVectorSearch(
  collection: string,
  query: string,
  opts: Flags & { limit?: string },
): Promise<number> {
  if (!collection || !query) {
    render.err("Usage: claudemesh vector search <collection> <query> [--limit N]");
    return EXIT.INVALID_ARGS;
  }
  const limit = opts.limit ? parseInt(opts.limit, 10) : undefined;
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const hits = await client.vectorSearch(collection, query, limit);
    if (opts.json) { emitJson(hits); return EXIT.SUCCESS; }
    if (hits.length === 0) { render.info(dim("(no matches)")); return EXIT.SUCCESS; }
    render.section(`${hits.length} match${hits.length === 1 ? "" : "es"} in ${clay(collection)}`);
    for (const h of hits) {
      process.stdout.write(`  ${bold(h.score.toFixed(3))}  ${dim(h.id.slice(0, 8))}  ${h.text}\n`);
    }
    return EXIT.SUCCESS;
  });
}

export async function runVectorDelete(
  collection: string,
  id: string,
  opts: Flags,
): Promise<number> {
  if (!collection || !id) {
    render.err("Usage: claudemesh vector delete <collection> <id>");
    return EXIT.INVALID_ARGS;
  }
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    await client.vectorDelete(collection, id);
    if (opts.json) emitJson({ id, deleted: true });
    else render.ok(`deleted ${dim(id.slice(0, 8))}`);
    return EXIT.SUCCESS;
  });
}

export async function runVectorCollections(opts: Flags): Promise<number> {
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const cols = await client.listCollections();
    if (opts.json) { emitJson(cols); return EXIT.SUCCESS; }
    if (cols.length === 0) { render.info(dim("(no collections)")); return EXIT.SUCCESS; }
    render.section(`vector collections (${cols.length})`);
    for (const c of cols) process.stdout.write(`  ${clay(c)}\n`);
    return EXIT.SUCCESS;
  });
}

// ════════════════════════════════════════════════════════════════════════
// graph — Cypher query / execute
// ════════════════════════════════════════════════════════════════════════

export async function runGraphQuery(cypher: string, opts: Flags): Promise<number> {
  if (!cypher) { render.err("Usage: claudemesh graph query \"<cypher>\""); return EXIT.INVALID_ARGS; }
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const rows = await client.graphQuery(cypher);
    if (opts.json) { emitJson(rows); return EXIT.SUCCESS; }
    if (rows.length === 0) { render.info(dim("(no rows)")); return EXIT.SUCCESS; }
    render.section(`${rows.length} row${rows.length === 1 ? "" : "s"}`);
    for (const r of rows) process.stdout.write(`  ${JSON.stringify(r)}\n`);
    return EXIT.SUCCESS;
  });
}

export async function runGraphExecute(cypher: string, opts: Flags): Promise<number> {
  if (!cypher) { render.err("Usage: claudemesh graph execute \"<cypher>\""); return EXIT.INVALID_ARGS; }
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const rows = await client.graphExecute(cypher);
    if (opts.json) { emitJson(rows); return EXIT.SUCCESS; }
    render.ok("executed", `${rows.length} row${rows.length === 1 ? "" : "s"} affected`);
    return EXIT.SUCCESS;
  });
}

// ════════════════════════════════════════════════════════════════════════
// context — share work-context summaries
// ════════════════════════════════════════════════════════════════════════

export async function runContextShare(
  summary: string,
  opts: Flags & { files?: string; findings?: string; tags?: string },
): Promise<number> {
  if (!summary) {
    render.err("Usage: claudemesh context share \"<summary>\" [--files a,b] [--findings x,y] [--tags t1,t2]");
    return EXIT.INVALID_ARGS;
  }
  const files = opts.files?.split(",").map((s) => s.trim()).filter(Boolean);
  const findings = opts.findings?.split(",").map((s) => s.trim()).filter(Boolean);
  const tags = opts.tags?.split(",").map((s) => s.trim()).filter(Boolean);
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    await client.shareContext(summary, files, findings, tags);
    if (opts.json) emitJson({ shared: true, summary });
    else render.ok("context shared");
    return EXIT.SUCCESS;
  });
}

export async function runContextGet(query: string, opts: Flags): Promise<number> {
  if (!query) { render.err("Usage: claudemesh context get \"<query>\""); return EXIT.INVALID_ARGS; }
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const ctxs = await client.getContext(query);
    if (opts.json) { emitJson(ctxs); return EXIT.SUCCESS; }
    if (ctxs.length === 0) { render.info(dim("(no matches)")); return EXIT.SUCCESS; }
    render.section(`${ctxs.length} context${ctxs.length === 1 ? "" : "s"}`);
    for (const c of ctxs) {
      process.stdout.write(`  ${bold(c.peerName)} ${dim("·")} ${c.updatedAt}\n`);
      process.stdout.write(`    ${c.summary}\n`);
      if (c.tags.length) process.stdout.write(`    ${dim("tags: " + c.tags.join(", "))}\n`);
    }
    return EXIT.SUCCESS;
  });
}

export async function runContextList(opts: Flags): Promise<number> {
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const ctxs = await client.listContexts();
    if (opts.json) { emitJson(ctxs); return EXIT.SUCCESS; }
    if (ctxs.length === 0) { render.info(dim("(no contexts)")); return EXIT.SUCCESS; }
    render.section(`shared contexts (${ctxs.length})`);
    for (const c of ctxs) {
      process.stdout.write(`  ${bold(c.peerName)} ${dim("·")} ${c.updatedAt}\n`);
      process.stdout.write(`    ${c.summary}\n`);
    }
    return EXIT.SUCCESS;
  });
}

// ════════════════════════════════════════════════════════════════════════
// stream — pub/sub event bus per mesh
// ════════════════════════════════════════════════════════════════════════

export async function runStreamCreate(name: string, opts: Flags): Promise<number> {
  if (!name) { render.err("Usage: claudemesh stream create <name>"); return EXIT.INVALID_ARGS; }
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const id = await client.createStream(name);
    if (!id) { render.err("create failed"); return EXIT.INTERNAL_ERROR; }
    if (opts.json) emitJson({ id, name });
    else render.ok(`created ${clay(name)}`, dim(id));
    return EXIT.SUCCESS;
  });
}

export async function runStreamPublish(name: string, dataRaw: string, opts: Flags): Promise<number> {
  if (!name || dataRaw === undefined) {
    render.err("Usage: claudemesh stream publish <name> <json-or-text>");
    return EXIT.INVALID_ARGS;
  }
  let data: unknown;
  try { data = JSON.parse(dataRaw); } catch { data = dataRaw; }
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    await client.publish(name, data);
    if (opts.json) emitJson({ published: true, name });
    else render.ok(`published to ${clay(name)}`);
    return EXIT.SUCCESS;
  });
}

export async function runStreamList(opts: Flags): Promise<number> {
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const streams = await client.listStreams();
    if (opts.json) { emitJson(streams); return EXIT.SUCCESS; }
    if (streams.length === 0) { render.info(dim("(no streams)")); return EXIT.SUCCESS; }
    render.section(`streams (${streams.length})`);
    for (const s of streams) {
      process.stdout.write(`  ${clay(s.name)} ${dim(`· ${s.subscriberCount} subscriber${s.subscriberCount === 1 ? "" : "s"} · by ${s.createdBy}`)}\n`);
    }
    return EXIT.SUCCESS;
  });
}

// ════════════════════════════════════════════════════════════════════════
// sql — typed query against per-mesh tables
// ════════════════════════════════════════════════════════════════════════

export async function runSqlQuery(sql: string, opts: Flags): Promise<number> {
  if (!sql) { render.err("Usage: claudemesh sql query \"<select>\""); return EXIT.INVALID_ARGS; }
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const result = await client.meshQuery(sql);
    if (!result) { render.err("query timed out"); return EXIT.INTERNAL_ERROR; }
    if (opts.json) { emitJson(result); return EXIT.SUCCESS; }
    render.section(`${result.rowCount} row${result.rowCount === 1 ? "" : "s"}`);
    if (result.columns.length > 0) {
      process.stdout.write(`  ${dim(result.columns.join("  "))}\n`);
      for (const row of result.rows) {
        process.stdout.write(`  ${result.columns.map((c) => String(row[c] ?? "")).join("  ")}\n`);
      }
    }
    return EXIT.SUCCESS;
  });
}

export async function runSqlExecute(sql: string, opts: Flags): Promise<number> {
  if (!sql) { render.err("Usage: claudemesh sql execute \"<statement>\""); return EXIT.INVALID_ARGS; }
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    await client.meshExecute(sql);
    if (opts.json) emitJson({ executed: true });
    else render.ok("executed");
    return EXIT.SUCCESS;
  });
}

export async function runSqlSchema(opts: Flags): Promise<number> {
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const tables = await client.meshSchema();
    if (opts.json) { emitJson(tables); return EXIT.SUCCESS; }
    if (tables.length === 0) { render.info(dim("(no tables)")); return EXIT.SUCCESS; }
    render.section(`mesh tables (${tables.length})`);
    for (const t of tables) {
      process.stdout.write(`  ${bold(t.name)}\n`);
      for (const c of t.columns) {
        const nullable = c.nullable ? "" : " not null";
        process.stdout.write(`    ${c.name} ${dim(c.type + nullable)}\n`);
      }
    }
    return EXIT.SUCCESS;
  });
}

// ════════════════════════════════════════════════════════════════════════
// skill — list / get / remove (publish currently goes through MCP)
// ════════════════════════════════════════════════════════════════════════

export async function runSkillList(opts: Flags & { query?: string }): Promise<number> {
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const skills = await client.listSkills(opts.query);
    if (opts.json) { emitJson(skills); return EXIT.SUCCESS; }
    if (skills.length === 0) { render.info(dim("(no skills)")); return EXIT.SUCCESS; }
    render.section(`mesh skills (${skills.length})`);
    for (const s of skills) {
      process.stdout.write(`  ${bold(s.name)} ${dim("· by " + s.author)}\n`);
      process.stdout.write(`    ${s.description}\n`);
      if (s.tags.length) process.stdout.write(`    ${dim("tags: " + s.tags.join(", "))}\n`);
    }
    return EXIT.SUCCESS;
  });
}

export async function runSkillGet(name: string, opts: Flags): Promise<number> {
  if (!name) { render.err("Usage: claudemesh skill get <name>"); return EXIT.INVALID_ARGS; }
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const skill = await client.getSkill(name);
    if (!skill) { render.err(`skill "${name}" not found`); return EXIT.NOT_FOUND; }
    if (opts.json) { emitJson(skill); return EXIT.SUCCESS; }
    render.section(skill.name);
    render.kv([
      ["author", skill.author],
      ["created", skill.createdAt],
      ["tags", skill.tags.join(", ") || dim("(none)")],
    ]);
    render.blank();
    render.info(skill.description);
    render.blank();
    process.stdout.write(skill.instructions + "\n");
    return EXIT.SUCCESS;
  });
}

export async function runSkillRemove(name: string, opts: Flags): Promise<number> {
  if (!name) { render.err("Usage: claudemesh skill remove <name>"); return EXIT.INVALID_ARGS; }
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const removed = await client.removeSkill(name);
    if (opts.json) emitJson({ name, removed });
    else if (removed) render.ok(`removed ${bold(name)}`);
    else render.err(`skill "${name}" not found`);
    return removed ? EXIT.SUCCESS : EXIT.NOT_FOUND;
  });
}

// ════════════════════════════════════════════════════════════════════════
// vault — encrypted per-mesh secrets list / delete (set/get need crypto)
// ════════════════════════════════════════════════════════════════════════

export async function runVaultList(opts: Flags): Promise<number> {
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const entries = await client.vaultList();
    if (opts.json) { emitJson(entries); return EXIT.SUCCESS; }
    if (!entries || entries.length === 0) { render.info(dim("(vault empty)")); return EXIT.SUCCESS; }
    render.section(`vault (${entries.length})`);
    for (const e of entries) {
      const k = String((e as any)?.key ?? "?");
      const t = String((e as any)?.entry_type ?? "");
      process.stdout.write(`  ${bold(k)} ${dim(t)}\n`);
    }
    return EXIT.SUCCESS;
  });
}

export async function runVaultDelete(key: string, opts: Flags): Promise<number> {
  if (!key) { render.err("Usage: claudemesh vault delete <key>"); return EXIT.INVALID_ARGS; }
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const ok = await client.vaultDelete(key);
    if (opts.json) emitJson({ key, deleted: ok });
    else if (ok) render.ok(`deleted ${bold(key)}`);
    else render.err(`vault key "${key}" not found`);
    return ok ? EXIT.SUCCESS : EXIT.NOT_FOUND;
  });
}

// ════════════════════════════════════════════════════════════════════════
// watch — URL change watchers
// ════════════════════════════════════════════════════════════════════════

export async function runWatchList(opts: Flags): Promise<number> {
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const watches = await client.watchList();
    if (opts.json) { emitJson(watches); return EXIT.SUCCESS; }
    if (!watches || watches.length === 0) { render.info(dim("(no watches)")); return EXIT.SUCCESS; }
    render.section(`url watches (${watches.length})`);
    for (const w of watches) {
      const id = String((w as any).id ?? "?");
      const url = String((w as any).url ?? "");
      const label = (w as any).label ? ` ${dim("(" + (w as any).label + ")")}` : "";
      process.stdout.write(`  ${dim(id.slice(0, 8))}  ${clay(url)}${label}\n`);
    }
    return EXIT.SUCCESS;
  });
}

export async function runUnwatch(id: string, opts: Flags): Promise<number> {
  if (!id) { render.err("Usage: claudemesh watch remove <id>"); return EXIT.INVALID_ARGS; }
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const ok = await client.unwatch(id);
    if (opts.json) emitJson({ id, removed: ok });
    else if (ok) render.ok(`unwatched ${dim(id.slice(0, 8))}`);
    else render.err(`watch "${id}" not found`);
    return ok ? EXIT.SUCCESS : EXIT.NOT_FOUND;
  });
}

// ════════════════════════════════════════════════════════════════════════
// webhook — outbound HTTP triggers
// ════════════════════════════════════════════════════════════════════════

export async function runWebhookList(opts: Flags): Promise<number> {
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const hooks = await client.listWebhooks();
    if (opts.json) { emitJson(hooks); return EXIT.SUCCESS; }
    if (hooks.length === 0) { render.info(dim("(no webhooks)")); return EXIT.SUCCESS; }
    render.section(`webhooks (${hooks.length})`);
    for (const h of hooks) {
      const dot = h.active ? "●" : dim("○");
      process.stdout.write(`  ${dot} ${bold(h.name)} ${dim("· " + h.url)}\n`);
    }
    return EXIT.SUCCESS;
  });
}

export async function runWebhookDelete(name: string, opts: Flags): Promise<number> {
  if (!name) { render.err("Usage: claudemesh webhook delete <name>"); return EXIT.INVALID_ARGS; }
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const ok = await client.deleteWebhook(name);
    if (opts.json) emitJson({ name, deleted: ok });
    else if (ok) render.ok(`deleted ${bold(name)}`);
    else render.err(`webhook "${name}" not found`);
    return ok ? EXIT.SUCCESS : EXIT.NOT_FOUND;
  });
}

// ════════════════════════════════════════════════════════════════════════
// task — list / create (claim / complete already in broker-actions.ts)
// ════════════════════════════════════════════════════════════════════════

export async function runTaskList(opts: Flags & { status?: string; assignee?: string }): Promise<number> {
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const tasks = await client.listTasks(opts.status, opts.assignee);
    if (opts.json) { emitJson(tasks); return EXIT.SUCCESS; }
    if (tasks.length === 0) { render.info(dim("(no tasks)")); return EXIT.SUCCESS; }
    render.section(`tasks (${tasks.length})`);
    for (const t of tasks) {
      const dot = t.status === "done" ? "●" : t.status === "claimed" ? clay("●") : dim("○");
      const assignee = t.assignee ? dim(` → ${t.assignee}`) : "";
      process.stdout.write(`  ${dot} ${dim(t.id.slice(0, 8))} ${bold(t.title)}${assignee}\n`);
    }
    return EXIT.SUCCESS;
  });
}

export async function runTaskCreate(
  title: string,
  opts: Flags & { assignee?: string; priority?: string; tags?: string },
): Promise<number> {
  if (!title) { render.err("Usage: claudemesh task create <title> [--assignee X] [--priority P]"); return EXIT.INVALID_ARGS; }
  const tags = opts.tags?.split(",").map((s) => s.trim()).filter(Boolean);
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const id = await client.createTask(title, opts.assignee, opts.priority, tags);
    if (!id) { render.err("create failed"); return EXIT.INTERNAL_ERROR; }
    if (opts.json) emitJson({ id, title });
    else render.ok(`created ${dim(id.slice(0, 8))}`, title);
    return EXIT.SUCCESS;
  });
}

// ════════════════════════════════════════════════════════════════════════
// clock — set / pause / resume (get already in broker-actions.ts)
// ════════════════════════════════════════════════════════════════════════

export async function runClockSet(speed: string, opts: Flags): Promise<number> {
  const s = parseFloat(speed);
  if (!Number.isFinite(s) || s < 0) {
    render.err("Usage: claudemesh clock set <speed>", "speed is a non-negative number, e.g. 1.0 = realtime, 0 = paused, 60 = 60× faster");
    return EXIT.INVALID_ARGS;
  }
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const r = await client.setClock(s);
    if (!r) { render.err("clock set failed"); return EXIT.INTERNAL_ERROR; }
    if (opts.json) emitJson(r);
    else render.ok(`clock set to ${bold("x" + r.speed)}`);
    return EXIT.SUCCESS;
  });
}

export async function runClockPause(opts: Flags): Promise<number> {
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const r = await client.pauseClock();
    if (!r) { render.err("pause failed"); return EXIT.INTERNAL_ERROR; }
    if (opts.json) emitJson(r);
    else render.ok("clock paused");
    return EXIT.SUCCESS;
  });
}

export async function runClockResume(opts: Flags): Promise<number> {
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const r = await client.resumeClock();
    if (!r) { render.err("resume failed"); return EXIT.INTERNAL_ERROR; }
    if (opts.json) emitJson(r);
    else render.ok("clock resumed");
    return EXIT.SUCCESS;
  });
}

// ════════════════════════════════════════════════════════════════════════
// mesh-mcp — list deployed mesh-MCP servers, call tools, view catalog
// ════════════════════════════════════════════════════════════════════════

export async function runMeshMcpList(opts: Flags): Promise<number> {
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const servers = await client.mcpList();
    if (opts.json) { emitJson(servers); return EXIT.SUCCESS; }
    if (servers.length === 0) { render.info(dim("(no mesh-MCP servers)")); return EXIT.SUCCESS; }
    render.section(`mesh-MCP servers (${servers.length})`);
    for (const s of servers) {
      process.stdout.write(`  ${bold(s.name)} ${dim("· hosted by " + s.hostedBy)}\n`);
      process.stdout.write(`    ${s.description}\n`);
      if (s.tools.length) process.stdout.write(`    ${dim("tools: " + s.tools.map((t) => t.name).join(", "))}\n`);
    }
    return EXIT.SUCCESS;
  });
}

export async function runMeshMcpCall(
  serverName: string,
  toolName: string,
  argsRaw: string,
  opts: Flags,
): Promise<number> {
  if (!serverName || !toolName) {
    render.err("Usage: claudemesh mesh-mcp call <server> <tool> [json-args]");
    return EXIT.INVALID_ARGS;
  }
  let args: Record<string, unknown> = {};
  if (argsRaw) {
    try { args = JSON.parse(argsRaw) as Record<string, unknown>; }
    catch { render.err("args must be JSON"); return EXIT.INVALID_ARGS; }
  }
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const r = await client.mcpCall(serverName, toolName, args);
    if (r.error) {
      if (opts.json) emitJson({ ok: false, error: r.error });
      else render.err(r.error);
      return EXIT.INTERNAL_ERROR;
    }
    if (opts.json) emitJson({ ok: true, result: r.result });
    else process.stdout.write(JSON.stringify(r.result, null, 2) + "\n");
    return EXIT.SUCCESS;
  });
}

export async function runMeshMcpCatalog(opts: Flags): Promise<number> {
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const cat = await client.mcpCatalog();
    if (opts.json) { emitJson(cat); return EXIT.SUCCESS; }
    if (!cat || cat.length === 0) { render.info(dim("(catalog empty)")); return EXIT.SUCCESS; }
    render.section(`mesh-MCP catalog (${cat.length})`);
    for (const c of cat as Array<Record<string, unknown>>) {
      process.stdout.write(`  ${bold(String(c.name ?? "?"))} ${dim(String(c.status ?? ""))}\n`);
      if (c.description) process.stdout.write(`    ${String(c.description)}\n`);
    }
    return EXIT.SUCCESS;
  });
}

// ════════════════════════════════════════════════════════════════════════
// file — list / status / delete (upload / get-by-name go through MCP for now)
// ════════════════════════════════════════════════════════════════════════

export async function runFileList(opts: Flags & { query?: string }): Promise<number> {
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const files = await client.listFiles(opts.query);
    if (opts.json) { emitJson(files); return EXIT.SUCCESS; }
    if (files.length === 0) { render.info(dim("(no files)")); return EXIT.SUCCESS; }
    render.section(`mesh files (${files.length})`);
    for (const f of files) {
      const sizeKb = (f.size / 1024).toFixed(1);
      process.stdout.write(`  ${bold(f.name)} ${dim(`· ${sizeKb} KB · by ${f.uploadedBy}`)}\n`);
      if (f.tags.length) process.stdout.write(`    ${dim("tags: " + f.tags.join(", "))}\n`);
    }
    return EXIT.SUCCESS;
  });
}

export async function runFileStatus(id: string, opts: Flags): Promise<number> {
  if (!id) { render.err("Usage: claudemesh file status <file-id>"); return EXIT.INVALID_ARGS; }
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const accessors = await client.fileStatus(id);
    if (opts.json) { emitJson(accessors); return EXIT.SUCCESS; }
    if (accessors.length === 0) { render.info(dim("(no accesses recorded)")); return EXIT.SUCCESS; }
    render.section(`accesses for ${id.slice(0, 8)}`);
    for (const a of accessors) process.stdout.write(`  ${bold(a.peerName)} ${dim("· " + a.accessedAt)}\n`);
    return EXIT.SUCCESS;
  });
}

export async function runFileDelete(id: string, opts: Flags): Promise<number> {
  if (!id) { render.err("Usage: claudemesh file delete <file-id>"); return EXIT.INVALID_ARGS; }
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    await client.deleteFile(id);
    if (opts.json) emitJson({ id, deleted: true });
    else render.ok(`deleted ${dim(id.slice(0, 8))}`);
    return EXIT.SUCCESS;
  });
}
