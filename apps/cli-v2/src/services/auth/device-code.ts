import { createInterface } from "node:readline";
import { TIMINGS } from "~/constants/timings.js";
import { pub } from "~/services/api/facade.js";
import { getDeviceInfo } from "~/services/device/facade.js";
import { openBrowser } from "~/services/spawn/facade.js";
import { log, warn } from "~/services/logger/facade.js";
import { storeToken } from "./token-store.js";
import { DeviceCodeExpired } from "./errors.js";

export interface DeviceCodeResult {
  user: { id: string; display_name: string; email: string };
  session_token: string;
}

function parseJwtUser(token: string): { id: string; display_name: string; email: string } {
  try {
    const parts = token.split(".");
    if (parts[1]) {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as {
        sub?: string; email?: string; name?: string; exp?: number;
      };
      if (payload.exp && payload.exp < Date.now() / 1000) throw new Error("expired");
      return {
        id: payload.sub ?? "",
        display_name: payload.name ?? payload.email ?? "",
        email: payload.email ?? "",
      };
    }
  } catch {}
  throw new Error("Invalid token");
}

export async function loginWithDeviceCode(): Promise<DeviceCodeResult> {
  const device = getDeviceInfo();
  const { device_code, user_code, session_id, verification_url, token_url } = await pub.requestDeviceCode({
    hostname: device.hostname,
    platform: device.platform,
    arch: device.arch,
  });

  const browserUrl = `${verification_url}?session=${session_id}`;
  const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;
  const orange = (s: string) => isTTY ? `\x1b[38;5;208m${s}\x1b[0m` : s;
  const bold = (s: string) => isTTY ? `\x1b[1m${s}\x1b[0m` : s;
  const dim = (s: string) => isTTY ? `\x1b[2m${s}\x1b[0m` : s;

  log("");
  log("  " + orange("claudemesh") + " — sign in to connect your terminal");
  log("");
  log("  ┌──────────────────────────────────┐");
  log("  │                                  │");
  log("  │   Your code:  " + bold(user_code) + "          │");
  log("  │                                  │");
  log("  └──────────────────────────────────┘");
  log("");
  log("  " + dim("Confirm this code matches your browser."));
  log("");
  log("  " + dim("If the browser didn't open, visit:"));
  log("  " + browserUrl);
  log("");
  log("  " + dim("Can't use a browser? Generate a token at:"));
  log("  " + (token_url || verification_url.replace("/cli-auth", "/token")));
  log("  " + dim("Then paste it below."));
  log("");
  log("  Waiting… " + dim("(paste token or Ctrl-C to cancel)"));

  try {
    await openBrowser(browserUrl);
  } catch {
    warn("  Could not open browser automatically.");
  }

  // Race: device-code polling vs stdin token paste
  return new Promise<DeviceCodeResult>((resolve, reject) => {
    let done = false;

    // Stdin paste listener
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.on("line", (line) => {
      if (done) return;
      const trimmed = line.trim();
      // JWT format: xxx.yyy.zzz
      if (trimmed.split(".").length === 3 && trimmed.length > 50) {
        done = true;
        rl.close();
        try {
          const user = parseJwtUser(trimmed);
          storeToken({ session_token: trimmed, user, token_source: "manual" });
          resolve({ user, session_token: trimmed });
        } catch (e) {
          reject(new Error("Invalid or expired token. Generate a new one."));
        }
      }
    });

    // Device-code polling
    const startTime = Date.now();
    const poll = async () => {
      while (!done && Date.now() - startTime < TIMINGS.DEVICE_CODE_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, TIMINGS.DEVICE_CODE_POLL_MS));
        if (done) return;

        try {
          const result = await pub.pollDeviceCode(device_code);
          if (result.status === "approved" && result.session_token && result.user) {
            if (done) return;
            done = true;
            rl.close();
            storeToken({ session_token: result.session_token, user: result.user, token_source: "device-code" });
            resolve({ user: result.user, session_token: result.session_token });
            return;
          }
          if (result.status === "expired") {
            if (done) return;
            done = true;
            rl.close();
            reject(new DeviceCodeExpired());
            return;
          }
        } catch { /* network error, retry */ }
      }

      if (!done) {
        done = true;
        rl.close();
        reject(new DeviceCodeExpired());
      }
    };

    poll();
  });
}
