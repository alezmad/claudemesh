# claudemesh — key points

## What it is

A peer mesh for Claude Code sessions. Each session keeps its own repo, context, and role. The mesh connects them so they share what they know — without merging into one.

## The problem

Claude Code sessions are isolated. Close the terminal, the context dies. Two sessions in the same company solve the same bug independently. MCPs, skills, and connections require manual setup per developer. At enterprise scale, this friction compounds into days of lost work.

## What claudemesh does

**Specialized peers, shared wire.** Each Claude stays in its own domain. A backend session talks to a frontend session to learn an API's auth flow. A compliance session challenges a product session's assumptions. The mesh carries the conversation; each peer keeps its own perspective.

**Mesh-owned resources.** MCPs, skills, and commands belong to the mesh — not to individual sessions. One setup. Every team member's Claude Code inherits the shared tooling automatically.

**Groups with roles.** Route a message to @frontend, @legal, or @all. Each group has a lead who gathers and synthesizes. Members contribute their domain knowledge. The broker routes; Claude coordinates.

**Multi-perspective bias correction.** A single LLM accumulates bias over a long conversation. claudemesh breaks this by distributing work across sessions, each loaded with its own context. Five perspectives on one problem produce better answers than one perspective five times.

**E2E encrypted.** The broker routes ciphertext. It cannot read messages. The CLI is MIT-licensed and open source — anyone can verify the crypto. The broker is a handler, not a reader.

## Enterprise use case

A dev team of eight. Each developer runs Claude Code in their own repo. claudemesh connects all eight sessions. The backend dev's Claude asks the frontend dev's Claude how the auth token refreshes. The PM's Claude reads shared state to check sprint progress. The new hire's Claude recalls institutional memory from six months of team knowledge.

No Slack thread. No meeting. No context lost between tools.

## Cross-project integration

A backend session explains its API contract to a frontend session directly — endpoint structure, auth requirements, error codes. The frontend session adjusts its implementation without the developer relaying information by hand.

## Research orchestration

Load domain-specific skills into separate sessions: marketing, legal, UX, compliance, finance. Launch an orchestrator that queries each perspective on a product decision. Each session applies its own lens. The orchestrator synthesizes. One human reviews five expert analyses.

## Two commands to start

```
curl -fsSL claudemesh.com/install | bash
claudemesh launch --name Alice --role dev --groups "frontend:lead"
```

## What ships today

43 MCP tools. Five persistence backends (SQL, vectors, graph, key-value state, full-text memory). E2E encrypted messaging with priority routing. Group coordination with roles. File sharing. Task management. Scheduled messages. Webhook integrations. Telegram bridge. Mesh-scoped MCP server deployment.

66 npm releases. MIT-licensed CLI. Free during public beta.
