/**
 * CLI environment config.
 *
 * Read once at startup. Overridable via env vars so users can point
 * at a self-hosted broker or a staging instance without rebuilding.
 */

export interface CliEnv {
  CLAUDEMESH_BROKER_URL: string;
  CLAUDEMESH_CONFIG_DIR: string | undefined;
  CLAUDEMESH_DEBUG: boolean;
}

export function loadEnv(): CliEnv {
  return {
    CLAUDEMESH_BROKER_URL:
      process.env.CLAUDEMESH_BROKER_URL ?? "wss://ic.claudemesh.com/ws",
    CLAUDEMESH_CONFIG_DIR: process.env.CLAUDEMESH_CONFIG_DIR || undefined,
    CLAUDEMESH_DEBUG: process.env.CLAUDEMESH_DEBUG === "1" || process.env.CLAUDEMESH_DEBUG === "true",
  };
}

export const env = loadEnv();
