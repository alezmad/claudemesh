import { request as httpRequest } from "node:http";

import { DAEMON_PATHS, DAEMON_TCP_HOST, DAEMON_TCP_DEFAULT_PORT } from "../paths.js";
import { readLocalToken } from "../local-token.js";

export interface IpcRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  /** Force TCP loopback instead of UDS (for tests / cross-container scenarios). */
  preferTcp?: boolean;
  timeoutMs?: number;
}

export interface IpcResponse<T = unknown> {
  status: number;
  body: T;
}

export class IpcError extends Error {
  constructor(public status: number, public payload: unknown, msg: string) {
    super(msg);
  }
}

/** Small, dependency-free IPC client for talking to the local daemon. */
export async function ipc<T = unknown>(opts: IpcRequestOptions): Promise<IpcResponse<T>> {
  const useTcp = !!opts.preferTcp;
  const headers: Record<string, string> = {
    accept: "application/json",
    host: "localhost",
  };

  let bodyBuf: Buffer | undefined;
  if (opts.body !== undefined) {
    bodyBuf = Buffer.from(JSON.stringify(opts.body), "utf8");
    headers["content-type"] = "application/json";
    headers["content-length"] = String(bodyBuf.length);
  }

  if (useTcp) {
    const tok = readLocalToken();
    if (!tok) throw new IpcError(0, null, "daemon local token not found; is the daemon running?");
    headers.authorization = `Bearer ${tok}`;
  }

  return new Promise<IpcResponse<T>>((resolve, reject) => {
    const req = httpRequest(
      useTcp
        ? { host: DAEMON_TCP_HOST, port: DAEMON_TCP_DEFAULT_PORT, path: opts.path, method: opts.method ?? "GET", headers }
        : { socketPath: DAEMON_PATHS.SOCK_FILE,                     path: opts.path, method: opts.method ?? "GET", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown = raw;
          try { parsed = raw.length > 0 ? JSON.parse(raw) : null; } catch { /* leave raw */ }
          resolve({ status: res.statusCode ?? 0, body: parsed as T });
        });
      },
    );
    req.setTimeout(opts.timeoutMs ?? 5_000, () => req.destroy(new Error("ipc_timeout")));
    req.on("error", (err) => reject(err));
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}
