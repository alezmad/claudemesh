export function logToolCall(toolName: string, durationMs: number): void {
  if (process.env.CLAUDEMESH_DEBUG === "1") process.stderr.write("[mcp] " + toolName + " (" + durationMs + "ms)\n");
}
