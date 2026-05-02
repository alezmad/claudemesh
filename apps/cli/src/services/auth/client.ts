import { my } from "~/services/api/facade.js";
import { ApiError } from "~/services/api/facade.js";
import { readConfig } from "~/services/config/facade.js";
import { PATHS } from "~/constants/paths.js";
import { getStoredToken, clearToken } from "./token-store.js";
import { NotSignedIn } from "./errors.js";
import type { WhoAmIResult } from "./schemas.js";

function requireToken(): string {
  const auth = getStoredToken();
  if (!auth) throw new NotSignedIn();
  return auth.session_token;
}

/** Snapshot the local mesh-config view for whoami. Always populated when
 * config.json has any mesh entries — independent of web session state. */
function localView(): WhoAmIResult["local"] {
  const cfg = readConfig();
  if (cfg.meshes.length === 0) return undefined;
  return {
    config_path: PATHS.CONFIG_FILE,
    meshes: cfg.meshes.map((m) => ({
      slug: m.slug,
      mesh_id: m.meshId,
      member_id: m.memberId,
      pubkey_prefix: m.pubkey.slice(0, 12),
    })),
  };
}

export async function whoAmI(): Promise<WhoAmIResult> {
  const auth = getStoredToken();
  const local = localView();

  if (!auth) return { signed_in: false, local };

  try {
    const profile = await my.getProfile(auth.session_token);
    const meshes = await my.getMeshes(auth.session_token);
    const owned = meshes.filter((m) => m.role === "owner").length;
    return {
      signed_in: true,
      user: profile,
      token_source: auth.token_source,
      meshes: { owned, guest: meshes.length - owned },
      local,
    };
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthorized) {
      clearToken();
      return { signed_in: false, local };
    }
    throw err;
  }
}

export async function logout(): Promise<{ revoked: boolean }> {
  const token = requireToken();
  let revoked = false;
  try {
    await my.revokeSession(token);
    revoked = true;
  } catch {}
  clearToken();
  return { revoked };
}

export async function register(callbackPort: number): Promise<void> {
  const { openBrowser } = await import("~/services/spawn/facade.js");
  const url = `https://claudemesh.com/register?source=cli&callback=http://localhost:${callbackPort}`;
  await openBrowser(url);
}
