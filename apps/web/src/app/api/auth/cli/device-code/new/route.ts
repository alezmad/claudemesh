import { NextResponse } from "next/server";

// In-memory store for device codes (production would use Redis/DB)
// Exported so poll + approve routes can access it
export const deviceCodes = new Map<
  string,
  {
    user_code: string;
    status: "pending" | "approved" | "expired";
    session_token?: string;
    user?: { id: string; display_name: string; email: string };
    hostname: string;
    platform: string;
    arch: string;
    created_at: number;
    expires_at: number;
  }
>();

function generateCode(len: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

// Clean expired codes every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of deviceCodes) {
    if (now > val.expires_at) deviceCodes.delete(key);
  }
}, 5 * 60 * 1000);

export async function POST(request: Request) {
  let body: { hostname?: string; platform?: string; arch?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const device_code = generateCode(16);
  const user_code = generateCode(4) + "-" + generateCode(4);
  const expires_at = Date.now() + 5 * 60 * 1000;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://claudemesh.com";

  deviceCodes.set(device_code, {
    user_code,
    status: "pending",
    hostname: body.hostname ?? "unknown",
    platform: body.platform ?? "unknown",
    arch: body.arch ?? "unknown",
    created_at: Date.now(),
    expires_at,
  });

  return NextResponse.json({
    device_code,
    user_code,
    expires_at: new Date(expires_at).toISOString(),
    verification_url: `${baseUrl}/cli-auth`,
  });
}
