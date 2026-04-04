#!/usr/bin/env bun
/**
 * @claudemesh/broker entry point.
 *
 * Stands up a WebSocket server, accepts peer connections, and (in step
 * 8) routes E2E-encrypted envelopes between peers joined to the same
 * mesh. For now this is a scaffold: it boots, logs, accepts connections
 * with a stub handler, and shuts down cleanly on SIGTERM/SIGINT.
 */

import { WebSocketServer, type WebSocket } from "ws";
import { env } from "./env";

const VERSION = "0.1.0";

function log(msg: string): void {
  console.error(`[broker] ${msg}`);
}

function handleConnection(ws: WebSocket, remoteAddress: string | undefined): void {
  log(`connection from ${remoteAddress ?? "unknown"}`);

  ws.on("message", (data) => {
    // Step-8 stub: echo message length. Real handler will parse the
    // WSMessage envelope, authenticate the peer by pubkey, and route.
    log(`recv ${data.toString().length} bytes`);
  });

  ws.on("close", () => {
    log("connection closed");
  });

  ws.on("error", (err) => {
    log(`ws error: ${err.message}`);
  });
}

function main(): void {
  const wss = new WebSocketServer({
    host: "0.0.0.0",
    port: env.BROKER_PORT,
  });

  wss.on("connection", (ws, req) => {
    handleConnection(ws, req.socket.remoteAddress);
  });

  wss.on("listening", () => {
    log(`@claudemesh/broker v${VERSION} listening on :${env.BROKER_PORT}`);
    log(
      `config: STATUS_TTL=${env.STATUS_TTL_SECONDS}s HOOK_FRESH=${env.HOOK_FRESH_WINDOW_SECONDS}s`,
    );
  });

  wss.on("error", (err) => {
    log(`server error: ${err.message}`);
    process.exit(1);
  });

  const shutdown = (signal: string): void => {
    log(`${signal} received, shutting down`);
    wss.close(() => {
      log("server closed, bye");
      process.exit(0);
    });
    // Hard exit if close hangs past 5s.
    setTimeout(() => {
      log("forcing exit after 5s");
      process.exit(1);
    }, 5000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
