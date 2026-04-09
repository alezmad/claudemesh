/**
 * POST /cli-sync handler.
 *
 * Accepts a sync JWT from the dashboard, creates or finds member rows
 * for each mesh in the token, and returns mesh details + member IDs.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { verifySyncToken, type SyncTokenPayload } from "./jwt";

// Import schema tables
import {
  mesh as meshTable,
  meshMember as memberTable,
} from "@turbostarter/db/schema/mesh";
import { generateId } from "@turbostarter/shared/utils";

export interface CliSyncRequest {
  sync_token: string;
  peer_pubkey: string;   // ed25519 hex (64 chars)
  display_name: string;
}

export interface CliSyncResponse {
  ok: true;
  account_id: string;
  meshes: Array<{
    mesh_id: string;
    slug: string;
    broker_url: string;
    member_id: string;
    role: "admin" | "member";
  }>;
}

export interface CliSyncError {
  ok: false;
  error: string;
}

export async function handleCliSync(
  body: CliSyncRequest,
): Promise<CliSyncResponse | CliSyncError> {
  // 1. Validate inputs
  if (!body.sync_token || !body.peer_pubkey || !body.display_name) {
    return { ok: false, error: "sync_token, peer_pubkey, display_name required" };
  }
  if (!/^[0-9a-f]{64}$/i.test(body.peer_pubkey)) {
    return { ok: false, error: "peer_pubkey must be 64 hex chars (32 bytes)" };
  }

  // 2. Verify JWT
  const tokenResult = await verifySyncToken(body.sync_token);
  if (!tokenResult.ok) {
    return { ok: false, error: `sync token invalid: ${tokenResult.error}` };
  }
  const payload = tokenResult.payload;

  // 3. For each mesh in the token, create or find a member row
  const resultMeshes: CliSyncResponse["meshes"] = [];

  for (const tokenMesh of payload.meshes) {
    // Verify mesh exists and is not archived
    const [m] = await db
      .select({ id: meshTable.id, slug: meshTable.slug })
      .from(meshTable)
      .where(and(eq(meshTable.id, tokenMesh.id), isNull(meshTable.archivedAt)));

    if (!m) {
      // Skip meshes that don't exist (could have been deleted)
      continue;
    }

    // Check if this pubkey is already a member of this mesh
    const [existing] = await db
      .select({ id: memberTable.id, role: memberTable.role })
      .from(memberTable)
      .where(
        and(
          eq(memberTable.meshId, tokenMesh.id),
          eq(memberTable.peerPubkey, body.peer_pubkey),
          isNull(memberTable.revokedAt),
        ),
      );

    let memberId: string;
    let role: "admin" | "member";

    if (existing) {
      // Already a member — update dashboard link + display name
      memberId = existing.id;
      role = existing.role;
      await db
        .update(memberTable)
        .set({
          dashboardUserId: payload.sub,
          displayName: body.display_name,
        })
        .where(eq(memberTable.id, existing.id));
    } else {
      // Create new member row
      memberId = generateId();
      role = tokenMesh.role;
      await db.insert(memberTable).values({
        id: memberId,
        meshId: tokenMesh.id,
        peerPubkey: body.peer_pubkey,
        displayName: body.display_name,
        role: tokenMesh.role,
        dashboardUserId: payload.sub,
      });
    }

    resultMeshes.push({
      mesh_id: tokenMesh.id,
      slug: m.slug,
      broker_url: process.env.BROKER_PUBLIC_URL ?? "wss://ic.claudemesh.com/ws",
      member_id: memberId,
      role,
    });
  }

  if (resultMeshes.length === 0) {
    return { ok: false, error: "no valid meshes found in sync token" };
  }

  return {
    ok: true,
    account_id: payload.sub,
    meshes: resultMeshes,
  };
}
