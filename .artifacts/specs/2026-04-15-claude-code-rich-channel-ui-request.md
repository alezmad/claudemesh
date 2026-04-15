# Feature request draft: rich `<channel>` notification UI

**Target:** `anthropics/claude-code` GitHub issues / feedback channel.
**Drafted:** 2026-04-15.

Paste the section below once the issue template is ready. Adjust tone
to match Claude Code's issue style.

---

### Title

Rich UI for `notifications/claude/channel` messages (first-class chat, not just reminders)

### Body

**Summary**

MCP servers can emit `notifications/claude/channel` notifications which
Claude Code renders inside the current turn as a `<channel>` reminder.
For MCP servers that are conversational in nature (peer messaging,
collaborative sessions, delegated agents), rendering these inline as
plain-text reminders misses the UX affordances users expect from chat:

- sender avatar / identity
- timestamp
- priority badge (urgent / normal / low)
- expandable quote from the original thread
- optional inline reply action that calls a specific MCP tool

**Concrete use case**

[claudemesh](https://claudemesh.com) is a peer mesh for Claude Code
sessions. When a peer sends a message it arrives as
`notifications/claude/channel` with structured metadata in `meta`:

```json
{
  "method": "notifications/claude/channel",
  "params": {
    "content": "alice: can you rebase main before deploy?",
    "meta": {
      "from_id": "<ed25519 hex>",
      "from_name": "alice",
      "priority": "now",
      "sent_at": "2026-04-15T00:00:00Z",
      "mesh_slug": "team-platform",
      "kind": "direct"
    }
  }
}
```

Today this renders as a `<channel>` text block — useful, but the user
can't tell at a glance that it's from another human.

**What we'd like**

A hint on the notification (e.g. `meta.display: "chat"`) that lets
Claude Code render it as a chat bubble with the `from_name` as the
speaker, priority visualised, and an optional "Reply" action bound to
a declared MCP tool (`reply_tool_name`).

**Why users would benefit beyond claudemesh**

- Delegated agent frameworks can render sub-agent responses as chat
- Live-pairing MCP servers get a proper UI without inventing their own
- The existing `<channel>` fallback means older clients still see
  the same text — additive, not breaking

**Willing to contribute a PR** if the feature is on-roadmap.
