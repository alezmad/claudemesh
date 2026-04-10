# claudemesh — the pitch (in Alejandro's voice)

Source: WhatsApp conversation, April 9 2026. Raw, unedited.

---

## What it is

A swarm — collaborative context, not an orchestrator.

Claude Code sessions interconnect as peers. Each session sets a role or job description. Any peer can talk to any other peer. Messages go to one session, a group, or the whole mesh. Each group can have a lead.

## How it works

- A message to the mesh gets multi-answered by several sessions or just the lead, depending on configuration
- One Telegram can connect to multiple Claude Code sessions at once
- MCPs are shared between all, a group, or specific entities — they belong to the mesh, not a single session
- Same for commands and skills
- Comms are E2E encrypted; the broker is a handler that can't read messages
- That's why claudemesh-cli is open source — to prove the security

## Who it's for

Enterprise dev teams. They don't need Slack, WhatsApp, or any other tool. Team members connected to claudemesh use their own Claude Code sessions to answer any question resolved through the swarm's collaborative context.

## Why it matters

### Cross-project integration
A backend Claude Code session talks to a frontend session. Example: understand the requirements for authenticating to an API, or the data structure of an endpoint — instantly, across repos.

### Multi-perspective research
For financials: load skills per business domain. Launch an orchestrator to research a product through marketing, legal, UX, compliance — simultaneously, with shared MCPs.

### Bias correction
An LLM gets biased along time. Solved through multi-perspective approach: each session is loaded with its own specific context, not a context for all.

### Enterprise standardization
At enterprise level, it makes no sense not to have a Claude Code standard for everyone — common resources, easy to connect. Right now there's UX friction everywhere: MCP installation, connections, skills setup. claudemesh, once set up, solves that.

## Install

Two commands. That's it.
