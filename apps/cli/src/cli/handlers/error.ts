import { EXIT } from "~/constants/exit-codes.js";
import { red } from "~/ui/styles.js";
export function handleUncaughtError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(red("\n  Fatal: " + msg + "\n"));
  if (process.env.CLAUDEMESH_DEBUG === "1" && err instanceof Error && err.stack) console.error(err.stack);
  process.exit(EXIT.INTERNAL_ERROR);
}
export function installErrorHandlers(): void {
  process.on("uncaughtException", handleUncaughtError);
  process.on("unhandledRejection", (reason) => handleUncaughtError(reason));
}
