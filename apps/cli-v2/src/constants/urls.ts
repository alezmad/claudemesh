export const URLS = {
  BROKER: process.env.CLAUDEMESH_BROKER_URL ?? "wss://ic.claudemesh.com/ws",
  API_BASE: process.env.CLAUDEMESH_API_URL ?? "https://claudemesh.com",
  DASHBOARD: "https://claudemesh.com/dashboard",
  NPM_REGISTRY: "https://registry.npmjs.org/claudemesh-cli",
} as const;

// Injected at build time from package.json#version via `bun build --define`
// (see build.ts). Falls back to a dev sentinel when running from source.
declare const __CLAUDEMESH_VERSION__: string;
export const VERSION: string =
  typeof __CLAUDEMESH_VERSION__ !== "undefined" ? __CLAUDEMESH_VERSION__ : "0.0.0-dev";

export const env = {
  CLAUDEMESH_BROKER_URL: URLS.BROKER,
  CLAUDEMESH_CONFIG_DIR: process.env.CLAUDEMESH_CONFIG_DIR || undefined,
  CLAUDEMESH_DEBUG: process.env.CLAUDEMESH_DEBUG === "1" || process.env.CLAUDEMESH_DEBUG === "true",
};
