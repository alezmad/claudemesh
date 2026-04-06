/**
 * MinIO client for file storage.
 *
 * Each mesh gets its own bucket (mesh-{meshId}). Files are stored under
 * a key path that encodes persistence and origin:
 *   - persistent: shared/{fileId}/{originalName}
 *   - ephemeral:  ephemeral/{YYYY-MM-DD}/{fileId}/{originalName}
 */

import { Client } from "minio";
import { env } from "./env";

export const minioClient = new Client({
  endPoint: env.MINIO_ENDPOINT.split(":")[0]!,
  port: parseInt(env.MINIO_ENDPOINT.split(":")[1] || "9000"),
  useSSL: env.MINIO_USE_SSL,
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
});

export async function ensureBucket(name: string): Promise<void> {
  const exists = await minioClient.bucketExists(name);
  if (!exists) await minioClient.makeBucket(name);
}

export function meshBucketName(meshId: string): string {
  return `mesh-${meshId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
}
