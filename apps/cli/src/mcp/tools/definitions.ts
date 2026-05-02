/**
 * MCP tool definitions exposed to Claude Code.
 *
 * Empty in 1.5.0: claudemesh's MCP role is a tool-less push-pipe. Inbound
 * peer messages arrive as `claude/channel` notifications (still wired in
 * server.ts); every other action (send, list peers, profile, vector, sql,
 * task, schedule…) lives behind `claudemesh <verb>` and is taught to Claude
 * via the bundled skill at ~/.claude/skills/claudemesh/SKILL.md.
 *
 * Spec: .artifacts/specs/2026-05-02-architecture-north-star.md commitments
 * #1 (CLI is the API), #6 (MCP is a tool-less push-pipe).
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const TOOLS: Tool[] = [];
