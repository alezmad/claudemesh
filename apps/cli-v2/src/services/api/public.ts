import { post, get, request } from "./client.js";
import { URLS } from "~/constants/urls.js";

const BROKER_HTTP = URLS.BROKER.replace("wss://", "https://").replace("ws://", "http://").replace("/ws", "");

export async function claimInvite(code: string, body: { pubkey: string; display_name: string }) {
  return post<{
    meshId: string;
    memberId: string;
    slug: string;
    name: string;
    brokerUrl: string;
    rootKey?: string;
  }>(`/api/public/invites/${code}/claim`, body);
}

export async function requestDeviceCode(deviceInfo: {
  hostname: string;
  platform: string;
  arch: string;
}) {
  return request<{
    device_code: string;
    user_code: string;
    session_id: string;
    expires_at: string;
    verification_url: string;
    token_url: string;
  }>({
    path: "/cli/device-code",
    method: "POST",
    body: deviceInfo,
    baseUrl: BROKER_HTTP,
  });
}

export async function pollDeviceCode(deviceCode: string) {
  return request<{
    status: "pending" | "approved" | "expired";
    session_token?: string;
    user?: { id: string; display_name: string; email: string };
  }>({
    path: `/cli/device-code/${deviceCode}`,
    baseUrl: BROKER_HTTP,
  });
}
