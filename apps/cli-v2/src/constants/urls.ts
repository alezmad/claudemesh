export const URLS = {
  BROKER: process.env.CLAUDEMESH_BROKER_URL ?? "wss://ic.claudemesh.com/ws",
  API_BASE: process.env.CLAUDEMESH_API_URL ?? "https://claudemesh.com",
  DASHBOARD: "https://claudemesh.com/dashboard",
  NPM_REGISTRY: "https://registry.npmjs.org/claudemesh-cli",
} as const;

export const VERSION = "1.0.0-alpha.27";

export const env = {
  CLAUDEMESH_BROKER_URL: URLS.BROKER,
  CLAUDEMESH_CONFIG_DIR: process.env.CLAUDEMESH_CONFIG_DIR || undefined,
  CLAUDEMESH_DEBUG: process.env.CLAUDEMESH_DEBUG === "1" || process.env.CLAUDEMESH_DEBUG === "true",
};
