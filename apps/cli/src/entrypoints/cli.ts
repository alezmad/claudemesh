#!/usr/bin/env node
import { parseArgv } from "~/cli/argv.js";
import { installSignalHandlers } from "~/cli/handlers/signal.js";
import { installErrorHandlers } from "~/cli/handlers/error.js";
import { showUpdateNotice } from "~/cli/update-notice.js";
import { VERSION } from "~/constants/urls.js";
import { EXIT } from "~/constants/exit-codes.js";
import { renderVersion } from "~/cli/output/version.js";
import { isInviteUrl, normaliseInviteUrl } from "~/utils/url.js";

installSignalHandlers();
installErrorHandlers();

const { command, positionals, flags } = parseArgv(process.argv);

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
  claudemesh kick <peer>           disconnect a peer (can reconnect)
  claudemesh kick --stale 30m      disconnect idle peers (> duration)
  claudemesh kick --all            disconnect everyone except you
  claudemesh ban <peer>            kick + permanently revoke (can't rejoin)
  claudemesh unban <peer>          lift a ban
  claudemesh bans                  list banned members

Messaging
  claudemesh peers                 see who's online
  claudemesh send <to> <msg>       send a message
  claudemesh inbox                 drain pending messages
  claudemesh state get|set|list    shared state
  claudemesh remember <text>       store a memory
  claudemesh recall <query>        search memories
  claudemesh remind ...            schedule a reminder
  claudemesh profile               view or edit your profile
  claudemesh info                  mesh overview

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
  -y, --yes                        skip confirmations
  -q, --quiet                      suppress non-essential output
`;

async function main(): Promise<void> {
  if (flags.help || flags.h) { console.log(HELP); process.exit(EXIT.SUCCESS); }
  if (flags.version || flags.V) { console.log(renderVersion()); process.exit(EXIT.SUCCESS); }

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
    case "kick": { const { runKick } = await import("~/commands/kick.js"); process.exit(await runKick(positionals[0], { mesh: flags.mesh as string, stale: flags.stale as string, all: !!flags.all })); break; }
    case "ban": { const { runBan } = await import("~/commands/ban.js"); process.exit(await runBan(positionals[0], { mesh: flags.mesh as string })); break; }
    case "unban": { const { runUnban } = await import("~/commands/ban.js"); process.exit(await runUnban(positionals[0], { mesh: flags.mesh as string })); break; }
    case "bans": { const { runBans } = await import("~/commands/ban.js"); process.exit(await runBans({ mesh: flags.mesh as string, json: !!flags.json })); break; }

    // Messaging
    case "peers": { const { runPeers } = await import("~/commands/peers.js"); await runPeers({ mesh: flags.mesh as string, json: !!flags.json }); break; }
    case "send": { const { runSend } = await import("~/commands/send.js"); await runSend({}, positionals[0] ?? "", positionals.slice(1).join(" ")); break; }
    case "inbox": { const { runInbox } = await import("~/commands/inbox.js"); await runInbox({ json: !!flags.json }); break; }
    case "state": {
      const sub = positionals[0];
      if (sub === "set") { const { runStateSet } = await import("~/commands/state.js"); await runStateSet({}, positionals[1] ?? "", positionals[2] ?? ""); }
      else if (sub === "list") { const { runStateList } = await import("~/commands/state.js"); await runStateList({}); }
      else { const { runStateGet } = await import("~/commands/state.js"); await runStateGet({}, positionals[0] ?? ""); }
      break;
    }
    case "info": { const { runInfo } = await import("~/commands/info.js"); await runInfo({}); break; }
    case "remember": { const { remember } = await import("~/commands/remember.js"); process.exit(await remember(positionals.join(" "), { tags: flags.tags as string, json: !!flags.json })); break; }
    case "recall": { const { recall } = await import("~/commands/recall.js"); process.exit(await recall(positionals.join(" "), { json: !!flags.json })); break; }
    case "remind": { const { runRemind } = await import("~/commands/remind.js"); await runRemind({ mesh: flags.mesh as string }, positionals); break; }
    case "profile": { const { runProfile } = await import("~/commands/profile.js"); await runProfile(flags as any); break; }

    // Auth
    case "login": { const { login } = await import("~/commands/login.js"); process.exit(await login()); break; }
    case "register": { const { register } = await import("~/commands/register.js"); process.exit(await register()); break; }
    case "logout": { const { logout } = await import("~/commands/logout.js"); process.exit(await logout()); break; }
    case "whoami": { const { whoami } = await import("~/commands/whoami.js"); process.exit(await whoami({ json: !!flags.json })); break; }

    // Setup
    case "install": { const { runInstall } = await import("~/commands/install.js"); runInstall(positionals); break; }
    case "uninstall": { const { uninstall } = await import("~/commands/uninstall.js"); process.exit(await uninstall()); break; }
    case "doctor": { const { runDoctor } = await import("~/commands/doctor.js"); await runDoctor(); break; }
    case "status": { const { runStatus } = await import("~/commands/status.js"); await runStatus(); break; }
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
