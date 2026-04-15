import { my } from "~/services/api/facade.js";
import { getStoredToken } from "~/services/auth/facade.js";

export async function renameMesh(slug: string, newName: string): Promise<void> {
  const auth = getStoredToken();
  if (!auth) throw new Error("Not signed in");
  await my.renameMesh(auth.session_token, slug, newName);
}
