export { loginWithDeviceCode } from "./device-code.js";
export type { DeviceCodeResult } from "./device-code.js";
export { whoAmI, logout, register } from "./client.js";
export { syncWithBroker } from "./dashboard-sync.js";
export type { SyncResult } from "./dashboard-sync.js";
export { getStoredToken, storeToken, clearToken } from "./token-store.js";
export { startCallbackListener } from "./callback-listener.js";
export type { CallbackListener } from "./callback-listener.js";
export { AuthError, DeviceCodeExpired, NotSignedIn } from "./errors.js";
export type { StoredAuth, WhoAmIResult } from "./schemas.js";
import { randomBytes } from "node:crypto";
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
export function generatePairingCode(): string {
  const bytes = randomBytes(4);
  return Array.from(bytes, (b) => CHARS[b % CHARS.length]).join("");
}
