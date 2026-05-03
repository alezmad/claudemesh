import { URLS } from "~/constants/urls.js";
import { TIMINGS } from "~/constants/timings.js";
import { debug } from "~/services/logger/facade.js";
import { ApiError, NetworkError } from "./errors.js";

export interface RequestOpts {
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export async function request<T = unknown>(opts: RequestOpts): Promise<T> {
  const base = opts.baseUrl ?? URLS.API_BASE;
  const url = `${base}${opts.path}`;
  const method = opts.method ?? "GET";

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? TIMINGS.API_TIMEOUT_MS,
  );

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "claudemesh-cli/1.0",
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  debug(`${method} ${url}`);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { /* leave as text */ }
      throw new ApiError(res.status, res.statusText, body);
    }

    const text = await res.text();
    if (!text) return undefined as unknown as T;
    return JSON.parse(text) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new NetworkError(url, err);
  } finally {
    clearTimeout(timeout);
  }
}

export async function get<T = unknown>(path: string, token?: string): Promise<T> {
  return request<T>({ path, token });
}

export async function post<T = unknown>(path: string, body?: unknown, token?: string): Promise<T> {
  return request<T>({ path, method: "POST", body, token });
}

export async function del<T = unknown>(path: string, token?: string): Promise<T> {
  return request<T>({ path, method: "DELETE", token });
}
