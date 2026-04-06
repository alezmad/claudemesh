import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "./env";

export const qdrant = new QdrantClient({ url: env.QDRANT_URL });

export function meshCollectionName(
  meshId: string,
  collection: string,
): string {
  return `mesh_${meshId}_${collection}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

export async function ensureCollection(
  name: string,
  vectorSize = 1536,
): Promise<void> {
  try {
    await qdrant.getCollection(name);
  } catch {
    await qdrant.createCollection(name, {
      vectors: { size: vectorSize, distance: "Cosine" },
    });
  }
}
