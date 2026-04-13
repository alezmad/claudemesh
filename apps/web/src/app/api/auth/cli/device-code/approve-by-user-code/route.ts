import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@turbostarter/auth/server";
import { deviceCodes } from "../new/route";

export async function POST(request: Request) {
  // Verify the user is authenticated
  const reqHeaders = new Headers(await headers());
  reqHeaders.set("x-client-platform", "web-server");
  const session = await auth.api.getSession({ headers: reqHeaders });

  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { user_code?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!body.user_code) {
    return NextResponse.json({ error: "user_code required" }, { status: 400 });
  }

  // Find the device code entry by user_code
  let deviceCode: string | null = null;
  let entry: (typeof deviceCodes extends Map<string, infer V> ? V : never) | null = null;

  for (const [dc, e] of deviceCodes) {
    if (e.user_code === body.user_code && e.status === "pending") {
      deviceCode = dc;
      entry = e;
      break;
    }
  }

  if (!deviceCode || !entry) {
    return NextResponse.json({ error: "Code not found or expired" }, { status: 404 });
  }

  if (Date.now() > entry.expires_at) {
    deviceCodes.delete(deviceCode);
    return NextResponse.json({ error: "Code expired" }, { status: 410 });
  }

  // Sign a CLI session JWT
  const secret = process.env.CLI_SYNC_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: session.user.id,
    email: session.user.email,
    name: session.user.name,
    type: "cli-session",
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 30 * 24 * 60 * 60,
  };

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

  // Mark as approved
  entry.status = "approved";
  entry.session_token = token;
  entry.user = {
    id: session.user.id,
    display_name: session.user.name ?? session.user.email ?? "User",
    email: session.user.email ?? "",
  };

  return NextResponse.json({ ok: true });
}
