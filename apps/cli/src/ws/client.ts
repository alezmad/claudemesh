/**
 * WS client to the broker (STUB).
 *
 * Final implementation in Step 15b — connects to broker, sends hello
 * (with signed nonce), pumps messages to/from the MCP server, handles
 * reconnect. For now just a placeholder type surface so the MCP
 * server can depend on it.
 */

import type { JoinedMesh } from "../state/config";

export interface BrokerConnection {
  meshId: string;
  isConnected(): boolean;
  sendMessage(args: {
    targetSpec: string;
    priority: "now" | "next" | "low";
    nonce: string;
    ciphertext: string;
  }): Promise<{ ok: boolean; messageId?: string; error?: string }>;
  close(): void;
}

/**
 * Stub broker connection. Returns "not implemented" errors on every
 * call. Real implementation in 15b will connect to env.CLAUDEMESH_BROKER_URL.
 */
export function connectBroker(_mesh: JoinedMesh): BrokerConnection {
  return {
    meshId: _mesh.meshId,
    isConnected: () => false,
    sendMessage: async () => ({
      ok: false,
      error: "broker client not implemented (Step 15b)",
    }),
    close: () => {
      /* noop */
    },
  };
}
