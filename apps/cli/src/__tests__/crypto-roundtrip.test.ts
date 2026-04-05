import { describe, it, expect } from "vitest";
import { encryptDirect, decryptDirect } from "../crypto/envelope";
import { generateKeypair } from "../crypto/keypair";

describe("crypto roundtrip", () => {
  it("Alice encrypts for Bob, Bob decrypts successfully", async () => {
    const alice = await generateKeypair();
    const bob = await generateKeypair();

    const plaintext = "hello world";
    const envelope = await encryptDirect(plaintext, bob.publicKey, alice.secretKey);

    const decrypted = await decryptDirect(envelope, alice.publicKey, bob.secretKey);
    expect(decrypted).toBe(plaintext);
  });

  it("Carol cannot decrypt a message encrypted for Bob", async () => {
    const alice = await generateKeypair();
    const bob = await generateKeypair();
    const carol = await generateKeypair();

    const envelope = await encryptDirect("hello world", bob.publicKey, alice.secretKey);

    const decrypted = await decryptDirect(envelope, alice.publicKey, carol.secretKey);
    expect(decrypted).toBeNull();
  });

  it("tampered ciphertext returns null on decrypt", async () => {
    const alice = await generateKeypair();
    const bob = await generateKeypair();

    const envelope = await encryptDirect("hello world", bob.publicKey, alice.secretKey);

    // Flip a byte in the ciphertext
    const raw = Buffer.from(envelope.ciphertext, "base64");
    raw[0] = raw[0]! ^ 0xff;
    const tampered = { nonce: envelope.nonce, ciphertext: raw.toString("base64") };

    const decrypted = await decryptDirect(tampered, alice.publicKey, bob.secretKey);
    expect(decrypted).toBeNull();
  });
});
