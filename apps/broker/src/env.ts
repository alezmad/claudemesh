import { z } from "zod";

/**
 * Broker environment config.
 *
 * Validated at startup with Zod. Fails fast with a useful error if any
 * required var is missing or malformed.
 */
const envSchema = z.object({
  BROKER_PORT: z.coerce.number().int().positive().default(7900),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (u) => /^postgres(ql)?:\/\//.test(u),
      "DATABASE_URL must be a postgres:// or postgresql:// connection string",
    ),
  STATUS_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  HOOK_FRESH_WINDOW_SECONDS: z.coerce.number().int().positive().default(30),
  MAX_CONNECTIONS_PER_MESH: z.coerce.number().int().positive().default(100),
  MAX_MESSAGE_BYTES: z.coerce.number().int().positive().default(65_536),
  HOOK_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(30),
  MINIO_ENDPOINT: z.string().default("minio:9000"),
  MINIO_ACCESS_KEY: z.string().default("claudemesh"),
  MINIO_SECRET_KEY: z.string().default("changeme"),
  MINIO_USE_SSL: z.enum(["true", "false", ""]).transform(v => v === "true").default("false"),
  QDRANT_URL: z.string().default("http://qdrant:6333"),
  NEO4J_URL: z.string().default("bolt://neo4j:7687"),
  NEO4J_USER: z.string().default("neo4j"),
  NEO4J_PASSWORD: z.string().default("changeme"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  GIT_SHA: z.string().optional(),
});

export type BrokerEnv = z.infer<typeof envSchema>;

export function loadEnv(): BrokerEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("[broker] invalid environment:");
    console.error(z.treeifyError(parsed.error));
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
