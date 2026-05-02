/**
 * Translate the parsed CLI invocation (command + positionals) into the
 * (resource, verb, isWrite) shape that the policy engine evaluates.
 *
 * Returns `null` for commands that are not subject to policy gating:
 *   - local-only ops (help, version, list, doctor, sync, completions)
 *   - auth (login, logout, whoami, register)
 *   - setup (install, uninstall, url-handler, status-line, backup, restore)
 *   - launch / connect (no broker mutation by themselves)
 *
 * Spec: .artifacts/specs/2026-05-02-architecture-north-star.md commitment #7.
 */
export interface InvocationClass {
  resource: string;
  verb: string;
  isWrite: boolean;
}

/** Commands the policy engine never evaluates. Local or auth-only. */
const SKIP = new Set([
  "", "help", "version",
  "login", "register", "logout", "whoami",
  "install", "uninstall", "doctor", "sync", "completions", "url-handler", "status-line",
  "backup", "restore", "upgrade", "update",
  "list", "ls",                          // local mesh list
  "launch", "connect",                   // launches Claude — no broker write
  "status",                              // broker connectivity diagnostic
  "test", "mcp", "hook", "seed-test-mesh",
  "disconnect",                          // duplicate alias only — top-level "disconnect" prints message
]);

/** Verbs that mutate broker state (used by --approval-mode plan / read-only). */
const WRITE_VERBS = new Set([
  "create", "send", "remember", "forget", "remind", "schedule", "summary",
  "visible", "join", "leave", "kick", "ban", "unban", "disconnect", "delete",
  "rename", "share", "invite", "store", "publish", "execute", "set", "remove",
  "pause", "resume", "claim", "complete", "grant", "revoke", "block", "call",
]);

function isWrite(verb: string): boolean {
  return WRITE_VERBS.has(verb);
}

/**
 * Map (command, positionals) → invocation classification.
 * The mapping mirrors the resource/verb namespace used in DEFAULT_POLICY so a
 * `peer kick` rule actually matches both `peer kick` and the legacy `kick`.
 */
export function classifyInvocation(command: string, positionals: string[]): InvocationClass | null {
  if (SKIP.has(command)) return null;

  const sub = positionals[0] ?? "";

  // ── Resource-form commands ───────────────────────────────────────────────
  switch (command) {
    case "peer": {
      const verb = sub || "list";
      return { resource: "peer", verb, isWrite: isWrite(verb) };
    }
    case "message": {
      const verb = sub || "inbox";
      return { resource: "message", verb, isWrite: isWrite(verb) };
    }
    case "memory": {
      const verb = sub || "recall";
      return { resource: "memory", verb, isWrite: isWrite(verb) };
    }
    case "profile": {
      // `profile` (no sub) is read; `profile summary/visible/status set` are writes.
      if (!sub) return { resource: "profile", verb: "view", isWrite: false };
      if (sub === "status") {
        return positionals[1] === "set"
          ? { resource: "profile", verb: "status", isWrite: true }
          : { resource: "profile", verb: "view", isWrite: false };
      }
      return { resource: "profile", verb: sub, isWrite: true };
    }
    case "schedule": {
      const verb = sub || "list";
      return { resource: "schedule", verb, isWrite: verb !== "list" };
    }
    case "group": {
      return { resource: "group", verb: sub || "list", isWrite: sub === "join" || sub === "leave" };
    }
    case "task": {
      return { resource: "task", verb: sub || "list", isWrite: isWrite(sub) };
    }

    // Platform — sub is the verb.
    case "vector": case "graph": case "context": case "stream":
    case "sql":    case "skill": case "vault":   case "watch":
    case "webhook": case "file": case "mesh-mcp": case "clock": {
      const verb = sub || "list";
      return { resource: command, verb, isWrite: isWrite(verb) };
    }

    case "state": {
      const verb = sub === "set" ? "set" : sub === "list" ? "list" : "get";
      return { resource: "state", verb, isWrite: verb === "set" };
    }
  }

  // ── Legacy / flat verb form ──────────────────────────────────────────────
  switch (command) {
    // Mesh management
    case "create": case "new":     return { resource: "mesh", verb: "create", isWrite: true };
    case "join": case "add":       return { resource: "mesh", verb: "join",   isWrite: true };
    case "delete": case "rm":      return { resource: "mesh", verb: "delete", isWrite: true };
    case "rename":                 return { resource: "mesh", verb: "rename", isWrite: true };
    case "share": case "invite":   return { resource: "mesh", verb: "share",  isWrite: true };
    case "info":                   return { resource: "mesh", verb: "info",   isWrite: false };

    // Peer ops (legacy verbs)
    case "peers":                  return { resource: "peer", verb: "list",       isWrite: false };
    case "kick":                   return { resource: "peer", verb: "kick",       isWrite: true  };
    case "ban":                    return { resource: "peer", verb: "ban",        isWrite: true  };
    case "unban":                  return { resource: "peer", verb: "unban",      isWrite: true  };
    case "bans":                   return { resource: "peer", verb: "bans",       isWrite: false };
    case "verify":                 return { resource: "peer", verb: "verify",     isWrite: false };

    // Messaging
    case "send":                   return { resource: "message", verb: "send",   isWrite: true  };
    case "inbox":                  return { resource: "message", verb: "inbox",  isWrite: false };
    case "msg-status":             return { resource: "message", verb: "status", isWrite: false };

    // Memory
    case "remember":               return { resource: "memory", verb: "remember", isWrite: true  };
    case "recall":                 return { resource: "memory", verb: "recall",   isWrite: false };
    case "forget":                 return { resource: "memory", verb: "forget",   isWrite: true  };
    case "remind":                 return { resource: "schedule", verb: "msg",    isWrite: true  };

    // Presence
    case "summary":                return { resource: "profile", verb: "summary", isWrite: true };
    case "visible":                return { resource: "profile", verb: "visible", isWrite: true };

    // Diagnostics
    case "stats":                  return { resource: "mesh", verb: "stats", isWrite: false };
    case "ping":                   return { resource: "mesh", verb: "ping",  isWrite: false };

    // Security
    case "grant":                  return { resource: "grant",  verb: "grant",  isWrite: true  };
    case "revoke":                 return { resource: "grant",  verb: "revoke", isWrite: true  };
    case "block":                  return { resource: "grant",  verb: "block",  isWrite: true  };
    case "grants":                 return { resource: "grant",  verb: "list",   isWrite: false };
  }

  // Unknown command — let the dispatcher's default branch handle it.
  return null;
}
