/**
 * `claudemesh profile` — view or edit your member profile.
 *
 * Profile fields (roleTag, groups, messageMode, displayName) are persistent
 * on the server. Changes are pushed to active sessions in real-time.
 */

import { readConfig } from "~/services/config/facade.js";
import { BrokerClient } from "~/services/broker/facade.js";

export interface ProfileFlags {
  mesh?: string;
  "role-tag"?: string;
  groups?: string;
  "message-mode"?: string;
  name?: string;
  member?: string;  // admin only: edit another member
  json?: boolean;
}

export async function runProfile(flags: ProfileFlags): Promise<void> {
  const useColor = !process.env.NO_COLOR && process.env.TERM !== "dumb" && process.stdout.isTTY;
  const dim = (s: string): string => (useColor ? `\x1b[2m${s}\x1b[22m` : s);
  const green = (s: string): string => (useColor ? `\x1b[32m${s}\x1b[39m` : s);

  const config = readConfig();
  if (config.meshes.length === 0) {
    console.error("No meshes joined. Run `claudemesh join <url>` first.");
    process.exit(1);
  }

  // Pick mesh
  const mesh = flags.mesh
    ? config.meshes.find(m => m.slug === flags.mesh)
    : config.meshes[0]!;

  if (!mesh) {
    console.error(`Mesh "${flags.mesh}" not found. Joined: ${config.meshes.map(m => m.slug).join(", ")}`);
    process.exit(1);
  }

  // Derive broker HTTP URL from WSS URL
  const brokerUrl = mesh.brokerUrl.replace("wss://", "https://").replace("ws://", "http://").replace(/\/ws\/?$/, "");

  const hasEdits = flags["role-tag"] !== undefined || flags.groups !== undefined || flags["message-mode"] !== undefined || flags.name !== undefined;

  if (hasEdits) {
    // PATCH member profile
    const targetMemberId = flags.member ?? mesh.memberId; // TODO: resolve --member by name
    const body: Record<string, unknown> = {};
    if (flags.name !== undefined) body.displayName = flags.name;
    if (flags["role-tag"] !== undefined) body.roleTag = flags["role-tag"];
    if (flags.groups !== undefined) {
      body.groups = flags.groups.split(",").map(s => {
        const [name, role] = s.trim().split(":");
        return role ? { name: name!, role } : { name: name! };
      });
    }
    if (flags["message-mode"] !== undefined) body.messageMode = flags["message-mode"];

    const res = await fetch(`${brokerUrl}/mesh/${mesh.meshId}/member/${targetMemberId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Member-Id": mesh.memberId,
      },
      body: JSON.stringify(body),
    });

    const result = await res.json() as Record<string, unknown>;
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.ok) {
      console.log(green("✓ Profile updated"));
      const member = result.member as Record<string, unknown>;
      printProfile(member, dim);
    } else {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }
  } else {
    // GET members list, show current user's profile
    const res = await fetch(`${brokerUrl}/mesh/${mesh.meshId}/members`);
    const result = await res.json() as { ok: boolean; members?: Array<Record<string, unknown>>; error?: string };

    if (!result.ok) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }

    const me = result.members?.find(m => m.id === mesh.memberId);
    if (flags.json) {
      console.log(JSON.stringify(me ?? {}, null, 2));
    } else if (me) {
      printProfile(me, dim);
    } else {
      console.log("Member not found in mesh.");
    }
  }
}

function printProfile(member: Record<string, unknown>, dim: (s: string) => string): void {
  const groups = member.groups as Array<{ name: string; role?: string }> | undefined;
  const groupStr = groups?.length
    ? groups.map(g => g.role ? `${g.name} (${g.role})` : g.name).join(", ")
    : dim("(none)");

  console.log(`  Name:     ${member.displayName ?? dim("(not set)")}`);
  console.log(`  Role:     ${member.roleTag ?? dim("(not set)")}`);
  console.log(`  Groups:   ${groupStr}`);
  console.log(`  Messages: ${member.messageMode ?? "push"}`);
  console.log(`  Access:   ${member.permission ?? "member"}`);
  console.log(`  Mesh:     ${dim(String(member.id ?? ""))}`);
}
