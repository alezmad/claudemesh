type ShutdownHook = () => void | Promise<void>;

const hooks: ShutdownHook[] = [];
let registered = false;

function onExit() {
  for (const hook of hooks) {
    try {
      const result = hook();
      if (result instanceof Promise) result.catch(() => {});
    } catch {}
  }
}

export function registerShutdownHook(hook: ShutdownHook): void {
  hooks.push(hook);
  if (!registered) {
    registered = true;
    process.on("exit", onExit);
    process.on("SIGINT", () => { onExit(); process.exit(1); });
    process.on("SIGTERM", () => { onExit(); process.exit(0); });
  }
}

export async function shutdown(): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook();
    } catch {}
  }
  hooks.length = 0;
}
