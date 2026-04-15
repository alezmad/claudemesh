import { describe, it, expect } from "vitest";
import {
  generateKeypair, sign, verify, encrypt, decrypt, boxSeal, boxOpen,
  encryptDirect, decryptDirect, randomBytes, randomHex,
} from "~/services/crypto/facade.js";

describe("crypto", () => {
  it("generates valid Ed25519 keypair", async () => {
    const kp = await generateKeypair();
    expect(kp.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(kp.secretKey).toMatch(/^[0-9a-f]{128}$/);
  });

  it("sign + verify round-trip", async () => {
    const kp = await generateKeypair();
    const msg = "hello world";
    const sig = await sign(msg, kp.secretKey);
    expect(await verify(msg, sig, kp.publicKey)).toBe(true);
    expect(await verify("tampered", sig, kp.publicKey)).toBe(false);
  });

  it("file encrypt + decrypt round-trip", async () => {
    const data = new TextEncoder().encode("secret document");
    const encrypted = await encrypt(data);
    expect(encrypted.ciphertext.length).toBeGreaterThan(0);
    expect(encrypted.nonce).toBeTruthy();

    const decrypted = await decrypt(encrypted.ciphertext, encrypted.nonce, encrypted.key);
    expect(decrypted).not.toBeNull();
    expect(new TextDecoder().decode(decrypted!)).toBe("secret document");
  });

  it("file encrypt + decrypt fails with wrong key", async () => {
    const data = new TextEncoder().encode("secret");
    const encrypted = await encrypt(data);
    const wrongKey = await randomBytes(32);
    const result = await decrypt(encrypted.ciphertext, encrypted.nonce, wrongKey);
    expect(result).toBeNull();
  });

  it("boxSeal + boxOpen round-trip", async () => {
    const kp = await generateKeypair();
    const secret = await randomBytes(32);
    const sealed = await boxSeal(secret, kp.publicKey);
    expect(sealed).toBeTruthy();

    const opened = await boxOpen(sealed, kp.publicKey, kp.secretKey);
    expect(opened).not.toBeNull();
    expect(Buffer.from(opened!).toString("hex")).toBe(Buffer.from(secret).toString("hex"));
  });

  it("crypto_box direct message round-trip", async () => {
    const alice = await generateKeypair();
    const bob = await generateKeypair();
    const msg = "hello bob";

    const envelope = await encryptDirect(msg, bob.publicKey, alice.secretKey);
    expect(envelope.nonce).toBeTruthy();
    expect(envelope.ciphertext).toBeTruthy();

    const decrypted = await decryptDirect(envelope, alice.publicKey, bob.secretKey);
    expect(decrypted).toBe("hello bob");
  });

  it("crypto_box decrypt fails with wrong keys", async () => {
    const alice = await generateKeypair();
    const bob = await generateKeypair();
    const eve = await generateKeypair();

    const envelope = await encryptDirect("secret", bob.publicKey, alice.secretKey);
    const result = await decryptDirect(envelope, alice.publicKey, eve.secretKey);
    expect(result).toBeNull();
  });

  it("randomBytes returns correct length", async () => {
    const bytes = await randomBytes(16);
    expect(bytes.length).toBe(16);
  });

  it("randomHex returns correct length", async () => {
    const hex = await randomHex(8);
    expect(hex).toMatch(/^[0-9a-f]{16}$/);
  });
});
