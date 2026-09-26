/**
 * Spec 2026-09-26 §1 (bug2): an undecryptable push must never reach a
 * Claude session as text. Before 1.38.0 a sealed DM that no key opened
 * was base64-decoded and rendered as raw binary («21e425db: ��a.�tH�/…»).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import { openSqlite, type SqliteDb } from "~/daemon/db/sqlite.js";
import { migrateInbox } from "~/daemon/db/inbox.js";
import { EventBus } from "~/daemon/events.js";
import { handleBrokerPush, type InboundContext } from "~/daemon/inbound.js";
import { encryptDirect, generateKeypair } from "~/services/crypto/facade.js";
import { decodeBase64Utf8, isRenderableText } from "~/utils/text.js";

describe("inbound: undecryptable payloads", () => {
  let dir: string;
  let db: SqliteDb;
  let events: Array<Record<string, unknown>>;
  let logs: string[];
  let acks: string[];
  let ctx: InboundContext;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cmh-inbound-"));
    db = await openSqlite(join(dir, "inbox.db"));
    migrateInbox(db);
    events = [];
    logs = [];
    acks = [];
    const bus = new EventBus();
    bus.subscribe((e) => { if (e.kind === "message") events.push(e.data); });
    const me = await generateKeypair();
    ctx = {
      db, bus, meshSlug: "test",
      recipientSecretKeyHex: me.secretKey,
      ackClientMessage: (cid) => acks.push(cid),
      log: (_l, msg) => logs.push(msg),
    };
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  });

  it("drops a sealed DM no key opens: no event, no row, logged, acked", async () => {
    const sender = await generateKeypair();
    const stranger = await generateKeypair();
    // Sealed for somebody else — our key can't open it.
    const env = await encryptDirect("secret", stranger.publicKey, sender.secretKey);
    await handleBrokerPush({
      type: "push", messageId: "m1", senderPubkey: sender.publicKey,
      nonce: env.nonce, ciphertext: env.ciphertext,
    }, ctx);
    expect(events).toHaveLength(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM inbox").get()).toEqual({ n: 0 });
    expect(logs).toContain("inbound_decrypt_failed");
    expect(acks).toEqual(["m1"]);
  });

  it("renders a placeholder for a topic post it can't open", async () => {
    const sender = await generateKeypair();
    await handleBrokerPush({
      type: "push", messageId: "m2", senderPubkey: sender.publicKey, topic: "compras-orq",
      nonce: Buffer.from(randomBytes(24)).toString("base64"),
      ciphertext: Buffer.from(randomBytes(64)).toString("base64"),
    }, ctx);
    expect(events).toHaveLength(1);
    expect(String(events[0]!.body)).toContain("claudemesh topic tail compras-orq");
  });

  it("still decrypts a DM sealed for us", async () => {
    const sender = await generateKeypair();
    const me = await generateKeypair();
    ctx.recipientSecretKeyHex = me.secretKey;
    const env = await encryptDirect("hola", me.publicKey, sender.secretKey);
    await handleBrokerPush({
      type: "push", messageId: "m3", senderPubkey: sender.publicKey,
      nonce: env.nonce, ciphertext: env.ciphertext,
    }, ctx);
    expect(events.map((e) => e.body)).toEqual(["hola"]);
  });

  it("keeps the v1 base64 broadcast path for valid text", async () => {
    await handleBrokerPush({
      type: "push", messageId: "m4", ciphertext: Buffer.from("hello mesh").toString("base64"),
    }, ctx);
    expect(events.map((e) => e.body)).toEqual(["hello mesh"]);
  });

  it("drops a v1 broadcast whose bytes aren't text", async () => {
    await handleBrokerPush({
      type: "push", messageId: "m5", ciphertext: Buffer.from([0xff, 0xfe, 0x00, 0x9c]).toString("base64"),
    }, ctx);
    expect(events).toHaveLength(0);
  });

  it("text helpers", () => {
    expect(isRenderableText("línea\ncon\ttab")).toBe(true);
    expect(isRenderableText("bad �")).toBe(false);
    expect(isRenderableText("bell \u0007")).toBe(false);
    expect(decodeBase64Utf8(Buffer.from([0xc3, 0x28]).toString("base64"))).toBeNull();
  });
});
