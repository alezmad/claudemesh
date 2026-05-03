import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";

import { db } from "@turbostarter/db/server";
import { mesh } from "@turbostarter/db/schema/mesh";

/**
 * `PATCH /api/cli/meshes/:slug` — rename a mesh from the CLI.
 *
 * The `myRouter` (Hono) at `/api/my/meshes/*` runs `enforceAuth`, which
 * calls `auth.api.getSession()` — that only honours better-auth cookies.
 * The CLI's JWT (issued by `/api/auth/cli/device-code/[code]/approve`)
 * is a custom HS256 token signed with `CLI_SYNC_SECRET`, so it can't
 * authenticate against `/api/my/*`. Until better-auth gets a bearer
 * plugin wired up, CLI-only mutations live under `/api/cli/*` and
 * validate the JWT inline — same pattern as `/api/cli-sync-token`.
 */

interface CliJwtPayload {
  sub: string;
  email?: string;
  type?: string;
  exp?: number;
}

function base64UrlDecode(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function verifyCliJwt(token: string, secret: string): Promise<CliJwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlDecode(sigB64!),
    encoder.encode(`${headerB64}.${payloadB64}`),
  );
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64!))) as CliJwtPayload;
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "missing bearer token" }, { status: 401 });
  }
  const token = auth.slice("Bearer ".length).trim();
  const secret = process.env.CLI_SYNC_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "server not configured" }, { status: 500 });
  }
  const payload = await verifyCliJwt(token, secret);
  if (!payload) {
    return NextResponse.json({ error: "invalid or expired token" }, { status: 401 });
  }

  const { slug } = await params;
  let body: { name?: string };
  try {
    body = (await request.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const newName = body.name?.trim();
  if (!newName) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (newName.length > 80) {
    return NextResponse.json({ error: "name too long (max 80 chars)" }, { status: 400 });
  }

  // Only the owner can rename. The slug is the public identifier; we
  // match (slug, ownerUserId) to scope the update.
  const [updated] = await db
    .update(mesh)
    .set({ name: newName })
    .where(and(eq(mesh.slug, slug), eq(mesh.ownerUserId, payload.sub)))
    .returning({ slug: mesh.slug, name: mesh.name });

  if (!updated) {
    return NextResponse.json(
      { error: "mesh not found or you are not the owner" },
      { status: 404 },
    );
  }
  return NextResponse.json(updated);
}
