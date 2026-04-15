import { createInterface } from "node:readline";
import { loginWithDeviceCode, getStoredToken, clearToken, storeToken } from "~/services/auth/facade.js";
import { my } from "~/services/api/facade.js";
import { green, dim, bold, icons } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";
import { URLS } from "~/constants/urls.js";

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

async function loginWithToken(): Promise<number> {
  console.log(`\n  Paste a token from ${dim(URLS.API_BASE + "/token")}`);
  console.log(`  ${dim("Generate one in your browser, then paste it here.")}\n`);

  const token = await prompt("  Token: ");
  if (!token) {
    console.error(`  ${icons.cross} No token provided.`);
    return EXIT.AUTH_FAILED;
  }

  // Decode JWT to get user info
  let user = { id: "", display_name: "", email: "" };
  try {
    const parts = token.split(".");
    if (parts[1]) {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as {
        sub?: string; email?: string; name?: string; exp?: number;
      };
      if (payload.exp && payload.exp < Date.now() / 1000) {
        console.error(`  ${icons.cross} Token expired. Generate a new one.`);
        return EXIT.AUTH_FAILED;
      }
      user = {
        id: payload.sub ?? "",
        display_name: payload.name ?? payload.email ?? "",
        email: payload.email ?? "",
      };
    }
  } catch {
    console.error(`  ${icons.cross} Invalid token format.`);
    return EXIT.AUTH_FAILED;
  }

  storeToken({ session_token: token, user, token_source: "manual" });
  console.log(`  ${green(icons.check)} Signed in as ${user.display_name || user.email || "user"}.`);
  return EXIT.SUCCESS;
}

async function syncMeshes(token: string): Promise<void> {
  try {
    const meshes = await my.getMeshes(token);
    if (meshes.length > 0) {
      const names = meshes.map((m) => m.slug).join(", ");
      console.log(`  ${green(icons.check)} Synced ${meshes.length} mesh${meshes.length === 1 ? "" : "es"}: ${names}`);
    }
  } catch {}
}

export async function login(): Promise<number> {
  const existing = getStoredToken();
  if (existing) {
    const name = existing.user.display_name || existing.user.email || "unknown";
    console.log(`\n  Already signed in as ${bold(name)}.`);
    console.log("");
    console.log(`    ${bold("1)")} Continue as ${name}`);
    console.log(`    ${bold("2)")} Sign in via browser`);
    console.log(`    ${bold("3)")} Paste a token from ${dim("claudemesh.com/token")}`);
    console.log(`    ${bold("4)")} Sign out`);
    console.log("");

    const choice = await prompt("  Choice [1]: ") || "1";

    if (choice === "1") {
      console.log(`\n  ${green(icons.check)} Continuing as ${name}.`);
      return EXIT.SUCCESS;
    }
    if (choice === "4") {
      clearToken();
      console.log(`  ${green(icons.check)} Signed out.`);
      return EXIT.SUCCESS;
    }
    if (choice === "3") {
      clearToken();
      return loginWithToken();
    }
    // choice === "2" → fall through to browser login
    clearToken();
    console.log(`  ${dim("Signing in…")}`);
  } else {
    // Not logged in — show auth options
    console.log(`\n  ${bold("claudemesh")} — sign in to connect your terminal`);
    console.log("");
    console.log(`    ${bold("1)")} Sign in via browser ${dim("(opens automatically)")}`);
    console.log(`    ${bold("2)")} Paste a token from ${dim("claudemesh.com/token")}`);
    console.log("");

    const choice = await prompt("  Choice [1]: ") || "1";

    if (choice === "2") {
      return loginWithToken();
    }
    // choice === "1" → fall through to browser login
  }

  try {
    const result = await loginWithDeviceCode();
    console.log(`  ${green(icons.check)} Signed in as ${result.user.display_name}.`);
    await syncMeshes(result.session_token);
    return EXIT.SUCCESS;
  } catch (err) {
    console.error(`  ${icons.cross} Login failed: ${err instanceof Error ? err.message : err}`);
    return EXIT.AUTH_FAILED;
  }
}
