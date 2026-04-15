/**
 * `claudemesh test` — integration test battery against live broker.
 *
 * Creates a temporary mesh, runs all operations, verifies results,
 * then cleans up. Safe to run repeatedly.
 */

import { getStoredToken } from "~/services/auth/facade.js";
import { create as createMesh, leave as leaveMesh } from "~/services/mesh/facade.js";
import { readConfig } from "~/services/config/facade.js";
import { request } from "~/services/api/facade.js";
import { generateKeypair, sign, verify } from "~/services/crypto/facade.js";
import { BrokerClient } from "~/services/broker/facade.js";
import { URLS } from "~/constants/urls.js";
import { runAllChecks } from "~/services/health/facade.js";
import { green, red, dim, bold, yellow, icons } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

const BROKER_HTTP = URLS.BROKER.replace("wss://", "https://").replace("ws://", "http://").replace("/ws", "");

interface TestResult {
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
}

const results: TestResult[] = [];

async function run(name: string, fn: () => Promise<string>): Promise<boolean> {
  const start = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail, ms: Date.now() - start });
    console.log(`  ${green(icons.check)} ${name.padEnd(18)} ${dim(detail)}`);
    return true;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail, ms: Date.now() - start });
    console.log(`  ${red(icons.cross)} ${name.padEnd(18)} ${red(detail)}`);
    return false;
  }
}

export async function runTest(): Promise<number> {
  const started = Date.now();
  const meshSlug = `test-e2e-${Date.now().toString(36)}`;

  console.log("");
  console.log(`  ${bold("claudemesh integration test")}`);
  console.log(`  ${dim("─".repeat(40))}`);
  console.log("");

  // --- Auth ---
  const auth = getStoredToken();
  if (!auth) {
    console.log(`  ${red(icons.cross)} Not signed in. Run ${bold("claudemesh login")} first.\n`);
    return EXIT.AUTH_FAILED;
  }

  let userId = "";
  try {
    const payload = JSON.parse(Buffer.from(auth.session_token.split(".")[1]!, "base64url").toString()) as { sub?: string };
    userId = payload.sub ?? "";
  } catch {}

  await run("auth", async () => {
    if (!userId) throw new Error("invalid token");
    return `signed in as ${auth.user.display_name || auth.user.email}`;
  });

  // --- Doctor checks (non-blocking — warns but doesn't fail) ---
  {
    const checks = runAllChecks();
    const failed = checks.filter(c => !c.ok);
    if (failed.length > 0) {
      const warns = failed.map(c => c.name).join(", ");
      console.log(`  ${yellow(icons.warn)} ${"doctor".padEnd(18)} ${dim(warns + " (non-blocking)")}`);
    } else {
      console.log(`  ${green(icons.check)} ${"doctor".padEnd(18)} ${dim(checks.length + " checks passed")}`);
    }
  }

  // --- Crypto ---
  await run("crypto", async () => {
    const kp = await generateKeypair();
    const sig = await sign("test-message", kp.secretKey);
    const valid = await verify("test-message", sig, kp.publicKey);
    if (!valid) throw new Error("signature verification failed");
    const tampered = await verify("tampered", sig, kp.publicKey);
    if (tampered) throw new Error("tampered message should not verify");
    return "keypair + sign + verify round-trip";
  });

  // --- Mesh create ---
  let meshId = "";
  const createOk = await run("create", async () => {
    const result = await createMesh(meshSlug);
    meshId = result.id;
    return `created "${result.slug}" (${result.id.slice(0, 8)}…)`;
  });

  if (!createOk) {
    console.log(`\n  ${red("Aborting — mesh creation failed.")}\n`);
    return EXIT.INTERNAL_ERROR;
  }

  // --- List ---
  await run("list", async () => {
    const config = readConfig();
    const found = config.meshes.find(m => m.slug === meshSlug);
    if (!found) throw new Error("mesh not in local config");
    return `found ${meshSlug} in local config`;
  });

  // --- Server list ---
  await run("server list", async () => {
    const res = await request<{ meshes: Array<{ slug: string }> }>({
      path: `/cli/meshes?user_id=${userId}`,
      baseUrl: BROKER_HTTP,
    });
    const found = res.meshes?.find(m => m.slug === meshSlug);
    if (!found) throw new Error("mesh not on server");
    return `found ${meshSlug} on server (${res.meshes.length} total)`;
  });

  // --- Connect (broker WS) ---
  const config = readConfig();
  const meshConfig = config.meshes.find(m => m.slug === meshSlug);
  let client: BrokerClient | null = null;

  if (meshConfig) {
    await run("connect", async () => {
      client = new BrokerClient(meshConfig, { displayName: "test-runner" });
      await client.connect();
      if (client.status !== "open") throw new Error("status: " + client.status);
      return "broker connected, hello_ack received";
    });

    // --- Peers ---
    if (client) {
      await run("peers", async () => {
        const peers = await client!.listPeers();
        return `${peers.length} peer(s) online`;
      });

      // --- Send ---
      await run("send", async () => {
        const result = await client!.send("*", "test-battery-ping", "low");
        if (!result.ok) throw new Error(result.error ?? "send failed");
        return `broadcast sent (${result.messageId?.slice(0, 8)}…)`;
      });

      // --- Remember ---
      let memoryId: string | null = null;
      await run("remember", async () => {
        memoryId = await client!.remember("integration test battery memory probe", ["test", "e2e"]);
        if (!memoryId) throw new Error("no memory ID returned");
        return `stored (${memoryId.slice(0, 8)}…)`;
      });

      // --- Recall (postgres full-text search) ---
      await run("recall", async () => {
        await new Promise(r => setTimeout(r, 500));
        const memories = await client!.recall("integration test battery");
        if (memories.length === 0) throw new Error("no memories found");
        return `${memories.length} result(s)`;
      });

      // --- State ---
      const stateVal = "test-value-" + Date.now();
      await run("state set", async () => {
        await client!.setState("test-e2e-key", stateVal);
        return "key written";
      });

      await run("state get", async () => {
        await new Promise(r => setTimeout(r, 500));
        const result = await client!.getState("test-e2e-key");
        if (!result) throw new Error("key not found");
        if (String(result.value) !== stateVal) throw new Error(`expected ${stateVal}, got ${result.value}`);
        return `read back: ${String(result.value).slice(0, 20)}…`;
      });

      // --- Clean up memory ---
      if (memoryId) {
        await run("forget", async () => {
          await client!.forget(memoryId!);
          return "memory cleaned up";
        });
      }

      // --- Disconnect ---
      await run("disconnect", async () => {
        client!.close();
        return "connection closed";
      });
    }
  }

  // --- Delete mesh ---
  await run("delete", async () => {
    // Server-side delete
    await request({
      path: `/cli/mesh/${meshSlug}`,
      method: "DELETE",
      body: { user_id: userId },
      baseUrl: BROKER_HTTP,
    });
    leaveMesh(meshSlug);
    return `deleted "${meshSlug}" from server + local`;
  });

  // --- Summary ---
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const totalMs = Date.now() - started;

  console.log("");
  if (failed === 0) {
    console.log(`  ${green(bold(`${passed}/${results.length} passed`))}  ${dim(`(${(totalMs / 1000).toFixed(1)}s)`)}`);
  } else {
    console.log(`  ${red(bold(`${failed} failed`))}, ${green(`${passed} passed`)}  ${dim(`(${(totalMs / 1000).toFixed(1)}s)`)}`);
  }
  console.log("");

  return failed > 0 ? EXIT.INTERNAL_ERROR : EXIT.SUCCESS;
}
