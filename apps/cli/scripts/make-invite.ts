#!/usr/bin/env bun
/**
 * Build a test invite link from a seeded mesh (reads /tmp/cli-seed.json).
 * Writes the link to stdout.
 */

import { readFileSync } from "node:fs";
import { encodeInviteLink } from "../src/invite/parse";

const seed = JSON.parse(readFileSync("/tmp/cli-seed.json", "utf-8")) as {
  meshId: string;
};

const link = encodeInviteLink({
  v: 1,
  mesh_id: seed.meshId,
  mesh_slug: "rt-join",
  broker_url: process.env.BROKER_WS_URL ?? "ws://localhost:7900/ws",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  mesh_root_key: "Y2xhdWRlbWVzaC10ZXN0LW1lc2gta2V5LWRldm9ubHk",
  role: "member",
});

console.log(link);
