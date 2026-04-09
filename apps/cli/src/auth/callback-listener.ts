/**
 * Localhost HTTP callback listener for CLI-to-browser sync flow.
 *
 * Endpoints:
 *   GET /ping     → reachability check (web page preflight)
 *   GET /callback → receives sync token via ?token= query param
 *   OPTIONS *     → CORS preflight for claudemesh.com
 */

import { createServer, type Server } from "node:http";

export interface CallbackListener {
  /** Port the server is listening on. */
  port: number;
  /** Resolves when the /callback endpoint receives a token. */
  token: Promise<string>;
  /** Shut down the server. */
  close: () => void;
}

/**
 * Start a localhost HTTP server on a random OS-assigned port.
 * Returns the port and a promise that resolves with the sync token.
 */
export function startCallbackListener(): Promise<CallbackListener> {
  return new Promise((resolveStart) => {
    let resolveToken: (token: string) => void;
    const tokenPromise = new Promise<string>((r) => {
      resolveToken = r;
    });

    const server: Server = createServer((req, res) => {
      const url = new URL(req.url!, "http://localhost");

      // CORS preflight
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "https://claudemesh.com",
          "Access-Control-Allow-Methods": "GET",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        res.end();
        return;
      }

      // Reachability check — web page calls this before redirecting
      if (url.pathname === "/ping") {
        res.writeHead(200, {
          "Content-Type": "text/plain",
          "Access-Control-Allow-Origin": "https://claudemesh.com",
        });
        res.end("ok");
        return;
      }

      // Sync token callback
      if (url.pathname === "/callback") {
        const token = url.searchParams.get("token");
        if (token) {
          res.writeHead(200, {
            "Content-Type": "text/html",
            "Access-Control-Allow-Origin": "https://claudemesh.com",
          });
          res.end(
            "<html><body><h2>Done! You can close this tab.</h2><p>Launching claudemesh...</p></body></html>",
          );
          resolveToken(token);
          // Close server after a short delay to ensure response is sent
          setTimeout(() => server.close(), 500);
        } else {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Missing token");
        }
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolveStart({
        port: addr.port,
        token: tokenPromise,
        close: () => server.close(),
      });
    });
  });
}
