import { createServer, type Server } from "node:http";

export interface CallbackListener {
  port: number;
  token: Promise<string>;
  close: () => void;
}

export function startCallbackListener(): Promise<CallbackListener> {
  return new Promise((resolveStart) => {
    let resolveToken: (token: string) => void;
    let resolved = false;
    const tokenPromise = new Promise<string>((r) => {
      resolveToken = r;
    });

    const server: Server = createServer((req, res) => {
      const url = new URL(req.url!, "http://localhost");

      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "https://claudemesh.com",
          "Access-Control-Allow-Methods": "GET",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        res.end();
        return;
      }

      if (url.pathname === "/ping") {
        res.writeHead(200, {
          "Content-Type": "text/plain",
          "Access-Control-Allow-Origin": "https://claudemesh.com",
        });
        res.end("ok");
        return;
      }

      if (url.pathname === "/callback") {
        const token = url.searchParams.get("token");
        if (token && !resolved) {
          resolved = true;
          res.writeHead(200, {
            "Content-Type": "text/html",
            "Access-Control-Allow-Origin": "https://claudemesh.com",
          });
          res.end("<html><body><h2>Done! You can close this tab.</h2></body></html>");
          resolveToken(token);
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
