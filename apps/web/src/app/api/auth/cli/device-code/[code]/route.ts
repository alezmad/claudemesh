import { NextResponse } from "next/server";
import { deviceCodes } from "../new/route";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const entry = deviceCodes.get(code);

  if (!entry) {
    return NextResponse.json({ status: "expired" });
  }

  if (Date.now() > entry.expires_at) {
    entry.status = "expired";
    deviceCodes.delete(code);
    return NextResponse.json({ status: "expired" });
  }

  if (entry.status === "approved") {
    // Return token once, then clean up
    const response = {
      status: "approved",
      session_token: entry.session_token,
      user: entry.user,
    };
    deviceCodes.delete(code);
    return NextResponse.json(response);
  }

  return NextResponse.json({ status: "pending" });
}
