import { NextResponse } from "next/server";

const BROKER_URL = (process.env.BROKER_HTTP_URL || "https://ic.claudemesh.com").replace(/\/$/, "");

export async function POST(request: Request) {
  const body = await request.text();

  const brokerRes = await fetch(`${BROKER_URL}/cli/device-code`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": request.headers.get("x-forwarded-for") ?? "",
    },
    body,
  });

  const brokerBody = await brokerRes.json().catch(() => ({ error: "Broker error" }));
  return NextResponse.json(brokerBody as Record<string, unknown>, { status: brokerRes.status });
}
