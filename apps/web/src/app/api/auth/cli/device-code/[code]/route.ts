import { NextResponse } from "next/server";

const BROKER_URL = (process.env.BROKER_HTTP_URL || "https://ic.claudemesh.com").replace(/\/$/, "");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;

  const brokerRes = await fetch(`${BROKER_URL}/cli/device-code/${code}`);
  const brokerBody = await brokerRes.json().catch(() => ({ status: "expired" }));

  return NextResponse.json(brokerBody as Record<string, unknown>, { status: brokerRes.status });
}
