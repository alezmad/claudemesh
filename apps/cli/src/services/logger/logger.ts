const isDebug = process.env.CLAUDEMESH_DEBUG === "1" || process.env.CLAUDEMESH_DEBUG === "true";
const isQuiet = process.argv.includes("-q") || process.argv.includes("--quiet");

function timestamp(): string {
  return new Date().toISOString();
}

export function log(msg: string, ...args: unknown[]): void {
  if (!isQuiet) console.log(msg, ...args);
}

export function debug(msg: string, ...args: unknown[]): void {
  if (isDebug) console.error(`[${timestamp()}] DEBUG ${msg}`, ...args);
}

export function warn(msg: string, ...args: unknown[]): void {
  console.error(`⚠ ${msg}`, ...args);
}

export function error(msg: string, ...args: unknown[]): void {
  console.error(`✘ ${msg}`, ...args);
}
