import { EXIT } from "~/constants/exit-codes.js";
const cleanupHooks: Array<() => void> = [];
export function onExit(fn: () => void): void { cleanupHooks.push(fn); }
export function exit(code: number = EXIT.SUCCESS): never {
  for (const fn of cleanupHooks) { try { fn(); } catch {} }
  process.exit(code);
}
