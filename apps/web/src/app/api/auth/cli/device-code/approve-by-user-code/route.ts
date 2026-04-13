import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@turbostarter/auth/server";

const BROKER_URL = (process.env.BROKER_HTTP_URL || "https://ic.claudemesh.com").replace(/\/$/, "");

export async function POST(request: Request) {
  const reqHeaders = new Headers(await headers());
  reqHeaders.set("x-client-platform", "web-server");
  const session = await auth.api.getSession({ headers: reqHeaders });

  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { user_code?: string; session_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const code = body.session_id ?? body.user_code;
  if (!code) {
    return NextResponse.json({ error: "session_id or user_code required" }, { status: 400 });
  }

  // Proxy approve to the broker
  const brokerRes = await fetch(`${BROKER_URL}/cli/device-code/${code}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    }),
  });

  const brokerBody = await brokerRes.json().catch(() => ({ error: "Broker error" }));

  return NextResponse.json(brokerBody as Record<string, unknown>, { status: brokerRes.status });
}
