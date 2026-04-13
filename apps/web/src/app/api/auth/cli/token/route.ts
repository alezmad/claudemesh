import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@turbostarter/auth/server";

const BROKER_URL = (process.env.BROKER_HTTP_URL || "https://ic.claudemesh.com").replace(/\/$/, "");

export async function POST() {
  const reqHeaders = new Headers(await headers());
  reqHeaders.set("x-client-platform", "web-server");
  const session = await auth.api.getSession({ headers: reqHeaders });

  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const brokerRes = await fetch(`${BROKER_URL}/cli/token`, {
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
