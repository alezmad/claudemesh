/**
 * JWT utilities for Telegram bridge connections.
 *
 * When a user connects their Telegram chat to a mesh, the broker generates
 * a short-lived JWT containing mesh credentials. The Telegram bot decodes
 * this token to establish the connection.
 *
 * Pure-crypto implementation — no external JWT library.
 * Tokens are URL-safe (base64url) for use as Telegram deep link parameters.
 *
 * IMPORTANT: The JWT payload contains the member's secretKey.
 * Never log the token or its decoded payload.
 */

import { createHmac } from "node:crypto";

// --- Types ---

export interface TelegramConnectPayload {
  meshId: string;
  meshSlug: string;
  memberId: string;
  pubkey: string;
  secretKey: string;   // ed25519 secret key — sensitive
  createdBy: string;   // Dashboard userId or CLI memberId
}

interface JwtClaims extends TelegramConnectPayload {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
}

// --- Helpers ---

function base64url(data: string): string {
  return Buffer.from(data).toString("base64url");
}

function base64urlDecode(str: string): string {
  return Buffer.from(str, "base64url").toString("utf-8");
}

function sign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

// --- Public API ---

const JWT_HEADER = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes

/**
 * Create a signed JWT containing Telegram connect credentials.
 * Expires in 15 minutes.
 */
export function generateTelegramConnectToken(
  payload: TelegramConnectPayload,
  secret: string,
): string {
  const now = Math.floor(Date.now() / 1000);

  const claims: JwtClaims = {
    ...payload,
    iss: "claudemesh-broker",
    sub: "telegram-connect",
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };

  const encodedPayload = base64url(JSON.stringify(claims));
  const signingInput = `${JWT_HEADER}.${encodedPayload}`;
  const signature = sign(signingInput, secret);

  return `${signingInput}.${signature}`;
}

/**
 * Validate and decode a Telegram connect JWT.
 * Returns the payload on success, or null on any failure
 * (bad signature, expired, wrong subject).
 */
export function validateTelegramConnectToken(
  token: string,
  secret: string,
): TelegramConnectPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

    // Verify signature
    const signingInput = `${headerB64}.${payloadB64}`;
    const expectedSignature = sign(signingInput, secret);
    // Constant-time comparison to prevent timing attacks
    const a = Buffer.from(signatureB64);
    const b = Buffer.from(expectedSignature);
    if (a.length !== b.length) return null;
    const { timingSafeEqual } = require("node:crypto");
    if (!timingSafeEqual(a, b)) return null;

    // Verify header algorithm
    const header = JSON.parse(base64urlDecode(headerB64));
    if (header.alg !== "HS256") return null;

    // Decode and validate claims
    const claims: JwtClaims = JSON.parse(base64urlDecode(payloadB64));

    // Check subject
    if (claims.sub !== "telegram-connect") return null;

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp < now) return null;

    // Check iat not in the future (30s tolerance)
    if (claims.iat > now + 30) return null;

    // Extract payload fields (strip JWT claims)
    const {
      meshId,
      meshSlug,
      memberId,
      pubkey,
      secretKey,
      createdBy,
    } = claims;

    // Basic presence check
    if (!meshId || !meshSlug || !memberId || !pubkey || !secretKey || !createdBy) {
      return null;
    }

    return { meshId, meshSlug, memberId, pubkey, secretKey, createdBy };
  } catch {
    return null;
  }
}

/**
 * Generate a Telegram deep link that passes the JWT as start parameter.
 * Format: https://t.me/{botUsername}?start={token}
 */
export function generateDeepLink(token: string, botUsername: string): string {
  return `https://t.me/${botUsername}?start=${token}`;
}
