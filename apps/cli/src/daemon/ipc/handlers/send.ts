// IPC accept handler for POST /v1/send. Implements the §4.5.1 lookup table:
// daemon-local idempotency over outbox states × fingerprint match/mismatch.
//
// Broker delivery (drain → broker WS) is a separate concern and not part of
// this handler — this only serializes the daemon-local accept.

import { randomUUID } from "node:crypto";

import {
  findByClientId,
  fingerprintsEqual,
  insertPending,
  type OutboxRow,
} from "../../db/outbox.js";
import { inImmediateTx, type SqliteDb } from "../../db/sqlite.js";
import {
  computeRequestFingerprint,
  fingerprintHexPrefix,
  type DestKind,
  type Priority,
} from "../../fingerprint.js";

export interface SendRequest {
  to: string;             // peer name | pubkey hex | @group | * | topic name
  message: string;
  priority?: Priority;
  meta?: Record<string, unknown>;
  reply_to_id?: string;
  /** Optional caller-supplied id. Wins over Idempotency-Key header. */
  client_message_id?: string;
  /** Destination kind + ref must be supplied by the IPC layer after parsing `to`. */
  destination_kind: DestKind;
  destination_ref: string;
  /** Sprint 4: pre-resolved broker-format target (pubkey hex, "#topicId", @group, *). */
  target_spec?: string;
  /** Sprint 4: pre-encrypted ciphertext (base64). For DMs: crypto_box. For broadcast/topic: base64-of-plaintext. */
  ciphertext?: string;
  /** Sprint 4: nonce that pairs with ciphertext (base64). */
  nonce?: string;
  /** Sprint 4: which mesh this send is for (single-mesh daemon today; multi-mesh later). */
  mesh?: string;
}

export type AcceptOutcome =
  | { kind: "accepted_pending"; status: 202; client_message_id: string }
  | { kind: "accepted_inflight"; status: 202; client_message_id: string }
  | { kind: "accepted_done";     status: 200; client_message_id: string; broker_message_id: string | null }
  | { kind: "conflict";          status: 409; reason: string;            daemon_fingerprint_prefix: string; broker_message_id?: string | null };

export interface AcceptDeps {
  db: SqliteDb;
  /** Override for testing. */
  now?: () => number;
  /** Override for testing. */
  newId?: () => string;
}

export const ENVELOPE_VERSION = 1;

/**
 * Daemon-local idempotency: serialized via BEGIN IMMEDIATE so concurrent
 * IPC requests with the same client_message_id produce one outcome.
 */
export function acceptSend(req: SendRequest, deps: AcceptDeps): AcceptOutcome {
  const now = (deps.now ?? Date.now)();
  const newId = deps.newId ?? randomUUID;

  // Per spec, caller-supplied client_message_id wins; otherwise daemon mints one.
  const clientId = req.client_message_id?.trim() || ulidLike(newId);

  const body = Buffer.from(req.message, "utf8");
  const fingerprint = computeRequestFingerprint({
    envelope_version: ENVELOPE_VERSION,
    destination_kind: req.destination_kind,
    destination_ref: req.destination_ref,
    reply_to_id: req.reply_to_id ?? null,
    priority: req.priority ?? "next",
    meta: req.meta ?? null,
    body,
  });

  return inImmediateTx(deps.db, () => {
    const existing = findByClientId(deps.db, clientId);
    if (!existing) {
      insertPending(deps.db, {
        id: newId(),
        client_message_id: clientId,
        request_fingerprint: fingerprint,
        payload: body,
        now,
        mesh: req.mesh,
        target_spec: req.target_spec,
        nonce: req.nonce,
        ciphertext: req.ciphertext,
        priority: req.priority,
      });
      return { kind: "accepted_pending", status: 202, client_message_id: clientId };
    }

    return decideForExistingRow(existing, fingerprint);
  });
}

function decideForExistingRow(row: OutboxRow, fp: Buffer): AcceptOutcome {
  const match = fingerprintsEqual(fp, row.request_fingerprint);
  const fpPrefix = fingerprintHexPrefix(fp);

  // Spec §4.5.1 lookup table.
  switch (row.status) {
    case "pending":
      return match
        ? { kind: "accepted_pending", status: 202, client_message_id: row.client_message_id }
        : conflict("outbox_pending_fingerprint_mismatch", fpPrefix);

    case "inflight":
      return match
        ? { kind: "accepted_inflight", status: 202, client_message_id: row.client_message_id }
        : conflict("outbox_inflight_fingerprint_mismatch", fpPrefix);

    case "done":
      return match
        ? {
            kind: "accepted_done",
            status: 200,
            client_message_id: row.client_message_id,
            broker_message_id: row.broker_message_id,
          }
        : conflict("outbox_done_fingerprint_mismatch", fpPrefix, row.broker_message_id);

    case "dead":
      return match
        ? conflict("outbox_dead_fingerprint_match", fpPrefix, row.broker_message_id)
        : conflict("outbox_dead_fingerprint_mismatch", fpPrefix);

    case "aborted":
      return match
        ? conflict("outbox_aborted_fingerprint_match", fpPrefix)
        : conflict("outbox_aborted_fingerprint_mismatch", fpPrefix);

    default: {
      // Exhaustiveness check.
      const _: never = row.status;
      throw new Error(`unknown outbox status: ${String(_)}`);
    }
  }
}

function conflict(reason: string, fpPrefix: string, brokerMessageId: string | null = null): AcceptOutcome {
  return {
    kind: "conflict",
    status: 409,
    reason,
    daemon_fingerprint_prefix: fpPrefix,
    broker_message_id: brokerMessageId,
  };
}

/** Tiny ULID-ish generator: 26-char Crockford-base32 from time + random. */
function ulidLike(newId: () => string): string {
  // We don't ship a full ULID lib for one fallback path; uuid is fine here.
  // The wire-stable id is whatever we return; downstream just uses it as text.
  return newId();
}
