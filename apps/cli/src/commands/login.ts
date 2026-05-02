import { createInterface } from "node:readline";
import { loginWithDeviceCode, getStoredToken, clearToken, storeToken } from "~/services/auth/facade.js";
import { my } from "~/services/api/facade.js";
import { render } from "~/ui/render.js";
import { bold, dim } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";
import { URLS } from "~/constants/urls.js";

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

async function loginWithToken(): Promise<number> {
  render.blank();
  render.info(`Paste a token from ${dim(URLS.API_BASE + "/token")}`);
  render.info(dim("Generate one in your browser, then paste it here."));
  render.blank();

  const token = await prompt("  Token: ");
  if (!token) {
    render.err("No token provided.");
    return EXIT.AUTH_FAILED;
  }

  let user = { id: "", display_name: "", email: "" };
  try {
    const parts = token.split(".");
    if (parts[1]) {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as {
        sub?: string; email?: string; name?: string; exp?: number;
      };
      if (payload.exp && payload.exp < Date.now() / 1000) {
        render.err("Token expired.", "Generate a new one.");
        return EXIT.AUTH_FAILED;
      }
      user = {
        id: payload.sub ?? "",
        display_name: payload.name ?? payload.email ?? "",
        email: payload.email ?? "",
      };
    }
  } catch {
    render.err("Invalid token format.");
    return EXIT.AUTH_FAILED;
  }

  storeToken({ session_token: token, user, token_source: "manual" });
  render.ok(`signed in as ${bold(user.display_name || user.email || "user")}`);
  return EXIT.SUCCESS;
}

async function syncMeshes(token: string): Promise<void> {
  try {
    const meshes = await my.getMeshes(token);
    if (meshes.length > 0) {
      const names = meshes.map((m) => m.slug).join(", ");
      render.ok(`synced ${meshes.length} mesh${meshes.length === 1 ? "" : "es"}`, names);
    }
  } catch {}
}

export async function login(): Promise<number> {
  const existing = getStoredToken();
  if (existing) {
    const name = existing.user.display_name || existing.user.email || "unknown";
    render.blank();
    render.info(`Already signed in as ${bold(name)}.`);
    render.blank();
    process.stdout.write(`    ${bold("1)")} Continue as ${name}\n`);
    process.stdout.write(`    ${bold("2)")} Sign in via browser\n`);
    process.stdout.write(`    ${bold("3)")} Paste a token from ${dim("claudemesh.com/token")}\n`);
    process.stdout.write(`    ${bold("4)")} Sign out\n`);
    render.blank();

    const choice = await prompt("  Choice [1]: ") || "1";

    if (choice === "1") {
      render.blank();
      render.ok(`continuing as ${bold(name)}`);
      return EXIT.SUCCESS;
    }
    if (choice === "4") {
      clearToken();
      render.ok("signed out");
      return EXIT.SUCCESS;
    }
    if (choice === "3") {
      clearToken();
      return loginWithToken();
    }
    clearToken();
    render.info(dim("Signing in…"));
  } else {
    render.blank();
    render.heading(`${bold("claudemesh")} — sign in to connect your terminal`);
    render.blank();
    process.stdout.write(`    ${bold("1)")} Sign in via browser ${dim("(opens automatically)")}\n`);
    process.stdout.write(`    ${bold("2)")} Paste a token from ${dim("claudemesh.com/token")}\n`);
    render.blank();

    const choice = await prompt("  Choice [1]: ") || "1";

    if (choice === "2") {
      return loginWithToken();
    }
  }

  try {
    const result = await loginWithDeviceCode();
    render.ok(`signed in as ${bold(result.user.display_name)}`);
    await syncMeshes(result.session_token);
    return EXIT.SUCCESS;
  } catch (err) {
    render.err(`Login failed: ${err instanceof Error ? err.message : err}`);
    return EXIT.AUTH_FAILED;
  }
}
