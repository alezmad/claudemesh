/**
 * Invite-link parser for claudemesh `ic://join/<base64url(JSON)>` links.
 *
 * v0.1.0: parses + shape-validates + checks expiry. Signature
 * verification and one-time-use invite-token tracking land in Step 18.
 */

import { z } from "zod";

const invitePayloadSchema = z.object({
  v: z.literal(1),
  mesh_id: z.string().min(1),
  mesh_slug: z.string().min(1),
  broker_url: z.string().min(1),
  expires_at: z.number().int().positive(),
  mesh_root_key: z.string().min(1),
  role: z.enum(["admin", "member"]),
  signature: z.string().optional(), // ed25519 b64, validated in Step 18
});

export type InvitePayload = z.infer<typeof invitePayloadSchema>;

export interface ParsedInvite {
  payload: InvitePayload;
  raw: string; // the original ic://join/... string
}

export function parseInviteLink(link: string): ParsedInvite {
  if (!link.startsWith("ic://join/")) {
    throw new Error(
      `invalid invite link: expected prefix "ic://join/", got "${link.slice(0, 20)}…"`,
    );
  }
  const encoded = link.slice("ic://join/".length);
  if (!encoded) throw new Error("invite link has no payload");

  let json: string;
  try {
    json = Buffer.from(encoded, "base64url").toString("utf-8");
  } catch (e) {
    throw new Error(
      `invite link base64 decode failed: ${e instanceof Error ? e.message : e}`,
    );
  }

  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch (e) {
    throw new Error(
      `invite link JSON parse failed: ${e instanceof Error ? e.message : e}`,
    );
  }

  const parsed = invitePayloadSchema.safeParse(obj);
  if (!parsed.success) {
    throw new Error(
      `invite link shape invalid: ${parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message).join("; ")}`,
    );
  }

  // Expiry check (unix seconds).
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (parsed.data.expires_at < nowSeconds) {
    throw new Error(
      `invite expired: expires_at=${parsed.data.expires_at}, now=${nowSeconds}`,
    );
  }

  return { payload: parsed.data, raw: link };
}

/**
 * Encode a payload back to an `ic://join/...` link. Used for testing
 * + for building links server-side once we add that flow.
 */
export function encodeInviteLink(payload: InvitePayload): string {
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json, "utf-8").toString("base64url");
  return `ic://join/${encoded}`;
}
