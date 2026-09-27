/**
 * Build info surfaced on /health.
 *
 * gitSha is resolved lazily:
 *   1. GIT_SHA env var (baked in at image build time), unless it's the "unknown" default
 *   2. SOURCE_COMMIT (Coolify injects it at runtime), short form
 *   3. `git rev-parse --short HEAD` (dev)
 *   4. "unknown" if none works
 */

const VERSION = "0.1.0";
const startedAt = Date.now();

let cachedSha: string | null = null;

function resolveGitSha(): string {
  if (cachedSha !== null) return cachedSha;
  // The Dockerfile bakes GIT_SHA=unknown as its ARG default, so a literal
  // "unknown" means "not provided" — fall through to Coolify's runtime
  // SOURCE_COMMIT (full sha). /health read "unknown" in prod because of this.
  const baked = process.env.GIT_SHA;
  if (baked && baked !== "unknown") {
    cachedSha = baked;
    return cachedSha;
  }
  if (process.env.SOURCE_COMMIT) {
    cachedSha = process.env.SOURCE_COMMIT.slice(0, 7);
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
