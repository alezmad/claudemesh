import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@turbostarter/auth/server";
import { deviceCodes } from "../../new/route";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;

  // Verify the user is authenticated via Better Auth session
  const reqHeaders = new Headers(await headers());
  reqHeaders.set("x-client-platform", "web-server");
  const session = await auth.api.getSession({ headers: reqHeaders });

  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const entry = deviceCodes.get(code);
  if (!entry) {
    return NextResponse.json({ error: "Code not found or expired" }, { status: 404 });
  }

  if (Date.now() > entry.expires_at) {
    deviceCodes.delete(code);
    return NextResponse.json({ error: "Code expired" }, { status: 410 });
  }

  if (entry.status !== "pending") {
    return NextResponse.json({ error: "Code already used" }, { status: 409 });
  }

  // Sign a CLI session JWT (same pattern as cli-sync-token)
  const secret = process.env.CLI_SYNC_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  // Create a simple session token for CLI use
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: session.user.id,
    email: session.user.email,
    name: session.user.name,
    type: "cli-session",
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 30 * 24 * 60 * 60, // 30 days
  };

  // Sign JWT (inline HS256 — same as cli-sync-token route)
  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const payloadB64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(`${headerB64}.${payloadB64}`));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const token = `${headerB64}.${payloadB64}.${sigB64}`;

  // Mark device code as approved
  entry.status = "approved";
  entry.session_token = token;
  entry.user = {
    id: session.user.id,
    display_name: session.user.name ?? session.user.email ?? "User",
    email: session.user.email ?? "",
  };

  return NextResponse.json({ ok: true });
}
