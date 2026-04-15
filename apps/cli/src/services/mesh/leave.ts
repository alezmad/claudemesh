import { removeMeshConfig } from "~/services/config/facade.js";

export function leaveMesh(slug: string): boolean {
  return removeMeshConfig(slug);
}
