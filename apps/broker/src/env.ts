import { z } from "zod";

/**
 * Broker environment config.
 *
 * Validated at startup with Zod. Fails fast with a useful error if any
 * required var is missing or malformed. Defaults mirror the values
 * proven out in the claude-intercom prototype so local dev works
 * without a .env file.
 */
const envSchema = z.object({
  BROKER_PORT: z.coerce.number().int().positive().default(7899),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  STATUS_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  HOOK_FRESH_WINDOW_SECONDS: z.coerce.number().int().positive().default(30),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
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
