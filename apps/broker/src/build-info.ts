/**
 * Build info surfaced on /health.
 *
 * gitSha is resolved lazily:
 *   1. GIT_SHA env var (preferred — baked in at image build time)
 *   2. `git rev-parse --short HEAD` (dev)
 *   3. "unknown" if neither works
 */

const VERSION = "0.1.0";
const startedAt = Date.now();

let cachedSha: string | null = null;

function resolveGitSha(): string {
  if (cachedSha !== null) return cachedSha;
  if (process.env.GIT_SHA) {
    cachedSha = process.env.GIT_SHA;
    return cachedSha;
  }
  try {
    const proc = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], {
      stderr: "ignore",
    });
    const sha = new TextDecoder().decode(proc.stdout).trim();
    cachedSha = sha || "unknown";
  } catch {
    cachedSha = "unknown";
  }
  return cachedSha;
}

export function buildInfo(): {
  version: string;
  gitSha: string;
  uptime: number;
} {
  return {
    version: VERSION,
    gitSha: resolveGitSha(),
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  };
}

export { VERSION };
