// Canonical request fingerprint per spec §4.4.
//
// request_fingerprint = sha256(
//   envelope_version || 0x00 ||
//   destination_kind || 0x00 ||
//   destination_ref  || 0x00 ||
//   reply_to_id_or_empty || 0x00 ||
//   priority         || 0x00 ||
//   meta_canonical_json || 0x00 ||
//   body_hash
// )

import { createHash } from "node:crypto";

export type DestKind = "topic" | "dm" | "queue";
export type Priority = "now" | "next" | "low";

export interface SendRequestForFingerprint {
  envelope_version: number;
  destination_kind: DestKind;
  destination_ref: string;
  reply_to_id?: string | null;
  priority: Priority;
  meta?: Record<string, unknown> | null;
  /** UTF-8 body bytes. */
  body: Uint8Array;
}

const NUL = Buffer.from([0]);

export function computeRequestFingerprint(req: SendRequestForFingerprint): Buffer {
  const h = createHash("sha256");
  h.update(String(req.envelope_version), "utf8"); h.update(NUL);
  h.update(req.destination_kind, "utf8");        h.update(NUL);
  h.update(req.destination_ref, "utf8");         h.update(NUL);
  h.update(req.reply_to_id ?? "", "utf8");       h.update(NUL);
  h.update(req.priority, "utf8");                h.update(NUL);
  h.update(req.meta ? canonicalJson(req.meta) : "", "utf8");
  h.update(NUL);
  h.update(createHash("sha256").update(req.body).digest());
  return h.digest();
}

/**
 * Minimal JCS-like canonicalization: sort object keys, no whitespace, no
 * non-ASCII escape funny business. Sufficient for v0.9.0 (TS-only).
 * Cross-language SDK ports get a vetted JCS lib + conformance tests
 * (deferred per followups doc).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k]);
    return out;
  }
  return value;
}

export function fingerprintHexPrefix(fp: Uint8Array, bytes = 8): string {
  let s = "";
  for (let i = 0; i < bytes && i < fp.length; i++) {
    s += fp[i]!.toString(16).padStart(2, "0");
  }
  return s;
}
