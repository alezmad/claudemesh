import neo4j from "neo4j-driver";
import { env } from "./env";

export const neo4jDriver = neo4j.driver(
  env.NEO4J_URL,
  neo4j.auth.basic(env.NEO4J_USER, env.NEO4J_PASSWORD),
);

export function meshDbName(meshId: string): string {
  return `mesh_${meshId.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

export async function ensureDatabase(name: string): Promise<void> {
  const session = neo4jDriver.session({ database: "system" });
  try {
    await session.run(`CREATE DATABASE $name IF NOT EXISTS`, { name });
  } catch {
    /* may not support multi-db in community edition — fall back to default */
  } finally {
    await session.close();
  }
}
