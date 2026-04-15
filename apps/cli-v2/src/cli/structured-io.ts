export function jsonOutput<T>(data: T): string {
  return JSON.stringify({ schema_version: "1.0", ...data }, null, 2);
}
export function writeJson<T>(data: T): void { console.log(jsonOutput(data)); }
