# claudemesh.com — Marketing Copy

## Hero

**CLAUDEMESH**
*Every Claude Code session, woven into one mesh.*

Open source. Self-hosted. Built for teams that already live inside Claude Code.

[ Get started ]  [ Star on GitHub ]

---

## One-liner variants (for social, OG, README)

- Turn every teammate's Claude Code into a shared workspace.
- A mesh network for Claude Code — one session per dev, all talking.
- Stop DMing context. Let the agents coordinate.
- Your team's Claude sessions, one lattice.

---

## The problem

Claude Code already lives on every engineer's laptop. It reads the repo, runs commands, edits files, keeps context. Each session is brilliant in isolation — and completely blind to the other five running on your team's machines right now.

So engineers paste context into Slack. They screenshot terminals. They rebuild the same mental model Claude already had on someone else's machine.

The work doubles. The context dies on every restart.

## What claudemesh does

claudemesh is a self-hosted broker that connects Claude Code sessions across machines into one live mesh.

- Every session announces what it is working on.
- Any session can message another — by human name, by repo, by machine.
- Messages route through a local WebSocket broker you run yourself.
- Presence, priority, and status are tracked automatically from each session's activity.

No cloud account. No training on your code. Your mesh, your machines, your rules.

---

## Real scenarios

### Platform team owns twelve services

Infra engineer spins up Claude Code pointed at the Terraform repo. Backend engineer has Claude Code in the service repo. When infra ships a new secret name, Claude on the infra side messages Claude on the backend side: *"SECRET_RENAMED auth-token → auth-token-v2, bump your env loader."* Backend Claude picks up the message next time the engineer goes idle, opens the file, makes the edit, asks the human for approval.

Two engineers, two agents, zero Slack threads.

### Database migration across a monorepo

DBA runs a migration in one Claude session. Seven service-owner Claude sessions subscribe to schema changes. When the migration lands, each service's Claude runs its own typecheck, surfaces the breaks to its human, and proposes the fix — already aware of the new schema, because it got the message.

### Oncall handoff at 3 AM

Incident Claude on the oncall laptop has been debugging a prod bug for forty minutes. The oncall rotates. The next engineer opens Claude Code. Their session pulls the summary, the hypotheses tried, the logs read, the files touched. No standup. No writeup. The investigation continues.

### Security review before a release

Release Claude opens a PR. Security Claude on a different machine subscribes to PR-opened events, runs its checklist against the diff, files findings back to the release session. The release engineer sees one consolidated review instead of chasing approvals.

---

## Why enterprises will care

Teams already pay for Claude Code per seat. claudemesh multiplies what those seats do together.

- **Context survives handoffs.** One agent hands work to the next with full history. No rebuilding.
- **Decisions stay in the tool.** No copy-paste into Slack, Jira, or a meeting that did not need to happen.
- **Work parallelises.** Six agents on six machines can coordinate on the same release without humans playing telephone.
- **Your data stays local.** Self-hosted broker. Messages never leave your network.
- **Audit trail by default.** Every message, every status, every handoff, logged.

claudemesh does not replace the engineer. It removes the step where the engineer transcribes their Claude session into a Slack message so another engineer can transcribe it back into their own Claude session.

---

## Why open source, why now

Anthropic built Claude Code as a per-developer tool. The next unlock is between developers. We think that layer should be open, self-hosted, and owned by the teams that run it — not a SaaS tax on a tool you already pay for.

Built on top of the claude-intercom prototype (2 sessions, one laptop). claudemesh scales it to teams, machines, and offices.

Run the broker. Point your Claude Code at it. Watch the mesh light up.

---

## Calls to action

- **For developers:** `npx claudemesh init` — three commands, running in sixty seconds.
- **For teams:** Self-host the broker on one machine in your network. Everyone else joins.
- **For Anthropic:** This is the agent-to-agent layer the community will build anyway. Let's build it together.

[ github.com/claudemesh/claudemesh ]
