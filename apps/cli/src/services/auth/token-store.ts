import { readFileSync, writeFileSync, unlinkSync, existsSync, chmodSync, openSync, closeSync } from "node:fs";
import { PATHS } from "~/constants/paths.js";
import { ensureConfigDir } from "~/services/config/facade.js";
import type { StoredAuth } from "./schemas.js";

export function getStoredToken(): StoredAuth | null {
  if (!existsSync(PATHS.AUTH_FILE)) return null;
  try {
    const raw = readFileSync(PATHS.AUTH_FILE, "utf-8");
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

export function storeToken(auth: Omit<StoredAuth, "stored_at">): void {
  ensureConfigDir();
  const data: StoredAuth = { ...auth, stored_at: new Date().toISOString() };
  const content = JSON.stringify(data, null, 2) + "\n";
  const fd = openSync(PATHS.AUTH_FILE, "w", 0o600);
  try {
    writeFileSync(fd, content, "utf-8");
  } finally {
    closeSync(fd);
  }
}

export function clearToken(): void {
  try { unlinkSync(PATHS.AUTH_FILE); } catch {}
}
