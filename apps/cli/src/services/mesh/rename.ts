import { my } from "~/services/api/facade.js";
import { getStoredToken } from "~/services/auth/facade.js";

export async function renameMesh(oldSlug: string, newSlug: string): Promise<{ slug: string }> {
  const auth = getStoredToken();
  if (!auth) throw new Error("Not signed in");
  return await my.renameMesh(auth.session_token, oldSlug, newSlug);
}
