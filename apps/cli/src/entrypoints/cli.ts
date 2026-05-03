#!/usr/bin/env node
import { parseArgv } from "~/cli/argv.js";
import { installSignalHandlers } from "~/cli/handlers/signal.js";
import { installErrorHandlers } from "~/cli/handlers/error.js";
import { showUpdateNotice } from "~/cli/update-notice.js";
import { VERSION } from "~/constants/urls.js";
import { EXIT } from "~/constants/exit-codes.js";
import { renderVersion } from "~/cli/output/version.js";
import { isInviteUrl, normaliseInviteUrl } from "~/utils/url.js";
import { classifyInvocation } from "~/cli/policy-classify.js";
import { gate, type ApprovalMode } from "~/services/policy/index.js";
import { bold, clay, cyan, dim, orange } from "~/ui/styles.js";

installSignalHandlers();
installErrorHandlers();

const { command, positionals, flags } = parseArgv(process.argv);

/**
 * Resolve the coarse approval mode from CLI flags + env.
 *   --approval-mode <plan|read-only|write|yolo>     explicit
 *   -y / --yes                                       legacy: yolo
 *   $CLAUDEMESH_APPROVAL_MODE                        env override
 *   default                                          'write'
 */
function resolveApprovalMode(): ApprovalMode {
  const raw = (flags["approval-mode"] as string | undefined)
    ?? process.env.CLAUDEMESH_APPROVAL_MODE
    ?? null;
  if (raw === "plan" || raw === "read-only" || raw === "write" || raw === "yolo") return raw;
  if (flags.y || flags.yes) return "yolo";
  return "write";
}

/**
 * Run the policy gate before dispatching a command. Returns `true` if the
 * caller should proceed; on `false`, the process should exit non-zero.
 *
 * Off-mesh commands (help, login, install...) classify as `null` and skip
 * the gate entirely — there's no broker to mutate.
 */
async function policyGate(): Promise<boolean> {
  const cls = classifyInvocation(command, positionals);
  if (!cls) return true;
  const mode = resolveApprovalMode();
  const yes = !!flags.y || !!flags.yes || mode === "yolo";
  const ok = await gate(
    {
      resource: cls.resource,
      verb: cls.verb,
      mesh: flags.mesh as string | undefined,
      mode,
      isWrite: cls.isWrite,
      yes,
    },
    { policyPath: flags.policy as string | undefined },
  );
  return ok;
}

const HELP = `
claudemesh — peer mesh for Claude Code sessions
${VERSION}

USAGE
  claudemesh                                  auto-connect to your mesh
  claudemesh <invite-url>                     join a mesh, then launch
  claudemesh launch --name <n> --join <url>   join + launch in one step

Mesh
  claudemesh create <name>         create a new mesh
  claudemesh join <url>            join a mesh (accepts short /i/ or long /join/ link)
  claudemesh launch [slug]         launch Claude Code on a mesh (alias: connect)
  claudemesh list                  show your meshes (alias: ls)
  claudemesh delete [slug]         delete a mesh (alias: rm)
  claudemesh rename <slug> <name>  rename a mesh
  claudemesh share [email]         share mesh (invite link / send email)

Peer (resource form, recommended)
  claudemesh peer list             see who's online           (alias: peers)
  claudemesh peer kick <p>         end session                (alias: kick)
  claudemesh peer disconnect <p>   soft disconnect            (alias: disconnect)
  claudemesh peer ban <p>          ban + revoke               (alias: ban)
  claudemesh peer unban <p>        lift a ban                 (alias: unban)
  claudemesh peer bans             list banned members        (alias: bans)
  claudemesh peer verify [p]       safety numbers             (alias: verify)

Message  (resource form)
  claudemesh message send <to> <m> send a message            (alias: send)
  claudemesh message inbox         drain pending              (alias: inbox)
  claudemesh message status <id>   delivery status            (alias: msg-status)

Memory  (resource form)
  claudemesh memory remember <txt> store a memory            (alias: remember)
  claudemesh memory recall <q>     search memories            (alias: recall)
  claudemesh memory forget <id>    remove a memory            (alias: forget)

Profile / presence  (resource form)
  claudemesh profile               view or edit profile
  claudemesh profile summary <txt> broadcast summary          (alias: summary)
  claudemesh profile visible y|n   toggle visibility          (alias: visible)
  claudemesh profile status set X  set status idle/working/dnd  (alias: status set)
  claudemesh group join @<name>    join a group (--role X)
  claudemesh group leave @<name>   leave a group

API keys  (REST + external WS auth, v0.2.0)
  claudemesh apikey create <label>  issue [--cap send,read] [--topic deploys]
  claudemesh apikey list             show keys (status, last-used, scope)
  claudemesh apikey revoke <id>      revoke a key

Bridge  (forward a topic between two meshes, v0.2.0)
  claudemesh bridge init             print config template
  claudemesh bridge run <config>     run bridge as a long-lived process

Topic  (conversation scope, v0.2.0)
  claudemesh topic create <name>   create a topic [--description --visibility]
  claudemesh topic list            list topics in the mesh
  claudemesh topic join <topic>    subscribe (via name or id)
  claudemesh topic leave <topic>   unsubscribe
  claudemesh topic members <t>     list topic subscribers
  claudemesh topic history <t>     fetch message history [--limit --before]
  claudemesh topic read <topic>    mark all as read
  claudemesh topic tail <topic>    live SSE tail [--limit --forward-only]
  claudemesh topic post <t> <msg>  encrypted REST post (v0.3.0 v2) [--reply-to <id>]
  claudemesh send "#topic" "msg"   send to a topic (WS path, v1 plaintext)
  claudemesh me                    cross-mesh workspace overview (v0.4.0)
  claudemesh me topics             cross-mesh topic list [--unread]
  claudemesh me notifications      cross-mesh @-mentions [--all] [--since=ISO]
  claudemesh me activity           cross-mesh recent messages [--since=ISO]
  claudemesh member list           mesh roster with online state [--online]
  claudemesh notification list     recent @-mentions of you [--since <ISO>]

Schedule  (resource form)
  claudemesh schedule msg <m>      one-shot or recurring     (alias: remind)
  claudemesh schedule list         list pending
  claudemesh schedule cancel <id>  remove a scheduled item

State / mesh introspection
  claudemesh state get|set|list    shared state
  claudemesh info                  mesh overview
  claudemesh stats                 per-peer activity counters
  claudemesh ping                  diagnostic round-trip

Tasks
  claudemesh task create <title>   create a new task [--assignee --priority --tags]
  claudemesh task list             list tasks [--status --assignee]
  claudemesh task claim <id>       claim an unclaimed task
  claudemesh task complete <id>    mark task done [result]

Platform
  claudemesh vector store|search|delete|collections    embedding store
  claudemesh graph query|execute "<cypher>"            graph operations
  claudemesh context share|get|list                    work-context summaries
  claudemesh stream create|publish|list                pub/sub event bus
  claudemesh sql query|execute|schema                  per-mesh SQL
  claudemesh skill list|get|remove                     mesh-published skills
  claudemesh vault list|delete                         encrypted secrets
  claudemesh watch list|remove                         URL change watchers
  claudemesh webhook list|delete                       outbound HTTP triggers
  claudemesh file list|status|delete                   shared mesh files
  claudemesh mesh-mcp list|call|catalog                deployed mesh-MCP servers
  claudemesh clock set|pause|resume                    mesh logical clock

Auth
  claudemesh login                 sign in (browser or paste token)
  claudemesh register              create account + sign in
  claudemesh logout                sign out
  claudemesh whoami                show current identity

Security
  claudemesh verify [peer]         show ed25519 safety numbers (SAS)
  claudemesh grant <peer> <cap>    grant capability (dm, broadcast, state-read, all)
  claudemesh revoke <peer> <cap>   revoke capability (or 'all')
  claudemesh block <peer>          revoke all capabilities (silent drop)
  claudemesh grants                list per-peer overrides for current mesh
  claudemesh backup [file]         encrypt config → portable recovery file
  claudemesh restore <file>        restore config from a backup file

Setup
  claudemesh install               register MCP server + hooks
  claudemesh uninstall             remove MCP server + hooks
  claudemesh doctor                diagnose issues (broker, node, claude)
  claudemesh status                check broker connectivity
  claudemesh sync                  refresh mesh list from dashboard
  claudemesh completions <shell>   emit bash / zsh / fish completion script
  claudemesh url-handler install   register claudemesh:// click-to-launch
  claudemesh upgrade               self-update to latest alpha (rustup-style)

Flags
  --version, -V                    show version
  --help, -h                       show this help
  --json                           machine-readable output
  --mesh <slug>                    override mesh selection
  --approval-mode <mode>           plan | read-only | write (default) | yolo
  --policy <path>                  override policy file
  -y, --yes                        skip confirmations (= --approval-mode yolo)
  -q, --quiet                      suppress non-essential output
`;

/**
 * Apply color treatment to the HELP block for terminal readability.
 *
 * Strategy is line-based and intentionally conservative:
 * - Section header lines (the title-case categories like `Mesh`,
 *   `Topic`, `Auth`, `USAGE`) get bold + accent.
 * - Each verb row (`  claudemesh <verb> ...`) gets the command tinted
 *   cyan up to the second whitespace gap (separating the syntax from
 *   the description), and any trailing `(alias: ...)` parenthetical
 *   dimmed so it reads as secondary metadata.
 * - The header (program name + version) gets the brand orange.
 *
 * Falls through to plain output when stdout is not a TTY or NO_COLOR
 * is set — the underlying style helpers already gate on that.
 */
function colorizeHelp(raw: string): string {
  const lines = raw.split("\n");
  const SECTION_HEADER_RE = /^([A-Z][A-Za-z0-9 /+-]*?)(\s*\(.*\))?$/;
  const VERB_ROW_RE = /^(\s{2})(claudemesh[^\s]*(?:\s+[^\s]+)*?)(\s{2,})(.*)$/;
  const ALIAS_RE = /(\(alias[^)]*\))/g;
  const out: string[] = [];
  for (const line of lines) {
    if (line.startsWith("claudemesh —")) {
      out.push(orange(line));
      continue;
    }
    if (line.trim() === "") {
      out.push(line);
      continue;
    }
    // Section header: a line with no leading spaces that isn't a verb.
    if (!line.startsWith(" ") && SECTION_HEADER_RE.test(line)) {
      const m = line.match(SECTION_HEADER_RE)!;
      const head = bold(clay(m[1]!));
      const meta = m[2] ? dim(m[2]) : "";
      out.push(head + meta);
      continue;
    }
    // Verb row: tint the syntax, dim the alias parenthetical.
    const verbMatch = line.match(VERB_ROW_RE);
    if (verbMatch) {
      const [, indent, syntax, gap, rest] = verbMatch;
      const dimmedRest = rest!.replace(ALIAS_RE, (m) => dim(m));
      out.push(`${indent}${cyan(syntax!)}${gap}${dimmedRest}`);
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

async function main(): Promise<void> {
  if (flags.help || flags.h) { console.log(colorizeHelp(HELP)); process.exit(EXIT.SUCCESS); }
  if (flags.version || flags.V) { console.log(renderVersion()); process.exit(EXIT.SUCCESS); }

  // Policy gate — runs before any broker-touching command. Skipped for help,
  // version, login/install, list, and other local-only ops via classifier.
  if (!(await policyGate())) process.exit(EXIT.PERMISSION_DENIED);

  // Bare command or invite URL
  if (!command || isInviteUrl(command)) {
    // `claudemesh <invite-url>` → join + launch in one step.
    // `-y` skips all interactive prompts (role=member, no groups, push mode).
    if (command && isInviteUrl(command)) {
      const { runLaunch } = await import("~/commands/launch.js");
      await runLaunch({
        mesh: flags.mesh as string | undefined,
        name: flags.name as string | undefined,
        join: normaliseInviteUrl(command),
        yes: !!flags.y || !!flags.yes,
        resume: flags.resume as string | undefined,
      }, process.argv.slice(2));
      return;
    }
    const { readConfig } = await import("~/services/config/facade.js");
    const config = readConfig();
    if (config.meshes.length === 0) {
      const { runWelcome } = await import("~/commands/welcome.js");
      process.exit(await runWelcome());
    }
    const { runLaunch } = await import("~/commands/launch.js");
    await runLaunch({
      mesh: flags.mesh as string | undefined,
      name: flags.name as string | undefined,
      yes: !!flags.y || !!flags.yes,
      resume: flags.resume as string | undefined,
    }, process.argv.slice(2));
    return;
  }

  switch (command) {
    case "help": { console.log(HELP); break; }

    // Mesh management
    case "create": case "new": { const { newMesh } = await import("~/commands/new.js"); process.exit(await newMesh(positionals[0] ?? "", { json: !!flags.json })); break; }
    case "add": case "join": { const { runJoin } = await import("~/commands/join.js"); await runJoin(positionals); break; }
    case "connect": case "launch": {
      const { runLaunch } = await import("~/commands/launch.js");
      await runLaunch({
        mesh: positionals[0] ?? flags.mesh as string,
        name: flags.name as string,
        join: flags.join as string,
        yes: !!flags.y || !!flags.yes,
        resume: flags.resume as string,
      }, process.argv.slice(2));
      break;
    }
    case "disconnect": { console.log("  Connection closed."); process.exit(EXIT.SUCCESS); break; }
    case "list": case "ls": { const { runList } = await import("~/commands/list.js"); await runList(); break; }
    case "delete": case "rm": { const { deleteMesh } = await import("~/commands/delete-mesh.js"); process.exit(await deleteMesh(positionals[0] ?? "", { yes: !!flags.y || !!flags.yes })); break; }
    case "rename": { const { rename } = await import("~/commands/rename.js"); process.exit(await rename(positionals[0] ?? "", positionals[1] ?? "")); break; }
    case "share": case "invite": { const { invite } = await import("~/commands/invite.js"); process.exit(await invite(positionals[0], { mesh: flags.mesh as string, json: !!flags.json })); break; }
    case "disconnect": { const { runDisconnect } = await import("~/commands/kick.js"); process.exit(await runDisconnect(positionals[0], { mesh: flags.mesh as string, stale: flags.stale as string, all: !!flags.all })); break; }
    case "kick": { const { runKick } = await import("~/commands/kick.js"); process.exit(await runKick(positionals[0], { mesh: flags.mesh as string, stale: flags.stale as string, all: !!flags.all })); break; }
    case "ban": { const { runBan } = await import("~/commands/ban.js"); process.exit(await runBan(positionals[0], { mesh: flags.mesh as string })); break; }
    case "unban": { const { runUnban } = await import("~/commands/ban.js"); process.exit(await runUnban(positionals[0], { mesh: flags.mesh as string })); break; }
    case "bans": { const { runBans } = await import("~/commands/ban.js"); process.exit(await runBans({ mesh: flags.mesh as string, json: !!flags.json })); break; }

    // Messaging
    case "peers": { const { runPeers } = await import("~/commands/peers.js"); await runPeers({ mesh: flags.mesh as string, json: flags.json as boolean | string | undefined }); break; }
    case "send": { const { runSend } = await import("~/commands/send.js"); await runSend({ mesh: flags.mesh as string, priority: flags.priority as string, json: !!flags.json }, positionals[0] ?? "", positionals.slice(1).join(" ")); break; }
    case "inbox": { const { runInbox } = await import("~/commands/inbox.js"); await runInbox({ json: !!flags.json }); break; }
    case "state": {
      const sub = positionals[0];
      if (sub === "set") { const { runStateSet } = await import("~/commands/state.js"); await runStateSet({}, positionals[1] ?? "", positionals[2] ?? ""); }
      else if (sub === "list") { const { runStateList } = await import("~/commands/state.js"); await runStateList({}); }
      else { const { runStateGet } = await import("~/commands/state.js"); await runStateGet({}, positionals[0] ?? ""); }
      break;
    }
    case "info": { const { runInfo } = await import("~/commands/info.js"); await runInfo({}); break; }
    case "remember": { const { remember } = await import("~/commands/remember.js"); process.exit(await remember(positionals.join(" "), { mesh: flags.mesh as string, tags: flags.tags as string, json: !!flags.json })); break; }
    case "recall": { const { recall } = await import("~/commands/recall.js"); process.exit(await recall(positionals.join(" "), { mesh: flags.mesh as string, json: !!flags.json })); break; }
    case "forget": { const { runForget } = await import("~/commands/broker-actions.js"); process.exit(await runForget(positionals[0], { mesh: flags.mesh as string, json: !!flags.json })); break; }
    case "remind": { const { runRemind } = await import("~/commands/remind.js"); await runRemind({ mesh: flags.mesh as string }, positionals); break; }
    // (profile case moved to resource-aliases block below for sub-command extensibility)

    // Profile / status / visibility / groups (replacing soft-deprecated MCP tools)
    case "summary": { const { runSummary } = await import("~/commands/broker-actions.js"); process.exit(await runSummary(positionals.join(" "), { mesh: flags.mesh as string, json: !!flags.json })); break; }
    case "visible": { const { runVisible } = await import("~/commands/broker-actions.js"); process.exit(await runVisible(positionals[0], { mesh: flags.mesh as string, json: !!flags.json })); break; }
    case "group": {
      const sub = positionals[0];
      if (sub === "join") { const { runGroupJoin } = await import("~/commands/broker-actions.js"); process.exit(await runGroupJoin(positionals[1], { mesh: flags.mesh as string, role: flags.role as string, json: !!flags.json })); }
      else if (sub === "leave") { const { runGroupLeave } = await import("~/commands/broker-actions.js"); process.exit(await runGroupLeave(positionals[1], { mesh: flags.mesh as string, json: !!flags.json })); }
      else { console.error("Usage: claudemesh group <join|leave> @<name> [--role X]"); process.exit(EXIT.INVALID_ARGS); }
      break;
    }

    // Mesh diagnostics + tasks
    case "msg-status": { const { runMsgStatus } = await import("~/commands/broker-actions.js"); process.exit(await runMsgStatus(positionals[0], { mesh: flags.mesh as string, json: !!flags.json })); break; }
    case "stats": { const { runStats } = await import("~/commands/broker-actions.js"); process.exit(await runStats({ mesh: flags.mesh as string, json: !!flags.json })); break; }
    case "ping": { const { runPing } = await import("~/commands/broker-actions.js"); process.exit(await runPing({ mesh: flags.mesh as string, json: !!flags.json })); break; }
    // (clock + task moved to platform-actions block below for sub-command extensibility)

    // Auth
    case "login": { const { login } = await import("~/commands/login.js"); process.exit(await login()); break; }
    case "register": { const { register } = await import("~/commands/register.js"); process.exit(await register()); break; }
    case "logout": { const { logout } = await import("~/commands/logout.js"); process.exit(await logout()); break; }
    case "whoami": { const { whoami } = await import("~/commands/whoami.js"); process.exit(await whoami({ json: !!flags.json })); break; }

    // Setup
    case "install": { const { runInstall } = await import("~/commands/install.js"); runInstall(positionals); break; }
    case "uninstall": { const { uninstall } = await import("~/commands/uninstall.js"); process.exit(await uninstall()); break; }
    case "doctor": { const { runDoctor } = await import("~/commands/doctor.js"); await runDoctor(); break; }
    case "status": {
      // `claudemesh status set <state>` → set peer status (idle/working/dnd)
      // `claudemesh status` (no args) → broker connectivity diagnostic
      if (positionals[0] === "set") {
        const { runStatusSet } = await import("~/commands/broker-actions.js");
        process.exit(await runStatusSet(positionals[1] ?? "", { mesh: flags.mesh as string, json: !!flags.json }));
      } else {
        const { runStatus } = await import("~/commands/status.js");
        await runStatus();
      }
      break;
    }
    case "sync": { const { runSync } = await import("~/commands/sync.js"); await runSync({ force: !!flags.force }); break; }

    // Test
    case "test": { const { runTest } = await import("~/commands/test.js"); process.exit(await runTest()); break; }

    // CLI utilities
    case "completions": { const { runCompletions } = await import("~/commands/completions.js"); process.exit(await runCompletions(positionals[0])); break; }
    case "verify": { const { runVerify } = await import("~/commands/verify.js"); process.exit(await runVerify(positionals[0], { mesh: flags.mesh as string | undefined, json: !!flags.json })); break; }
    case "url-handler": { const { runUrlHandler } = await import("~/commands/url-handler.js"); process.exit(await runUrlHandler(positionals[0])); break; }
    case "status-line": { const { runStatusLine } = await import("~/commands/status-line.js"); process.exit(await runStatusLine()); break; }
    case "backup": { const { runBackup } = await import("~/commands/backup.js"); process.exit(await runBackup(positionals[0])); break; }
    case "restore": { const { runRestore } = await import("~/commands/backup.js"); process.exit(await runRestore(positionals[0])); break; }
    case "upgrade": case "update": { const { runUpgrade } = await import("~/commands/upgrade.js"); process.exit(await runUpgrade({ check: !!flags.check, yes: !!flags.y || !!flags.yes })); break; }
    case "grant": { const { runGrant } = await import("~/commands/grants.js"); process.exit(await runGrant(positionals[0], positionals.slice(1), { mesh: flags.mesh as string | undefined })); break; }
    case "revoke": { const { runRevoke } = await import("~/commands/grants.js"); process.exit(await runRevoke(positionals[0], positionals.slice(1), { mesh: flags.mesh as string | undefined })); break; }
    case "block": { const { runBlock } = await import("~/commands/grants.js"); process.exit(await runBlock(positionals[0], { mesh: flags.mesh as string | undefined })); break; }
    case "grants": { const { runGrants } = await import("~/commands/grants.js"); process.exit(await runGrants({ mesh: flags.mesh as string | undefined, json: !!flags.json })); break; }

    // ── Resource-model aliases (1.4.0) ─────────────────────────────────
    // Each `<resource> <verb>` form proxies to the existing legacy verb.
    // The legacy verbs (`send`, `peers`, `kick`, `remember`, ...) keep
    // working so old scripts never break. Spec: 2026-05-02 commitment #2.

    case "peer": {
      const sub = positionals[0];
      const f = { mesh: flags.mesh as string, json: flags.json as boolean | string | undefined };
      const id = positionals[1] ?? "";
      if (sub === "list") { const { runPeers } = await import("~/commands/peers.js"); await runPeers(f); }
      else if (sub === "kick") { const { runKick } = await import("~/commands/kick.js"); process.exit(await runKick(id, { mesh: flags.mesh as string, stale: flags.stale as string, all: !!flags.all })); }
      else if (sub === "disconnect") { const { runDisconnect } = await import("~/commands/kick.js"); process.exit(await runDisconnect(id, { mesh: flags.mesh as string, stale: flags.stale as string, all: !!flags.all })); }
      else if (sub === "ban") { const { runBan } = await import("~/commands/ban.js"); process.exit(await runBan(id, { mesh: flags.mesh as string })); }
      else if (sub === "unban") { const { runUnban } = await import("~/commands/ban.js"); process.exit(await runUnban(id, { mesh: flags.mesh as string })); }
      else if (sub === "bans") { const { runBans } = await import("~/commands/ban.js"); process.exit(await runBans({ mesh: flags.mesh as string, json: !!flags.json })); }
      else if (sub === "verify") { const { runVerify } = await import("~/commands/verify.js"); process.exit(await runVerify(id || undefined, { mesh: flags.mesh as string, json: !!flags.json })); }
      else { console.error("Usage: claudemesh peer <list|kick|disconnect|ban|unban|bans|verify>"); process.exit(EXIT.INVALID_ARGS); }
      break;
    }

    case "message": {
      const sub = positionals[0];
      if (sub === "send") { const { runSend } = await import("~/commands/send.js"); await runSend({ mesh: flags.mesh as string, priority: flags.priority as string, json: !!flags.json }, positionals[1] ?? "", positionals.slice(2).join(" ")); }
      else if (sub === "inbox") { const { runInbox } = await import("~/commands/inbox.js"); await runInbox({ json: !!flags.json }); }
      else if (sub === "status") { const { runMsgStatus } = await import("~/commands/broker-actions.js"); process.exit(await runMsgStatus(positionals[1], { mesh: flags.mesh as string, json: !!flags.json })); }
      else { console.error("Usage: claudemesh message <send|inbox|status>"); process.exit(EXIT.INVALID_ARGS); }
      break;
    }

    case "memory": {
      const sub = positionals[0];
      const f = { mesh: flags.mesh as string, json: !!flags.json };
      if (sub === "remember") { const { remember } = await import("~/commands/remember.js"); process.exit(await remember(positionals.slice(1).join(" "), { ...f, tags: flags.tags as string })); }
      else if (sub === "recall") { const { recall } = await import("~/commands/recall.js"); process.exit(await recall(positionals.slice(1).join(" "), f)); }
      else if (sub === "forget") { const { runForget } = await import("~/commands/broker-actions.js"); process.exit(await runForget(positionals[1], f)); }
      else { console.error("Usage: claudemesh memory <remember|recall|forget>"); process.exit(EXIT.INVALID_ARGS); }
      break;
    }

    case "profile": {
      const sub = positionals[0];
      // `claudemesh profile` (no sub) → existing runProfile (interactive view/edit)
      // `claudemesh profile summary "x"` → set summary
      // `claudemesh profile visible true` → set visibility
      // `claudemesh profile status set <state>` → set peer status
      if (!sub) { const { runProfile } = await import("~/commands/profile.js"); await runProfile(flags as any); }
      else if (sub === "summary") { const { runSummary } = await import("~/commands/broker-actions.js"); process.exit(await runSummary(positionals.slice(1).join(" "), { mesh: flags.mesh as string, json: !!flags.json })); }
      else if (sub === "visible") { const { runVisible } = await import("~/commands/broker-actions.js"); process.exit(await runVisible(positionals[1], { mesh: flags.mesh as string, json: !!flags.json })); }
      else if (sub === "status") {
        // `profile status` (no further sub) → diagnostic via runStatus
        // `profile status set <state>` → set peer status
        if (positionals[1] === "set") { const { runStatusSet } = await import("~/commands/broker-actions.js"); process.exit(await runStatusSet(positionals[2] ?? "", { mesh: flags.mesh as string, json: !!flags.json })); }
        else { const { runStatus } = await import("~/commands/status.js"); await runStatus(); }
      }
      else { console.error("Usage: claudemesh profile [summary|visible|status]"); process.exit(EXIT.INVALID_ARGS); }
      break;
    }

    case "schedule": {
      // Aliases `remind` and its subcommands under a unified `schedule` verb.
      // The unified `schedule webhook/tool` primitives need broker work and
      // arrive in a later release — for now `schedule` only covers msg-style.
      const sub = positionals[0];
      if (sub === "msg" || sub === "remind" || sub === undefined || sub === "list" || sub === "cancel") {
        const { runRemind } = await import("~/commands/remind.js");
        // Translate `schedule msg ...` and bare `schedule list/cancel` into
        // the legacy remind positional layout.
        const remindPositionals =
          sub === "msg"  ? positionals.slice(1)
          : sub === "remind" ? positionals.slice(1)
          : positionals; // list / cancel / undefined
        await runRemind({ mesh: flags.mesh as string, in: flags.in as string, at: flags.at as string, cron: flags.cron as string, to: flags.to as string, json: !!flags.json }, remindPositionals);
      }
      else if (sub === "webhook" || sub === "tool") {
        console.error(`  schedule ${sub} arrives in a later release — broker primitive not yet shipped`);
        process.exit(EXIT.INVALID_ARGS);
      }
      else { console.error("Usage: claudemesh schedule <msg|list|cancel>"); process.exit(EXIT.INVALID_ARGS); }
      break;
    }

    // Platform — vector / graph / context / stream / sql / skill / vault / watch / webhook / file / mesh-mcp
    case "vector": {
      const sub = positionals[0];
      const f = { mesh: flags.mesh as string, json: !!flags.json };
      if (sub === "store") { const { runVectorStore } = await import("~/commands/platform-actions.js"); process.exit(await runVectorStore(positionals[1] ?? "", positionals.slice(2).join(" "), { ...f, metadata: flags.metadata as string })); }
      else if (sub === "search") { const { runVectorSearch } = await import("~/commands/platform-actions.js"); process.exit(await runVectorSearch(positionals[1] ?? "", positionals.slice(2).join(" "), { ...f, limit: flags.limit as string })); }
      else if (sub === "delete") { const { runVectorDelete } = await import("~/commands/platform-actions.js"); process.exit(await runVectorDelete(positionals[1] ?? "", positionals[2] ?? "", f)); }
      else if (sub === "collections") { const { runVectorCollections } = await import("~/commands/platform-actions.js"); process.exit(await runVectorCollections(f)); }
      else { console.error("Usage: claudemesh vector <store|search|delete|collections>"); process.exit(EXIT.INVALID_ARGS); }
      break;
    }
    case "graph": {
      const sub = positionals[0];
      const f = { mesh: flags.mesh as string, json: !!flags.json };
      if (sub === "query") { const { runGraphQuery } = await import("~/commands/platform-actions.js"); process.exit(await runGraphQuery(positionals.slice(1).join(" "), f)); }
      else if (sub === "execute") { const { runGraphExecute } = await import("~/commands/platform-actions.js"); process.exit(await runGraphExecute(positionals.slice(1).join(" "), f)); }
      else { console.error("Usage: claudemesh graph <query|execute> \"<cypher>\""); process.exit(EXIT.INVALID_ARGS); }
      break;
    }
    case "context": {
      const sub = positionals[0];
      const f = { mesh: flags.mesh as string, json: !!flags.json };
      if (sub === "share") { const { runContextShare } = await import("~/commands/platform-actions.js"); process.exit(await runContextShare(positionals.slice(1).join(" "), { ...f, files: flags.files as string, findings: flags.findings as string, tags: flags.tags as string })); }
      else if (sub === "get") { const { runContextGet } = await import("~/commands/platform-actions.js"); process.exit(await runContextGet(positionals.slice(1).join(" "), f)); }
      else if (sub === "list") { const { runContextList } = await import("~/commands/platform-actions.js"); process.exit(await runContextList(f)); }
      else { console.error("Usage: claudemesh context <share|get|list>"); process.exit(EXIT.INVALID_ARGS); }
      break;
    }
    case "stream": {
      const sub = positionals[0];
      const f = { mesh: flags.mesh as string, json: !!flags.json };
      if (sub === "create") { const { runStreamCreate } = await import("~/commands/platform-actions.js"); process.exit(await runStreamCreate(positionals[1] ?? "", f)); }
      else if (sub === "publish") { const { runStreamPublish } = await import("~/commands/platform-actions.js"); process.exit(await runStreamPublish(positionals[1] ?? "", positionals.slice(2).join(" "), f)); }
      else if (sub === "list") { const { runStreamList } = await import("~/commands/platform-actions.js"); process.exit(await runStreamList(f)); }
      else { console.error("Usage: claudemesh stream <create|publish|list>"); process.exit(EXIT.INVALID_ARGS); }
      break;
    }
    case "sql": {
      const sub = positionals[0];
      const f = { mesh: flags.mesh as string, json: !!flags.json };
      if (sub === "query") { const { runSqlQuery } = await import("~/commands/platform-actions.js"); process.exit(await runSqlQuery(positionals.slice(1).join(" "), f)); }
      else if (sub === "execute") { const { runSqlExecute } = await import("~/commands/platform-actions.js"); process.exit(await runSqlExecute(positionals.slice(1).join(" "), f)); }
      else if (sub === "schema") { const { runSqlSchema } = await import("~/commands/platform-actions.js"); process.exit(await runSqlSchema(f)); }
      else { console.error("Usage: claudemesh sql <query|execute|schema>"); process.exit(EXIT.INVALID_ARGS); }
      break;
    }
    case "skill": {
      const sub = positionals[0];
      const f = { mesh: flags.mesh as string, json: !!flags.json };
      if (sub === "list") { const { runSkillList } = await import("~/commands/platform-actions.js"); process.exit(await runSkillList({ ...f, query: positionals[1] })); }
      else if (sub === "get") { const { runSkillGet } = await import("~/commands/platform-actions.js"); process.exit(await runSkillGet(positionals[1] ?? "", f)); }
      else if (sub === "remove") { const { runSkillRemove } = await import("~/commands/platform-actions.js"); process.exit(await runSkillRemove(positionals[1] ?? "", f)); }
      else { console.error("Usage: claudemesh skill <list|get|remove>"); process.exit(EXIT.INVALID_ARGS); }
      break;
    }
    case "vault": {
      const sub = positionals[0];
      const f = { mesh: flags.mesh as string, json: !!flags.json };
      if (sub === "list") { const { runVaultList } = await import("~/commands/platform-actions.js"); process.exit(await runVaultList(f)); }
      else if (sub === "delete") { const { runVaultDelete } = await import("~/commands/platform-actions.js"); process.exit(await runVaultDelete(positionals[1] ?? "", f)); }
      else { console.error("Usage: claudemesh vault <list|delete>  (set/get currently via MCP — needs crypto)"); process.exit(EXIT.INVALID_ARGS); }
      break;
    }
    case "watch": {
      const sub = positionals[0];
      const f = { mesh: flags.mesh as string, json: !!flags.json };
      if (sub === "list") { const { runWatchList } = await import("~/commands/platform-actions.js"); process.exit(await runWatchList(f)); }
      else if (sub === "remove") { const { runUnwatch } = await import("~/commands/platform-actions.js"); process.exit(await runUnwatch(positionals[1] ?? "", f)); }
      else { console.error("Usage: claudemesh watch <list|remove>"); process.exit(EXIT.INVALID_ARGS); }
      break;
    }
    case "webhook": {
      const sub = positionals[0];
      const f = { mesh: flags.mesh as string, json: !!flags.json };
      if (sub === "list") { const { runWebhookList } = await import("~/commands/platform-actions.js"); process.exit(await runWebhookList(f)); }
      else if (sub === "delete") { const { runWebhookDelete } = await import("~/commands/platform-actions.js"); process.exit(await runWebhookDelete(positionals[1] ?? "", f)); }
      else { console.error("Usage: claudemesh webhook <list|delete>"); process.exit(EXIT.INVALID_ARGS); }
      break;
    }
    case "file": {
      const sub = positionals[0];
      const f = { mesh: flags.mesh as string, json: !!flags.json };
      if (sub === "list") { const { runFileList } = await import("~/commands/platform-actions.js"); process.exit(await runFileList({ ...f, query: positionals[1] })); }
      else if (sub === "status") { const { runFileStatus } = await import("~/commands/platform-actions.js"); process.exit(await runFileStatus(positionals[1] ?? "", f)); }
      else if (sub === "delete") { const { runFileDelete } = await import("~/commands/platform-actions.js"); process.exit(await runFileDelete(positionals[1] ?? "", f)); }
      else { console.error("Usage: claudemesh file <list|status|delete>"); process.exit(EXIT.INVALID_ARGS); }
      break;
    }
    case "mesh-mcp": {
      const sub = positionals[0];
      const f = { mesh: flags.mesh as string, json: !!flags.json };
      if (sub === "list") { const { runMeshMcpList } = await import("~/commands/platform-actions.js"); process.exit(await runMeshMcpList(f)); }
      else if (sub === "call") { const { runMeshMcpCall } = await import("~/commands/platform-actions.js"); process.exit(await runMeshMcpCall(positionals[1] ?? "", positionals[2] ?? "", positionals.slice(3).join(" "), f)); }
      else if (sub === "catalog") { const { runMeshMcpCatalog } = await import("~/commands/platform-actions.js"); process.exit(await runMeshMcpCatalog(f)); }
      else { console.error("Usage: claudemesh mesh-mcp <list|call|catalog>"); process.exit(EXIT.INVALID_ARGS); }
      break;
    }
    case "clock": {
      const sub = positionals[0];
      const f = { mesh: flags.mesh as string, json: !!flags.json };
      if (sub === "set") { const { runClockSet } = await import("~/commands/platform-actions.js"); process.exit(await runClockSet(positionals[1] ?? "", f)); }
      else if (sub === "pause") { const { runClockPause } = await import("~/commands/platform-actions.js"); process.exit(await runClockPause(f)); }
      else if (sub === "resume") { const { runClockResume } = await import("~/commands/platform-actions.js"); process.exit(await runClockResume(f)); }
      else { const { runClock } = await import("~/commands/broker-actions.js"); process.exit(await runClock(f)); }
      break;
    }

    // bridge — forward a topic between two meshes (v0.2.0)
    case "bridge": {
      const sub = positionals[0];
      if (sub === "run") {
        const { runBridge } = await import("~/commands/bridge.js");
        process.exit(await runBridge(positionals[1] ?? ""));
      } else if (sub === "init" || sub === "config") {
        const { bridgeConfigTemplate } = await import("~/commands/bridge.js");
        console.log(bridgeConfigTemplate());
        process.exit(EXIT.SUCCESS);
      } else {
        console.error("Usage: claudemesh bridge <run <config.yaml> | init>");
        process.exit(EXIT.INVALID_ARGS);
      }
      break;
    }

    // apikey — REST + external WS bearer tokens (v0.2.0)
    case "apikey": case "api-key": {
      const sub = positionals[0];
      const f = {
        mesh: flags.mesh as string,
        json: !!flags.json,
        cap: flags.cap as string,
        topic: flags.topic as string,
        expires: flags.expires as string,
      };
      const arg = positionals[1] ?? "";
      if (sub === "create") { const { runApiKeyCreate } = await import("~/commands/apikey.js"); process.exit(await runApiKeyCreate(arg, f)); }
      else if (sub === "list") { const { runApiKeyList } = await import("~/commands/apikey.js"); process.exit(await runApiKeyList(f)); }
      else if (sub === "revoke") { const { runApiKeyRevoke } = await import("~/commands/apikey.js"); process.exit(await runApiKeyRevoke(arg, f)); }
      else { console.error("Usage: claudemesh apikey <create|list|revoke>"); process.exit(EXIT.INVALID_ARGS); }
      break;
    }

    // topic — conversational primitive within a mesh (v0.2.0)
    case "topic": {
      const sub = positionals[0];
      const f = {
        mesh: flags.mesh as string,
        json: !!flags.json,
        description: flags.description as string,
        visibility: flags.visibility as "public" | "private" | "dm" | undefined,
        role: flags.role as "lead" | "member" | "observer" | undefined,
        limit: flags.limit as string | undefined,
        before: flags.before as string | undefined,
      };
      const arg = positionals[1] ?? "";
      if (sub === "create") { const { runTopicCreate } = await import("~/commands/topic.js"); process.exit(await runTopicCreate(arg, f)); }
      else if (sub === "list") { const { runTopicList } = await import("~/commands/topic.js"); process.exit(await runTopicList(f)); }
      else if (sub === "join") { const { runTopicJoin } = await import("~/commands/topic.js"); process.exit(await runTopicJoin(arg, f)); }
      else if (sub === "leave") { const { runTopicLeave } = await import("~/commands/topic.js"); process.exit(await runTopicLeave(arg, f)); }
      else if (sub === "members") { const { runTopicMembers } = await import("~/commands/topic.js"); process.exit(await runTopicMembers(arg, f)); }
      else if (sub === "history") { const { runTopicHistory } = await import("~/commands/topic.js"); process.exit(await runTopicHistory(arg, f)); }
      else if (sub === "read") { const { runTopicMarkRead } = await import("~/commands/topic.js"); process.exit(await runTopicMarkRead(arg, f)); }
      else if (sub === "tail") {
        const tailFlags = {
          mesh: flags.mesh as string,
          json: !!flags.json,
          limit: flags.limit as string | undefined,
          forwardOnly: !!flags["forward-only"],
        };
        const { runTopicTail } = await import("~/commands/topic-tail.js");
        process.exit(await runTopicTail(arg, tailFlags));
      }
      else if (sub === "post") {
        const postFlags = {
          mesh: flags.mesh as string,
          json: !!flags.json,
          plaintext: !!flags.plaintext,
          replyTo: (flags["reply-to"] as string) || (flags.replyTo as string),
        };
        const message = positionals.slice(2).join(" ");
        const { runTopicPost } = await import("~/commands/topic-post.js");
        process.exit(await runTopicPost(arg, message, postFlags));
      }
      else { console.error("Usage: claudemesh topic <create|list|join|leave|members|history|read|tail|post>"); process.exit(EXIT.INVALID_ARGS); }
      break;
    }

    // notification — recent @-mentions of the viewer (v1.7.0)
    case "notification": case "notifications": {
      const sub = positionals[0] ?? "list";
      const f = {
        mesh: flags.mesh as string,
        json: !!flags.json,
        since: flags.since as string,
      };
      if (sub === "list") {
        const { runNotificationList } = await import("~/commands/notification.js");
        process.exit(await runNotificationList(f));
      } else {
        console.error("Usage: claudemesh notification list [--since <ISO>]");
        process.exit(EXIT.INVALID_ARGS);
      }
      break;
    }

    // me — cross-mesh workspace overview (v0.4.0)
    case "me": {
      const sub = positionals[0];
      const f = {
        mesh: flags.mesh as string,
        json: !!flags.json,
      };
      if (!sub || sub === "workspace" || sub === "overview") {
        const { runMe } = await import("~/commands/me.js");
        process.exit(await runMe(f));
      } else if (sub === "topics") {
        const { runMeTopics } = await import("~/commands/me.js");
        process.exit(await runMeTopics({ ...f, unread: !!flags.unread }));
      } else if (sub === "notifications" || sub === "notifs") {
        const { runMeNotifications } = await import("~/commands/me.js");
        process.exit(
          await runMeNotifications({
            ...f,
            all: !!flags.all,
            since: flags.since as string | undefined,
          }),
        );
      } else if (sub === "activity") {
        const { runMeActivity } = await import("~/commands/me.js");
        process.exit(
          await runMeActivity({
            ...f,
            since: flags.since as string | undefined,
          }),
        );
      } else {
        console.error(
          "Usage: claudemesh me                   (cross-mesh overview)\n" +
            "       claudemesh me topics            (cross-mesh topic list)\n" +
            "       claudemesh me topics --unread   (only unread topics)\n" +
            "       claudemesh me notifications     (unread @-mentions, last 7d)\n" +
            "       claudemesh me notifications --all       (include already-read)\n" +
            "       claudemesh me notifications --since=ISO (custom window)\n" +
            "       claudemesh me activity          (recent messages, last 24h)\n" +
            "       claudemesh me activity --since=ISO      (custom window)",
        );
        process.exit(EXIT.INVALID_ARGS);
      }
      break;
    }

    // member — mesh roster with online state (v1.7.0)
    case "member": case "members": {
      const sub = positionals[0] ?? "list";
      const f = {
        mesh: flags.mesh as string,
        json: !!flags.json,
        online: !!flags.online,
      };
      if (sub === "list") {
        const { runMemberList } = await import("~/commands/member.js");
        process.exit(await runMemberList(f));
      } else {
        console.error("Usage: claudemesh member list [--online]");
        process.exit(EXIT.INVALID_ARGS);
      }
      break;
    }

    // task — extends broker-actions.ts (claim/complete) with list/create
    case "task": {
      const sub = positionals[0];
      const f = { mesh: flags.mesh as string, json: !!flags.json };
      if (sub === "claim") { const { runTaskClaim } = await import("~/commands/broker-actions.js"); process.exit(await runTaskClaim(positionals[1], f)); }
      else if (sub === "complete") { const { runTaskComplete } = await import("~/commands/broker-actions.js"); process.exit(await runTaskComplete(positionals[1], positionals.slice(2).join(" ") || undefined, f)); }
      else if (sub === "list") { const { runTaskList } = await import("~/commands/platform-actions.js"); process.exit(await runTaskList({ ...f, status: flags.status as string, assignee: flags.assignee as string })); }
      else if (sub === "create") { const { runTaskCreate } = await import("~/commands/platform-actions.js"); process.exit(await runTaskCreate(positionals.slice(1).join(" "), { ...f, assignee: flags.assignee as string, priority: flags.priority as string, tags: flags.tags as string })); }
      else { console.error("Usage: claudemesh task <create|list|claim|complete>"); process.exit(EXIT.INVALID_ARGS); }
      break;
    }

    // Internal
    case "mcp": { const { runMcp } = await import("~/commands/mcp.js"); await runMcp(); break; }
    case "hook": { const { runHook } = await import("~/commands/hook.js"); await runHook(positionals); break; }
    case "seed-test-mesh": { const { runSeedTestMesh } = await import("~/commands/seed-test-mesh.js"); runSeedTestMesh(positionals); break; }

    default: {
      console.error(`  Unknown command: ${command}. Run \`claudemesh --help\` for usage.`);
      process.exit(EXIT.INVALID_ARGS);
    }
  }

  showUpdateNotice(VERSION).catch(() => {});
}

main().catch((err) => {
  console.error("Fatal: " + (err instanceof Error ? err.message : String(err)));
  process.exit(EXIT.INTERNAL_ERROR);
});
