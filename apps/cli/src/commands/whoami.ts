import { whoAmI } from "~/services/auth/facade.js";
import { getSessionInfo } from "~/services/session/resolve.js";
import { render } from "~/ui/render.js";
import { bold, clay, dim, yellow } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

export async function whoami(opts: { json?: boolean }): Promise<number> {
  const result = await whoAmI();
  // 1.32.0+: surface the calling session's identity when whoami is run
  // from inside a `claudemesh launch`-spawned shell. Previously the
  // command only reported web sign-in + local mesh memberships, and a
  // launched session had to dig env vars + parse config.json to figure
  // out its own session pubkey.
  const session = await getSessionInfo();

  if (opts.json) {
    console.log(JSON.stringify({ schema_version: "1.0", ...result, session }, null, 2));
    return result.signed_in || result.local || session ? EXIT.SUCCESS : EXIT.AUTH_FAILED;
  }

  // Show whatever we have. Web session, local mesh config, and the
  // launched-session identity are three independent surfaces.
  if (!result.signed_in && !result.local && !session) {
    render.err("Not signed in", "Run `claudemesh login` to sign in or `claudemesh <invite>` to join.");
    return EXIT.AUTH_FAILED;
  }

  render.section("whoami");

  if (session) {
    const sessionPk = session.presence?.sessionPubkey;
    const groups = (session.groups ?? []).join(", ") || dim("(none)");
    render.kv([
      ["this session", `${yellow(session.displayName)} on ${bold(session.mesh)}`],
      ["session id", dim(session.sessionId)],
      ...(sessionPk
        ? [["session pubkey", dim(`${sessionPk.slice(0, 16)}… (full: ${sessionPk})`)] as [string, string]]
        : []),
      ...(session.role
        ? [["role", session.role] as [string, string]]
        : []),
      ["groups", groups],
      ...(session.cwd ? [["cwd", dim(session.cwd)] as [string, string]] : []),
      ["pid", String(session.pid)],
    ]);
    render.blank();
  }

  if (result.signed_in) {
    render.kv([
      ["user", `${bold(result.user!.display_name)} ${dim(`(${result.user!.email})`)}`],
      ["token", `${result.token_source} ${dim("(~/.claudemesh/auth.json)")}`],
      ...(result.meshes
        ? [["meshes", `${result.meshes.owned} owned · ${result.meshes.guest} guest`] as [string, string]]
        : []),
    ]);
  } else {
    render.kv([
      ["web", dim("not signed in · run `claudemesh login` for account features")],
    ]);
  }
  if (result.local) {
    render.blank();
    render.kv([
      ["local", `${result.local.meshes.length} mesh${result.local.meshes.length === 1 ? "" : "es"} · ${dim(result.local.config_path)}`],
    ]);
    for (const m of result.local.meshes) {
      console.log(`    ${clay("●")} ${bold(m.slug)}  ${dim(`member ${m.member_id.slice(0, 8)}…  pk ${m.pubkey_prefix}…`)}`);
    }
  }
  render.blank();

  return EXIT.SUCCESS;
}
