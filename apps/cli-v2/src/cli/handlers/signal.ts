import { SHOW_CURSOR } from "~/ui/styles.js";
export function installSignalHandlers(): void {
  const cleanup = () => { process.stdout.write(SHOW_CURSOR); };
  process.on("SIGINT", () => { cleanup(); process.exit(1); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
}
