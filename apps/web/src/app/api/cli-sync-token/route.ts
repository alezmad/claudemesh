import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { auth } from "@turbostarter/auth/server";

// ---------------------------------------------------------------------------
// JWT signing (HS256 via Web Crypto — no external deps)
// ---------------------------------------------------------------------------

function base64UrlEncode(input: string | ArrayBuffer): string {
  const str =
    typeof input === "string"
      ? btoa(input)
      : btoa(String.fromCharCode(...new Uint8Array(input)));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const encoder = new TextEncoder();

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${headerB64}.${payloadB64}`),
  );

  return `${headerB64}.${payloadB64}.${base64UrlEncode(signature)}`;
}

// ---------------------------------------------------------------------------
// Route handler — POST /api/cli-sync-token
// ---------------------------------------------------------------------------

interface SyncTokenBody {
  meshes: Array<{ id: string; slug: string; role: string }>;
  action: "sync" | "create";
  newMesh?: { name: string; slug: string };
}

export async function POST(request: Request) {
  // 1. Check auth
  const reqHeaders = new Headers(await headers());
  reqHeaders.set("x-client-platform", "web-server");

  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // 2. Parse body
  let body: SyncTokenBody;
  try {
    body = (await request.json()) as SyncTokenBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { meshes, action, newMesh } = body;

  if (!Array.isArray(meshes)) {
    return NextResponse.json(
      { error: "meshes must be an array" },
      { status: 400 },
    );
  }

  if (action !== "sync" && action !== "create") {
    return NextResponse.json(
      { error: 'action must be "sync" or "create"' },
      { status: 400 },
    );
  }

  if (action === "create" && (!newMesh?.name || !newMesh?.slug)) {
    return NextResponse.json(
      { error: "newMesh.name and newMesh.slug are required for create action" },
      { status: 400 },
    );
  }

  // 3. Validate meshes belong to user — fetch user's meshes via internal API
  //    For now we trust the dashboard-authenticated user's selection since
  //    the broker will independently verify membership when the CLI connects.
  //    A full server-side ownership check can be added later.

  // 4. Get secret
  const secret = process.env.CLI_SYNC_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CLI_SYNC_SECRET not configured" },
      { status: 500 },
    );
  }

  // 5. Build and sign JWT
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: session.user.id,
    email: session.user.email,
    meshes: meshes.map((m) => ({
      id: m.id,
      slug: m.slug,
      role: m.role,
    })),
    action,
    ...(action === "create" && newMesh ? { newMesh } : {}),
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 15 * 60, // 15 minutes
  };

  const token = await signJwt(payload, secret);

  return NextResponse.json({ token });
}
