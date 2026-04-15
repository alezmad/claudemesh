# claudemesh-cli v2 Pass 2 — UX Design Reference

> ⚠️ **This document describes v2 Pass 2 — the longer-term UX vision, NOT the Pass 1 scope.**
>
> For the v2 Pass 1 implementation target, see **`2026-04-11-cli-v2-pass1.md`**.
>
> Pass 1 preserves v1's existing CLI interactions verbatim (welcome wizard, launch flow, status prompts). The design system described here (six semantic color roles, delight beats, session_kind enum, accessibility matrix, ICU MessageFormat, trust surfaces) is the Pass 2 interactive redesign, not the Pass 1 scope.
>
> This document is retained as reference for future Pass 2 UX work.

**Status:** Pass 2 future reference — NOT the Pass 1 implementation target
**Created:** 2026-04-10
**Consolidated:** 2026-04-10 (35 amendments merged into body, no appendices)
**Companion to:** `2026-04-10-cli-v2-final-vision.md` (authoritative for architecture; defers to this doc for design)
**Related specs:**
- `2026-04-10-cli-v2-local-first-storage.md` — storage canonical
- `2026-04-10-cli-v2-facade-pattern.md` — boundary canonical
- `2026-04-10-cli-v2-shared-infrastructure.md` — broker-backed services canonical
**Purpose:** Single source of truth for every pixel, every string, every interaction in the v2 CLI. When implementation questions about *how* something should look, read, or feel arise, this doc wins.

---

## Table of contents

1. Design philosophy
2. The fourteen inviolable rules
3. Voice and tone
4. First-run onboarding script
5. Session kinds and output budgets
6. Microcopy catalog
7. Error patterns
8. Trust surfaces (distinct from delight)
9. Picker rules
10. Keyboard conventions
11. Progressive disclosure
12. Accessibility (testable matrix)
13. Dark/light terminal compatibility
14. Browser→terminal continuity
15. Claude Code status-line integration
16. Delight beats (four total)
17. Anti-patterns (forbidden behaviors)
18. Locked copy governance
19. Visual audit checklist
20. Copy review checklist
21. Stable JSON API versioning

---

## 1. Design philosophy

claudemesh-cli v2 is designed as if **Apple shipped a developer tool under Anthropic's brand**. The combination matters:

- **Apple** gives us: opinionated defaults, zero configuration theater, delight in first seconds, restraint in visual language, one canonical path, and the reflex to delete every friction point.
- **Anthropic** gives us: honesty about limitations, respect for the user's competence, safety without fussiness, beautiful prose, and a voice that treats users as thoughtful adults.

The combination gives us: **a CLI that makes a technical user feel like the tool understood them before they even typed anything.**

### What we're NOT designing

- Not a command-line utility in the Unix tradition (terse, assume-you-know-what-you're-doing, unhelpful on error)
- Not a "friendly" CLI in the modern TUI trend (cartoonish, over-animated, cluttered with emoji, treats users like children)
- Not a dashboard wrapped in a terminal (heavy frames, tables everywhere, screen-sized output)

We are designing **a terminal tool that respects the medium and the user equally**.

### The two users we're designing for

**User A — "Fresh install Alejandro"**
- Heard about claudemesh from a tweet or a colleague
- Has Claude Code installed
- Runs `claudemesh` expecting something to happen
- Has zero patience for setup, pickers, or prompts
- Will abandon the tool within 30 seconds if they don't see value

**User B — "Daily driver Alexis"**
- Uses claudemesh 20+ times per day
- Has muscle memory for `claudemesh` and `claudemesh peers`
- Notices every extra millisecond of overhead
- Notices every change to output format (scripts depend on it)
- Will write angry GitHub issues about regressions

Design for both simultaneously. User A's delight must not come at User B's expense, and User B's speed must not come at User A's confusion.

---

## 2. The fourteen inviolable rules

These are the design constraints every PR, every screen, every string gets checked against. Violation = revision.

### Rule 1 — One question, or none

> A CLI question exists only when the machine genuinely cannot guess. Every other question is a bug.

**Test**: for every prompt in the code, ask "could the machine have guessed this from context?" If yes, delete the prompt and use the guess.

**Applied**: first-run creates a mesh named `<hostname>` without asking. Display name is the account's real name. Role is `member`. Template is `solo`. The user types `claudemesh` and answers zero questions.

### Rule 2 — Silence is the interface (for daily use)

> A daily-use command produces zero user-facing output before the handoff to Claude Code.

**Test**: does the command print anything before `exec claude`? If yes, can it be skipped?

**Applied**: `claudemesh` on a returning machine (session kind = `daily_launch`) goes straight from bash prompt to Claude Code's TUI. No banner, no "Continue?" beat, no status line. The terminal appears to simply become Claude Code.

Exceptions to Rule 2 are **explicit and named**: first-run, recovery mode, and silent auth refresh (which shows one status line because the user's action in the browser is required, and zero output would be deceptive).

### Rule 3 — Picker only on genuine ambiguity

> A picker appears only when the user has 2+ valid choices AND no `--flag` AND no cached preference AND no clipboard hint.

**Test**: four conditions. If any is false, no picker. If all four are true, show the picker.

**Applied**: first run with one mesh → no picker. Daily use with a cached preference → no picker. `--mesh <slug>` flag → no picker. Clipboard has an invite → one-option picker that's really just a confirm.

### Rule 4 — Default is the primary action

> When a picker does appear, the first option is always the action the user most likely wants, and Enter is always the accept key.

**Test**: what happens on one keypress of Enter?

**Applied**: mesh picker preselects last-used by default. Confirm screen defaults to "Continue". Invite detection defaults to "Join". Never make the user arrow-down to select what they already want.

### Rule 5 — Remember everything, announce nothing

> Cache every decision the user makes. Never brag about remembering.

**Test**: does the next run of the same command feel shorter than the previous one? Without the user being told anything?

**Applied**: last-used mesh, name, role are written to `~/.claudemesh/state.json` silently. Next run uses them. No "Using your last mesh: platform-team" message. No "(last used)" annotation in pickers. The selected row is indicated by position (first) and emphasis (bold + arrow), not by a label.

### Rule 6 — Errors are Anthropic essays, not Unix stacks

> Every error is 1–3 sentences in full English. Line 1: what happened. Line 2 (optional): what we know about why. Line 3: what to do next. **Exactly one primary recovery action per error**; if the recovery can fail, its next step is surfaced as a chained follow-up error, not inlined.

**Test**: print the error to a non-technical colleague. Do they understand what to do next?

**Applied**: see §7 for the full error pattern catalog.

**Chained recovery**: for multi-step recoveries where the first action can fail and needs a second step, the error displayed is always the *current* one-action recovery. If that action fails, the next error in the chain becomes the new one-action error. Example:

```
Step 1 (first error):
  The local mesh store is corrupt.
  Run `claudemesh doctor --repair` to attempt automatic repair.

[user runs doctor --repair, which fails]

Step 2 (next error, shown when repair fails):
  Automatic repair failed. Your local store has unrecoverable corruption.
  Run `claudemesh doctor --reset` to back up the corrupt data and initialize
  a fresh store. Your shared-mesh data on the broker is unaffected.
```

Each error in the chain still follows the one-action rule. The user is never presented with two competing actions in a single message. This is how the rule scales to real failure modes without adding UI complexity or changing the structural contract.

### Rule 7 — No animation unless meaningful

> Spinners for operations under 200ms are motion noise. Loading lines for predictable ops are disrespectful. Transitions for their own sake are insulting to the reader's time.

**Test**: would removing the animation change what the user knows or can do?

**Applied**: no spinner on sub-200ms ops. No fake typing. No "loading mesh…" when the mesh loads in 12ms. A single `⠋` spinner appears only when an operation genuinely takes time (network I/O, device-code polling, browser round-trip).

### Rule 8 — Six semantic color roles (five in monochrome), ten icons, one typeface

> The visual system is deliberately constrained. Constraint is consistency, and consistency is trust. In monochrome mode (`NO_COLOR=1`), `dim` gracefully collapses into `muted`, leaving five distinguishable roles — this is an accepted degradation, not a contradiction.

**Test**: does this screen introduce a color or icon not in the system? Reject.

**Applied**: `ui/styles.ts` exports exactly **six semantic color roles**:

```ts
export const Colors = {
  primary:  'cyan',              // default interactive / affirmative / brand
  success:  'green',              // confirmation of completed operations
  error:    'red',                // failures that block progress
  warning:  'yellow',             // degraded but non-blocking
  muted:    'gray',               // metadata, annotations, secondary info
  dim:      'blackBright',        // tertiary info (collapses to muted in monochrome)
} as const;
```

No custom hex colors. No purple brand tint. No `accent` or `title` as separate tokens. `primary` is the brand color, the selection color, and the heading color — one role, three uses. This works in any terminal theme (Solarized, Dracula, Nord, Tokyo Night, default macOS/Windows Terminal) without per-theme testing.

Ten icons from BMP Unicode: `✔ ✘ ⚠ ▶ ▸ • ◆ █ ◉ ◎`. ASCII fallback mapping exists for old terminals (see §13.2).

A `biome-lint-rule: no-inline-colors` catches violations at CI. A parallel `no-raw-glyphs` rule catches inline unicode.

### Rule 9 — Typography, not decoration

> Lines of text with alignment and whitespace. No boxes. No borders. No ASCII art. No tables unless displaying tabular data.

**Test**: does this screen use `│`, `─`, `╔`, or similar? Reject unless rendering a structured table.

**Applied**: status rows align by column math, not by drawing boxes. Picker menus are plain lists with a gutter. **No brand mark.** The first-run welcome uses the product name in `primary` color, the tagline in `muted`, and nothing else. See §4 for the exact first-run copy.

### Rule 10 — One primary action per screen

> Every screen has exactly one "recommended" action — the first option in a picker with emphasis, or the only option implied by context. Cancel via Escape/Ctrl-C is always available. Non-cancel alternative actions (e.g. "pick a different option") are allowed as secondary rows in confirm pickers only.

**Test**: can you point at the "do this" action on every screen in under 1 second?

**Applied**: no screen shows two actions with equal visual weight. The primary is always distinguishable by position (first row), weight (bold), color (`primary`), and the `▸` gutter arrow. Secondary alternatives in confirm pickers (e.g. "Pick a different mesh" on the launch confirm) are allowed because they're navigational alternatives, not cancels — cancel is Escape/Ctrl-C.

**Clarification on confirm pickers**: a row labeled "Pick a different mesh" in a confirm picker is NOT a cancel — it's a navigation back to the picker. A row labeled "Cancel" or "Go back" would violate this rule. The distinction is:
- **Cancel** (abort the entire flow, exit the CLI): Escape / Ctrl-C only
- **Navigate back** (return to a previous screen in the same flow): allowed as a picker row, clearly labeled with the destination ("Pick a different mesh", "Edit name")
- **Secondary action** (do a different thing than the primary): allowed as a picker row if and only if it's an alternative way to accomplish the user's goal, not a way out

### Rule 11 — Progressive disclosure at the filesystem level

> The main `--help` shows 8 commands plus a "When something's wrong" section (with `doctor` and `whoami`). Advanced commands are hidden behind `help advanced`.

**Test**: does a new user's first `--help` overwhelm them?

**Applied**: `commands/advanced/` folder is hidden from main citty help output. `claudemesh help advanced` is the only discovery path for less common commands. Survival commands (`doctor`, `whoami`) stay visible in the main help even though they're "advanced" by nature, because hiding them would be hostile to users in broken states.

### Rule 12 — Context-aware primary action

> The main command `claudemesh` behaves differently based on state, but the user always sees one obvious thing happen.

**Test**: document every state `claudemesh` (bare) handles, confirm the outcome is "obvious".

**Applied**:
- No config → bootstrap personal mesh, drop into Claude Code
- Config + last-used mesh → drop into Claude Code in that mesh
- Config + 2+ meshes + no last-used → picker
- Config + invite in clipboard → offer join (preselected)
- Config + expired token → silent refresh (one status line), then drop in
- Config + broker down → drop in with amber connection indicator in status line

One command, many states, always obvious.

### Rule 13 — Honest restraint with delight

> We do not sprinkle emojis, jokes, or personality. We include exactly **four delight beats per major version**. Trust surfaces (compliance, telemetry, audit) are a distinct category and do not count against the delight budget.

**Test**: count the delight beats in the catalog. If greater than 4, cut one.

**Applied**: see §16 for the full locked catalog of 4 delight beats. The first-run closing sentence is `"You're in."` — three syllables, one complete thought. The 100th-session easter egg is `"Nice to see you again."` — acknowledging the relationship, not the count.

### Rule 14 — The return-to-terminal contract

> After any successful action, the user's terminal is left in exactly the state they'd expect. No leftover ANSI. No hidden cursor. No alt-screen artifact. No "press enter to continue" that requires a keypress.

**Test**: after any command, does `echo $?` work immediately? Does the cursor blink?

**Applied**: `ui/terminal.ts::resetTerminal()` is called exactly once per session exit, inside `HandoffScreen` for the wizard path and inside `cli/exit.ts` for non-interactive paths. It's the single choke point for ANSI teardown. Non-interactive commands never boot Ink, so there's nothing to reset.

---

## 3. Voice and tone

### 3.1 The claudemesh voice

**Informed, restrained, competent, warm-but-not-familiar.**

- Like a senior engineer explaining something to a peer, not a bootcamp instructor explaining to a student
- Complete sentences, proper punctuation, no contraction abuse, no corporate "we" overload
- Uses "you" when addressing the user directly; uses "your" for possession
- Uses active voice almost always. Passive voice only when the actor is irrelevant ("Your token was revoked")
- Never refers to itself in third person as "claudemesh-cli" or "the tool" or "the CLI". Say "we" when a first-person voice is needed, but use it sparingly

### 3.2 Forbidden concepts (not just words)

The blocklist is a list of **concepts**, each with per-locale word lists. CI lints every locale file against the concept's word list for that locale. Raw word blocklists for translations are theater — a translator could commit the same sin using a different word.

```ts
// lint/forbidden-concepts.ts
export const FORBIDDEN_CONCEPTS = {
  successTheater: {
    description: 'Declaring success in a way that feels like celebration rather than confirmation',
    en: ['successfully', 'awesome', 'hooray', 'woohoo', 'yay'],
    es: ['exitosamente', 'estupendo', 'genial', 'bravo'],
  },
  fakeApology: {
    description: 'Pseudo-empathetic opener that delays the actual message',
    en: ['oops', 'whoops', 'unfortunately', 'sorry, but'],
    es: ['vaya', 'lamentablemente', 'desafortunadamente'],
  },
  patronizing: {
    description: 'Telling the user how to feel',
    en: ["don't worry", 'no need to panic', 'relax'],
    es: ['no se preocupe', 'tranquilo', 'sin prisa'],
  },
  vagueFailure: {
    description: 'Error messages that hide what broke',
    en: ['something went wrong', 'an error occurred', 'oops something broke'],
    es: ['algo salió mal', 'ocurrió un error', 'hubo un problema'],
  },
  fillerPolite: {
    description: 'Filler words that pretend politeness but add noise',
    en: ['please', 'kindly'],
    es: ['por favor'],  // context-sensitive in Spanish — softer rule
  },
};
```

CI rule: every PR that touches `locales/*.ts` is linted against `FORBIDDEN_CONCEPTS` for every locale present. Violations block merge. Adding a new locale requires adding its forbidden concept entries.

### 3.3 Required patterns

- **Verbs first** when giving instructions: "Run `claudemesh share`" not "You should run `claudemesh share`"
- **State before suggest**: explain what happened before telling the user what to do
- **Specific over vague**: "Mesh creation failed because the slug `test` is already taken" not "Something went wrong with mesh creation"
- **One sentence per idea**: don't cram three thoughts into one compound sentence
- **Second person singular**: "your mesh", not "the user's mesh"
- **Present tense**: "We created your mesh" not "Your mesh has been created"

### 3.4 Verbosity budget

| Context | Max length |
|---|---|
| First-run welcome header | 2 lines |
| First-run welcome description | 1 sentence |
| Command success confirmation | 1 line |
| Error message | 3 lines |
| Onboarding closing sentence | 1 sentence, ≤ 5 words |
| `--help` command descriptions | 1 line each, under 60 chars in English |
| Status line (in Claude Code) | 1 line, under 60 chars in English |

**Per-locale length budgets**: Spanish expands ~30% vs English. Hard-capped strings have explicit per-locale limits:

```ts
export const budgets = {
  'help.description': { en: 60, es: 80, mode: 'hard' },  // hard cap — CI fails on exceed
  'status.line':      { en: 60, es: 75, mode: 'hard' },
  'error.message':    { en: 150, es: 195, mode: 'soft' }, // soft — warning at 150% of English
  'button.label':     { en: 30, es: 40, mode: 'hard' },
  'picker.option':    { en: 60, es: 80, mode: 'soft' },
};
```

**CI enforcement**:
- **Hard cap exceeded** → CI build **fails** with a clear error: `locales/es.ts: help.description "inicia una sesión en tu malla (crea una si es necesario)" exceeds 80 char limit (83 chars)`
- **Soft cap exceeded** → CI emits a **warning** but does not fail: `locales/es.ts: error.message "..." exceeds 150% of English length (195 vs 130 chars). Consider tightening.`
- **Missing translation** → CI fails: every key in `en.ts` must have a corresponding entry in `es.ts`. Fallback to English at runtime is allowed for gradual rollout but CI flags the gap.

**ICU plural category support**: EN and ES have simple plural rules (one, other). Future locales with complex rules (Polish, Russian, Arabic) have additional categories (few, many, etc.). The ICU MessageFormat library handles these automatically, but the catalog entries must cover all categories for each supported locale. When v1.1+ adds Russian, every plural-sensitive key gains `few` and `many` categories in `ru.ts`. The English catalog is always the source of truth for keys; translated locales add whatever plural categories their grammar requires.

---

## 4. First-run onboarding script

This is the most important UX surface in the entire product. Every word is reviewed by three people before it ships.

### 4.1 Scenario A — Fresh machine, no network

```
$ claudemesh

  claudemesh
  Peer mesh for Claude Code sessions.

  Creating your mesh…

  ✔ Your mesh "alejandro-mbp" is ready.

  You're in.
```

**Elapsed time**: ~300ms (SQLite init + local mesh bootstrap).
**Words on screen**: ~16.
**Decisions required**: 0.

After the closing sentence, the terminal transitions to Claude Code (invisible handoff via process replace).

### 4.2 Scenario B — Fresh machine, with network

Phase 1: initial render
```
$ claudemesh

  claudemesh
  Peer mesh for Claude Code sessions.

  Opening browser for sign-in…
```

Browser opens to `claudemesh.com/cli-auth?code=ABCD-EFGH`. User sees the Better Auth login screen if needed, then a single approval card:

```
Link this CLI session?

  Code       ABCD-EFGH
  Device     Alejandro's MacBook Pro (darwin/arm64)
  Expires    in 9:47

  [Approve]  [Deny]
```

User clicks Approve. Browser shows:

```
✔ You're linked.

Return to your terminal to continue.
```

Phase 2: back in the terminal
```
  ⠋ Waiting for browser confirmation…

  ✔ Signed in as Alejandro Gutiérrez.
  ✔ Your mesh "alejandro-mbp" is ready.

  You're in.
```

**Elapsed time**: 4–8 seconds depending on browser speed.
**Words on terminal**: ~24.
**Decisions required**: 1 (click Approve).

After the closing sentence, Claude Code takes over invisibly.

### 4.3 The closing sentence (locked, first-run only)

Exactly one sentence is the emotional payoff of the first run:

> **"You're in."**

Three syllables. One complete thought. Locked — do not change without a design review.

This sentence was chosen because:
- "You're in" is short and declarative
- It frames the moment as arrival, not achievement
- Zero exclamation marks
- Zero emoji
- Zero "welcome"

**Locked to first-run only** — this sentence is the first delight beat and is shown exactly once per machine (see §16). It is NOT reused for silent auth refresh, which has its own different message (see §6.4 `auth.refresh.done`). Reusing "You're in." for refresh would dilute the first-run impact.

The longer version that used to appear here — `"Your mesh is ready for you and anyone you invite."` — was cut because it diluted the beat. The extra words turned delight into onboarding instruction, and onboarding instruction belongs on day 2, not day 1.

### 4.4 The second-invocation hint (deferred, not first-run)

On the **second time** a user runs `claudemesh` (the literal second invocation, not the second calendar day), if `session_count === 2`, a one-line muted-color hint appears after the handoff signal:

> "Type `claudemesh peers` in another terminal to see who's around."

This is onboarding spread over time. Shown exactly once per machine. Tracked in `state.milestoneShown.secondInvocationHint`.

**"Second-invocation", not "day-2"**: the trigger is purely counter-based (`session_count === 2`). If a user runs `claudemesh` twice in the same five minutes, they see the hint on invocation #2. If they skip three weeks and then run a second time, they still see it on invocation #2. "Day-2" was a misleading earlier name — the trigger has nothing to do with the calendar.

### 4.5 What we do NOT show on first run

Explicitly forbidden:

- A menu of things to do
- A tour of the features
- A list of available commands
- A request for feedback
- A "follow us on Twitter" prompt
- A "star us on GitHub" prompt
- A changelog
- A "click here to learn more" link
- The output of `claudemesh --help`
- Any ASCII art (no brand mark, no logo)
- Any "Welcome!" / "Hello!" / "Hi there!" framing

---

## 5. Session kinds and output budgets

Rule 2 says "silence is the interface" for daily use but §4 shows verbose output for first run. The distinction is machine-readable via `session_kind`:

```ts
// ui/session-kind.ts
export enum SessionKind {
  FirstRun = 'first_run',         // no prior state — verbose welcome OK
  Recovery = 'recovery',           // post-error or post-migration — 1-line status
  DailyLaunch = 'daily_launch',   // normal case — silent handoff
  Interactive = 'interactive',     // `new`, `invite`, `list`, etc. — normal TTY
  NonInteractive = 'non_interactive', // CI, pipe, --json — machine output only
  Rescue = 'rescue',               // `doctor`, `--help`, `whoami` — explicit diagnosis
}
```

### 5.1 Output budget per kind

| Kind | Pre-handoff output | Frames rendered | Example |
|---|---|---|---|
| `first_run` | Up to 8 lines (welcome + status rows + closing) | 1 Ink frame | §4.1, §4.2 |
| `recovery` | 1 status line | 0 frames | "Your sign-in expired. Refreshing in browser…" |
| `daily_launch` | 0 lines | 0 frames | bare `claudemesh` |
| `interactive` | Flow pipeline, no budget | N frames | `claudemesh new`, `claudemesh invite` |
| `non_interactive` | Structured output only | 0 frames | `claudemesh list --json` |
| `rescue` | Full diagnostic output | 0 frames | `claudemesh doctor` |

### 5.2 Detection logic

In `entrypoints/cli.ts`:

- `first_run` → no `~/.claudemesh/state.json` exists
- `recovery` → previous session ended with non-zero exit code AND cache exists
- `daily_launch` → cache exists AND no flags specifying new behavior AND `process.stdout.isTTY` AND not `-y` with missing required args
- `non_interactive` → `!process.stdout.isTTY` OR `--json` flag OR `CI` env var
- `interactive` → explicit subcommand (`new`, `invite`, `list`, etc.)
- `rescue` → explicit `doctor` / `--help` / `whoami` / `--version`

### 5.3 Session kind is not user-visible

Users never see "session_kind" in output. It's purely internal routing — different modes pick different flows in `ui/flows.ts` and different output renderers in `cli/output/`.

### 5.4 Session kind is immutable post-boot

`session_kind` is determined once in `entrypoints/cli.ts` before Ink boots, and it **does not change during runtime**. A session that starts as `interactive` (running `claudemesh new`) cannot transition to `rescue` mid-flight when a tool call fails — instead, the failure surfaces as an **overlay** within the current session kind.

If an interactive command hits a corrupt-database error that requires `doctor`, the overlay says "Local store is corrupt. Exit and run `claudemesh doctor` to repair." The user exits, re-runs with `doctor`, and the new process starts with `session_kind = rescue`. There is no runtime re-classification path.

**Rationale**: re-classifying mid-flight would require tearing down Ink and re-bootstrapping, which fights Rule 14 (return-to-terminal contract) and Rule 2 (silence). A clean exit + re-exec is simpler and more predictable.

**Implementation note**: overlays can still push runtime errors to the user without changing the session kind. The overlay stack (see §9) is the mechanism for runtime interruptions within a fixed session kind.

---

## 6. Microcopy catalog

Every user-visible string in v2. Centralized in `locales/en.ts` (and per-locale translations). Uses **ICU MessageFormat** for all pluralization and locale-sensitive grammar.

### 6.1 ICU MessageFormat is mandatory

Flat key-value catalogs break for Spanish and any language with plural/gender agreement. Every string with count-sensitive grammar uses ICU syntax:

```ts
// locales/en.ts
export const en = {
  whoami: {
    meshCount: '{owned, plural, =0 {no meshes owned} one {# mesh owned} other {# meshes owned}}, {guest, plural, =0 {no guest meshes} one {# as guest} other {# as guest}}',
  },
  broker: {
    reconnected: 'Reconnected.',  // plain — peer count lives in status line, not message
  },
  peers: {
    empty: "No one else is here yet. Invite teammates with `claudemesh invite`.",
  },
};

// locales/es.ts
export const es = {
  whoami: {
    meshCount: '{owned, plural, =0 {sin mallas propias} one {# malla propia} other {# mallas propias}}, {guest, plural, =0 {ninguna como invitado} one {# como invitado} other {# como invitado}}',
  },
  broker: {
    reconnected: 'Reconectado.',
  },
};
```

Library: `@formatjs/intl-messageformat` or equivalent lightweight ICU implementation.

### 6.2 First-run keys

| Key | String |
|---|---|
| `firstRun.brandLine` | `claudemesh` |
| `firstRun.tagline` | `Peer mesh for Claude Code sessions.` |
| `firstRun.creating` | `Creating your mesh…` |
| `firstRun.openingBrowser` | `Opening browser for sign-in…` |
| `firstRun.waitingBrowser` | `Waiting for browser confirmation…` |
| `firstRun.signedIn` | `✔ Signed in as {name}.` |
| `firstRun.meshReady` | `✔ Your mesh "{slug}" is ready.` |
| `firstRun.closing` | `You're in.` |

### 6.3 Day-2 hint

| Key | String |
|---|---|
| `dayTwo.peersHint` | `Type \`claudemesh peers\` in another terminal to see who's around.` |

### 6.4 Authentication

| Key | String |
|---|---|
| `auth.deviceCode.manual` | `If your browser didn't open, visit:\n  {url}` |
| `auth.deviceCode.timedOut` | `Sign-in timed out. Run \`claudemesh\` to try again.` |
| `auth.deviceCode.denied` | `Sign-in canceled. Run \`claudemesh\` to try again.` |
| `auth.deviceCode.networkError` | `Can't reach claudemesh.com. Check your connection and try again.` |
| `auth.token.saved` | `Token saved to {path}.` |
| `auth.token.invalid` | `That doesn't look like a claudemesh token. Expected something starting with \`cm_\`.` |
| `auth.token.rejected` | `Token rejected by the server. It may have been revoked or it's from a different environment.` |
| `auth.refresh.silent` | `Your sign-in expired. Refreshing in browser…` |
| `auth.refresh.done` | `✔ Done.` |
| `auth.logout.success` | `Logged out. Removed {path}.` |
| `auth.logout.serverFailed` | `Logged out locally. The server revocation failed — the token is still valid on the server. Revoke it manually at {url}.` |

### 6.5 Mesh operations

| Key | String |
|---|---|
| `mesh.bootstrap.success` | `Your mesh "{slug}" is ready.` |
| `mesh.create.prompt` | `Name?` |
| `mesh.create.success` | `Created "{slug}".` |
| `mesh.create.joined` | `You're in.` |
| `mesh.create.slugCollision` | `A mesh called "{slug}" already exists. Try "{suggestion}" instead.` |
| `mesh.publish.confirm` | `Your personal mesh is local-only. Publish it to claudemesh.com?` |
| `mesh.publish.needsAuth` | `We'll sign you in first if you haven't already.` |
| `mesh.publish.success` | `Published as "{slug}".` |
| `mesh.publish.inviteCopied` | `Invite URL copied to clipboard:\n  {url}` |
| `mesh.join.success` | `Joined "{slug}".` |
| `mesh.join.fromClipboard` | `✔ Joined "{slug}" from the dashboard link.` |
| `mesh.leave.confirm` | `Leave "{slug}"? You won't lose your local data.` |
| `mesh.leave.success` | `Left "{slug}".` |
| `mesh.rename.success` | `Renamed to "{newSlug}".` |
| `mesh.rename.permissionDenied` | `Only the mesh owner can rename it.` |

### 6.6 Invites

| Key | String |
|---|---|
| `invite.generate.success` | `Invite URL copied to clipboard:\n  {url}\n\nShare the link with anyone. Expires in {duration}.` |
| `invite.email.sent` | `✔ Sent to {email}.` (utility confirmation) |
| `invite.email.sentFirst` | `Sent. They'll see it when they check their inbox.` (first-time only — delight beat #3) |
| `invite.email.alsoCopied` | `✔ Also copied to clipboard.` |
| `invite.clipboard.detected` | `Detected invite in clipboard.` |
| `invite.expired` | `That invite expired on {date}. Ask whoever sent it for a new one.` |
| `invite.malformed` | `That doesn't look like a claudemesh invite. Expected:\n  https://claudemesh.com/i/<code>` |
| `invite.alreadyMember` | `You're already in "{slug}". Running launch instead.` |

### 6.7 Broker state

| Key | String |
|---|---|
| `broker.disconnected` | `Connection lost. Reconnecting in {seconds}s…` |
| `broker.reconnected` | `Reconnected.` |
| `broker.unreachable` | `Can't reach the mesh right now. Your Claude Code session is still running. Messages will queue until the connection returns.` |

### 6.8 List / peers / whoami (non-interactive renderers)

| Key | String |
|---|---|
| `list.empty` | `You're not in any meshes yet. Run \`claudemesh new\` to create one.` |
| `peers.empty` | `No one else is here yet. Invite teammates with \`claudemesh invite\`.` |
| `whoami.notLoggedIn` | `Not signed in. Run \`claudemesh login\` when you're ready to share a mesh.` |
| `whoami.signedIn` | `Signed in as {name} ({email})` |
| `whoami.tokenSource` | `Token source: {source}` |
| `whoami.meshCount` | `Meshes: {owned, plural, one {# owned} other {# owned}}, {guest, plural, one {# as guest} other {# as guest}}` |

### 6.9 Typo recovery

Typo recovery prompts are a **distinct exception class** from errors (§7). They're 1-line "did you mean?" interactive prompts, not 3-sentence essays.

| Key | String |
|---|---|
| `typo.meshSuggestion` | `No mesh called "{attempt}". Did you mean "{suggestion}"?` |
| `typo.commandSuggestion` | `Unknown command "{attempt}". Did you mean "{suggestion}"?` |
| `typo.noSuggestion` | `Unknown command "{attempt}". Run \`claudemesh --help\` to see all commands.` |

### 6.10 Clipboard handoff (dashboard → terminal)

When a dashboard "Launch in CLI" button changes local state (joins a mesh), a one-line confirmation is shown before launch. This is an exception to Rule 2 because disk state changed — silence would be deceptive.

| Key | String |
|---|---|
| `clipboard.joinSuccess` | `✔ Joined "{slug}" from the dashboard link.` |
| `clipboard.alreadyMember` | `Already in "{slug}". Launching…` |

### 6.11 Day-2 hint and 100th session

| Key | String |
|---|---|
| `milestone.hundredth` | `Nice to see you again.` |

---

## 7. Error patterns (full taxonomy)

### 7.1 Error structure

Every error message has three parts:

```
{ACTIVE VOICE: WHAT HAPPENED}

{OPTIONAL: WHAT WE KNOW ABOUT WHY}

{EXACTLY ONE ACTION TO TAKE}
```

**Exactly one primary action.** If an error has two verbs competing for the user's attention (e.g. "try again" + "check the status page"), one must be demoted to `claudemesh doctor` output or a documentation link.

### 7.2 Network errors

**Can't reach claudemesh.com**
```
  Can't reach claudemesh.com right now.

  The broker may be down or there's a network issue. Check your
  connection and try again in a minute.
```

**Can't reach the broker during a session**
```
  Lost connection to the mesh. Your Claude Code session is still
  running — messages will queue until we reconnect.

  Retrying in 3s…
```
(Shown as a status-line transition, auto-dismissed on reconnect.)

**Dashboard up but broker down**
```
  The dashboard is reachable but the mesh broker isn't.
  This usually means a broker restart is in progress.

  Retrying in 10s…
```

**Timeout during first-run device code**
```
  Sign-in timed out. Run `claudemesh` to try again.
```

### 7.3 Authentication errors

**Token expired (interactive)**
```
  Your sign-in expired. Refreshing in browser…
```
(Recovery is silent; the user doesn't need to do anything.)

**Token revoked (non-interactive / PAT)**
```
  Your access token was revoked. Generate a new one at
  claudemesh.com/dashboard/settings/cli-tokens and run:

    claudemesh login --token <new-token>
```

**Malformed token**
```
  That doesn't look like a claudemesh token. Expected something
  starting with `cm_`.
```

**Token from wrong environment**
```
  That token is for a different claudemesh environment. Use a
  token from claudemesh.com.
```

### 7.4 Mesh errors

**Slug collision on create**
```
  A mesh called "platform-team" already exists in your account.
  Try a different name.
```

**Slug not found on launch** (recovery prompt, not error — see §7.8)

**Not a member**
```
  You're not a member of "platform-team" (or it doesn't exist).
  To join, get an invite from someone who is.
```

**Not the owner (rename/archive)**
```
  Only the owner of "platform-team" can {action} it. Ask whoever
  created the mesh.
```

### 7.5 Invite errors

**Expired**
```
  That invite expired on Apr 7. Ask whoever sent it for a new one.
```

**Malformed URL**
```
  That doesn't look like a claudemesh invite. Expected:

    https://claudemesh.com/i/<code>
```

**Invalid code**
```
  This invite is no longer valid. It may have been revoked.
  Ask whoever sent it for a new one.
```

**Uses exhausted**
```
  This invite has reached its usage limit. Ask whoever sent it
  for a new one.
```

### 7.6 `claudemesh <url>` error matrix

Positional URL routing handles every edge case:

| Input | Behavior |
|---|---|
| Valid invite, not yet joined | Join flow, then launch |
| Valid invite, already a member | Recovery prompt (§7.8): "You're already in '{slug}'. Launch it instead?" |
| Valid invite, expired | Error: `invite.expired` |
| Valid URL format, code doesn't exist | Error: "This invite is no longer valid." |
| Valid URL format, different env | Error: "That invite is for a different claudemesh environment." |
| Malformed URL | Error: `invite.malformed` |
| URL without `/i/` path | Recovery prompt: "That looks like a claudemesh URL but not an invite. Did you mean the dashboard?" |
| URL for a different domain | Error: "That's not a claudemesh URL." |

### 7.7 Environment errors

**No Claude Code installed**
```
  Claude Code isn't installed on this machine.

  Install it from https://claude.ai/code and run `claudemesh`
  again.
```

**Permission denied on ~/.claudemesh/**
```
  Can't write to ~/.claudemesh/ — check the directory's
  permissions. It should be owned by you and mode 700.

  To fix:
    chmod 700 ~/.claudemesh
```

**Disk full**
```
  Can't write to ~/.claudemesh/data.db — disk is full. Free some
  space and try again.
```

**Corrupt SQLite**
```
  The local mesh store is corrupt. This is rare and usually
  recoverable. Run:

    claudemesh doctor --repair
```

### 7.8 Recovery prompts (distinct exception class)

Typo recovery and similar interactive recovery prompts are NOT subject to the 3-sentence error structure. They're 1-line "did you mean?" questions that immediately offer a picker:

```
  No mesh called "plataform-team". Did you mean "platform-team"?
▸ Yes, use "platform-team"
  No, cancel
```

Rules for recovery prompts:
- One line of prompt text
- A picker with 2–3 options
- First option is the recommended action
- No "why" explanation — the mismatch is self-explanatory
- Triggered by levenshtein distance ≤ 2 for typo cases, or by clear user intent mismatches (e.g. URL that looks like a dashboard URL, not an invite URL)

### 7.9 CLI usage errors

**Missing required flag in non-interactive mode**
```
  Missing --mesh (required with -y when you're in 2+ meshes).
  Available meshes: platform-team, alejandro-mbp, claudefarm
```

**Unknown command** (recovery prompt, not error)
```
  Unknown command "lanch". Did you mean "launch"?
```

**Conflicting flags**
```
  --mesh and --new can't be used together. Pick one.
```

### 7.10 MCP server errors

**Can't start stdio server**
```
  The MCP server failed to start: {reason}

  Run `claudemesh doctor` to diagnose.
```

**Tool call failed** (returned to Claude Code via MCP protocol)
```
  {tool_name} failed: {reason}
```

These errors reach Claude Code's TUI via the MCP protocol, not the CLI directly.

---

## 8. Trust surfaces (distinct from delight)

Delight and trust are different UX categories. Delight is emotional payoff; trust is compliance, disclosure, and user control. Mixing them is cynical. v2 treats them as distinct surface categories with different voices.

### 8.1 The category

Trust surfaces are neutral-informational, never warm. They use:
- A leading `~` marker to mark them as system notices (distinct from product messages)
- Muted color
- Single-line format
- No decorative elements

**The `~` marker convention is documented** in two places:
1. `claudemesh help conventions` — a short advanced help topic explaining every visual convention (`✔` for success, `✘` for error, `▸` for picker selection, `~` for trust surfaces, `◉` for connection status)
2. The first trust surface a user ever sees (the telemetry disclosure on first run) includes a brief gloss: `~ claudemesh collects anonymized usage data. (System notices start with "~" — run \`claudemesh help conventions\` to learn more.)` — shown only on the first occurrence, not every time.

Users who want to dig deeper can run the help command; users who ignore it still understand the notice because the text is self-explanatory. The `~` is not load-bearing semantically — removing it wouldn't break comprehension, it just signals category.

### 8.2 Trust surface catalog

**First-run telemetry disclosure** (shown exactly once, after the handoff transition):

```
~ claudemesh collects anonymized usage data. Run `claudemesh advanced telemetry off` to disable.
```

**Audit log access**:

```
~ Showing audit events from the last 30 days. Older events are in ~/.claudemesh/logs/.
```

**Data deletion confirmation**:

```
~ Local data deleted. Server-side data remains until you log out.
```

### 8.3 Rules

- Trust surfaces do NOT count against the delight beat budget (§16)
- They have their own voice: neutral, factual, never cheerful, never apologetic
- They're never blocked — the user doesn't need to acknowledge to proceed
- They scroll by once and are marked "shown" in `~/.claudemesh/state.json`
- The `~` marker is a system-notice convention, used only in this category

---

## 9. Picker rules

### 9.1 When a picker shows

A picker MUST show when ALL of the following are true:
1. The user has 2+ valid choices
2. No CLI flag specifies the choice
3. No cached preference exists (see §9.4 for cache invalidation)
4. The user is in an interactive (TTY) context
5. `-y` was not passed
6. No clipboard hint (e.g. invite URL) implies a default

A picker MUST NOT show when any of those is false.

### 9.2 Picker visual structure

```
  {optional question on one line}
▸ {first option — bold, primary color}
  {second option}
  {third option}
```

- No header like "Choose one:" unless the context isn't obvious
- No separators between options
- No "Cancel" as a menu item (Escape/Ctrl-C handles cancel)
- First option is always the recommended default, rendered in **bold + `primary` color + gutter arrow `▸`**
- Non-selected rows use default weight in `dim` color

### 9.3 Selection indication uses three signals

Per accessibility rule (§12.1): selection is indicated by icon, text weight, AND **position-as-rendered** (i.e. where the gutter arrow currently sits, not where in the list).

1. **Icon**: `▸` in the gutter (or `>` in monochrome mode) — moves with the selection as the user navigates
2. **Text**: bold weight for the selected row
3. **Position-as-rendered**: the selected row has the gutter arrow in its leftmost column; non-selected rows have two spaces. "Position" here means "the row where the arrow is currently drawn" — not "first row in the list". If the user arrow-downs to row 3, row 3 becomes the "position-signaled" row.

In color mode, `primary` color is added as a fourth signal. At least two signals are legible in any a11y configuration.

**Clarification**: earlier drafts said "first row" which was ambiguous. The rule is "the row currently rendered with the gutter arrow" — which starts as the first row by default (preselection) but moves as the user navigates.

### 9.4 Cache invalidation rules

The cache `state.lastUsedMesh` is considered stale when ANY of the following is true:
1. The referenced mesh no longer exists in local state (user ran `claudemesh leave`)
2. The referenced mesh's broker URL is unreachable AND the mesh is shared (not personal) — fall through to picker
3. The cache was written by a different CLI major version
4. The user explicitly ran `claudemesh advanced state clear-last-used`
5. The cache is older than 30 days

**Behavior on stale cache**: clear the stale entry, fall through to normal picker logic. Never silently use a stale value.

**Auto-invalidation triggers**:
- `claudemesh leave <slug>` where slug matches → clear entry
- `claudemesh logout` → clear all cache
- `claudemesh advanced migrate` → clear cache to force fresh selection
- Server-side mesh deletion detected on next connect → clear entry

### 9.5 The mesh picker

```
  Which mesh?
▸ alejandro-mbp
  platform-team · 7 peers
  claudefarm · 12 peers
```

- Last-used is preselected by position (first row) + emphasis — **no "(last used)" annotation**
- Shared meshes show peer count in `muted` color after `·`
- Personal mesh shows no annotation (it's yours, count is 1)

### 9.6 The confirm picker

```
  Continue to "alejandro-mbp"?
▸ Yes, launch
  Pick a different mesh
```

Only two options. First is the recommended action. No "Cancel" — Escape cancels.

### 9.7 The invite-detected picker

```
  Detected invite in clipboard.
▸ Join "platform-team"
  Continue to "alejandro-mbp"
```

Always two options: the detected invite OR the last-used mesh. Detected invite wins preselection (fresh user intent trumps cached preference).

### 9.8 First-letter jumping with cycling

Pickers support first-letter jumping: press `p` to jump to the first option starting with P. If multiple options start with the same letter, subsequent presses cycle through matches. Resets after 1 second of inactivity or when a different letter is pressed.

### 9.9 Maximum visible options

If a picker has >7 options, it shows 7 with arrow indicators `⌃` / `⌄` at top/bottom. The list scrolls as the user navigates. No pagination dialog. No numbered selection.

---

## 10. Keyboard conventions

| Key | Action | Notes |
|---|---|---|
| `↑` / `↓` | Navigate picker | Wraps at ends |
| `←` / `→` | (unused in v1.0.0) | Reserved for future multi-column pickers |
| `Enter` / `Return` | Accept current selection | Always |
| `Escape` | Cancel / go back | Exits to previous screen, or exits CLI at root |
| `Ctrl-C` | Exit immediately | Skips confirmation, resets terminal |
| `Ctrl-D` | Exit immediately | Alias for Ctrl-C |
| `Tab` | No-op (explicit) | Reserved for future autocomplete; currently does nothing (no bell, no hint) |
| `?` | Show keybindings overlay | On any interactive screen |
| `q` | Quit (list screens only) | See §10.2 |
| `/` | Filter (long lists only) | Only on screens with `filterable: true` |
| `[a-z]` | First-letter jump | Pickers only; cycles on collision (§9.8) |

### 10.1 No hidden shortcuts

Every keyboard shortcut is either:
- Listed in the `?` overlay
- A universal convention (Ctrl-C, arrows, Enter, Escape)

No easter eggs. No hidden dev shortcuts. No "press 5 to skip".

### 10.2 `q` quit key scope

`q` quits only on "list screens" — screens whose primary purpose is displaying a list (`peers`, `list`, `doctor` results). The screen's component declares `quitKey: 'q'` in its props; the global keymap checks this flag before binding `q`. On non-list screens (pickers, text inputs, flows), `q` is forwarded as a literal keystroke (used for first-letter jump in pickers).

### 10.3 The `?` keybindings overlay

```
  Keyboard

  ↑ ↓          Navigate
  Enter        Accept
  Escape       Cancel / back
  Ctrl-C       Exit
  a-z          Jump to option by first letter
  ?            Show this overlay

  Press any key to dismiss.
```

Brief. Fits in 8 lines. Dismisses on any keypress. Accessible from every interactive screen.

---

## 11. Progressive disclosure

### 11.1 Four levels of help

```
claudemesh --help              # 8 primary commands + "When something's wrong" section
claudemesh <cmd> --help         # per-command flags + examples
claudemesh help advanced        # advanced + internal commands
claudemesh help all             # complete, stable, grep-able dump
```

### 11.2 The main `--help` output

```
$ claudemesh --help

claudemesh — peer mesh for Claude Code sessions
v1.0.0

USAGE
  claudemesh                 start a session in your mesh (creates one if needed)
  claudemesh <url>           join a mesh from an invite link
  claudemesh new             create a new mesh
  claudemesh invite [email]  generate an invite (copies to clipboard)
  claudemesh list            see your meshes
  claudemesh rename <name>   rename the current mesh
  claudemesh leave [mesh]    leave a mesh
  claudemesh peers           see who's in the current mesh

When something's wrong
  claudemesh doctor          diagnose install/config/connection issues
  claudemesh whoami          show current identity

More: claudemesh help advanced
```

Exactly 8 primary verbs in the USAGE section. The "When something's wrong" section surfaces `doctor` and `whoami` so users in broken states can find them without drilling into advanced help.

The main command description `start a session in your mesh (creates one if needed)` is true in every state — fresh install, daily use, or recovery.

### 11.3 The advanced help output

```
$ claudemesh help advanced

claudemesh advanced

  login             re-authenticate (usually automatic)
  logout            revoke session and clear local credentials
  share             publish personal mesh as shared
  publish           alias for share
  install           register MCP server with Claude Code
  uninstall         remove MCP server registration
  migrate           run config/data migrations manually
  connect <svc>     link external bridges (telegram, etc.)
  disconnect <svc>  unlink external bridges
  telemetry on|off  manage telemetry opt-in
  mcp catalog       browse default MCP catalog
  mcp deploy <alias> deploy an MCP from the catalog

Internal (for Claude Code and scripts):

  mcp               start MCP server on stdio
  hook              handle Claude Code hook events
  seed-test-mesh    developer tool

Full reference: claudemesh help all
```

### 11.4 The full reference

`claudemesh help all` prints a complete, stable, grep-able dump of every command and every flag. This is what power users and script-writers read. It's longer than the main help and it's OK for it to be — that's why it's hidden.

### 11.5 Per-command help

```
$ claudemesh invite --help

claudemesh invite — generate an invite URL

USAGE
  claudemesh invite [email]

OPTIONS
  --mesh <slug>      mesh to invite to (default: current)
  --expires <dur>    expiry duration (default: 7d)
  --uses <n>         max uses (default: unlimited)
  --role <role>      role for the invitee (default: member)
  --json             machine-readable output

EXAMPLES
  claudemesh invite
  claudemesh invite alice@example.com
  claudemesh invite --mesh platform-team --expires 30d
```

Three sections: usage, options, examples. Examples are not optional — every command has at least one.

---

## 12. Accessibility (testable matrix)

Accessibility is specified as a testable matrix, not principles. Every state has three cues; at least two must be legible in any a11y configuration.

### 12.1 Token-signal matrix

| State | Icon cue | Text cue | Position cue | VoiceOver announcement pattern |
|---|---|---|---|---|
| Picker row selected | `▸` in gutter | Bold weight | First row in visible range | `"{label}, selected, {index} of {total}"` |
| Picker row unselected | `  ` (two spaces) | Default weight | Not first | `"{label}, {index} of {total}"` |
| Success confirmation | `✔` | "Done" / "Ready" / "Sent" | After action | `"{label}, completed"` |
| Error | `✘` | Error message | On error surface | `"Error: {message}. {action}"` |
| Warning | `⚠` | Warning message | On warning surface | `"Warning: {message}"` |
| In-progress | `⠋` | Progress text | Same line | `"Working: {label}"` |
| Connected | `◉` | Mesh name | Status position | `"Connected to {mesh}. {peer_count} peers."` |
| Disconnected | `◎` | Mesh name | Status position | `"Disconnected from {mesh}. Reconnecting in {seconds} seconds."` |

Every screen is tested against this matrix. CI runs an `ink-render` smoke test asserting the **announcement string** for each screen matches the expected pattern.

**Ink does not ship with native VoiceOver integration.** The "VoiceOver announcement pattern" column describes a *contract*: the screen must render an announcement string that a screen-reader can read. The delivery mechanism is a CLI-owned shim at `ui/accessibility/announce.ts` that:

- On macOS: writes the announcement to a hidden Ink `<Text>` element that VoiceOver picks up through standard terminal accessibility APIs (VoiceOver reads terminal content line-by-line; the hidden text becomes part of the reading stream)
- On Linux with `orca`: writes the announcement via `brltty`/AT-SPI bridge if available, else falls back to plain terminal text
- On Windows with NVDA: writes the announcement via a hidden Ink element that NVDA's terminal reader picks up
- When no screen reader is detected: no-op (the visible UI is already sufficient for sighted users)

**v1.0.0 delivery**: the shim ships as a thin Ink component that renders an announcement string to the terminal in a form screen-readers can consume. It is a **best-effort implementation**, not a full a11y platform. True native VoiceOver integration (via NSAccessibility APIs, Windows UI Automation, etc.) is v1.1+ work.

The matrix is therefore an **implementation contract for the announcement strings**, not a promise that every platform delivers perfect screen-reader output. Platforms where the shim is weak are documented in `docs/accessibility.md` with workarounds.

### 12.2 Monochrome (NO_COLOR=1) rendering

| Role | Monochrome rendering |
|---|---|
| `primary` (emphasis) | Bold weight |
| `success` | Bold weight + `✔` prefix |
| `error` | Bold weight + `✘` prefix |
| `warning` | Bold weight + `⚠` prefix |
| `muted` | Default weight |
| `dim` | Default weight (collapses into `muted` in monochrome) |

In monochrome, `dim` collapses into `muted`. Accepted tradeoff — without color, one level of tertiary distinction is lost, but no critical state becomes illegible.

Monochrome picker example:
```
  Which mesh?
> alejandro-mbp
  platform-team · 7 peers
  claudefarm · 12 peers
```

`▸` becomes `>` in monochrome mode. Selected row is bold.

### 12.3 Contrast targets

For terminals with theme support (Solarized, Dracula, Nord, Tokyo Night, default macOS, default Windows Terminal), the CLI is tested on each:

- `primary` on default background: ≥ 4.5:1 (WCAG AA)
- `error` on default background: ≥ 7:1 (WCAG AAA — errors must never be subtle)
- `success` on default background: ≥ 4.5:1
- `muted` on default background: ≥ 3:1

Contrast is measured using the terminal's reported theme via OSC 10/11 escape sequences when available; defaults are used otherwise. A CI test renders each token against each theme's background and computes the contrast ratio.

### 12.4 Focus order

Interactive screens declare a tab order (even though Tab is a no-op in v1.0.0). The order is used for screen-reader navigation via arrow keys:
- Top to bottom
- Left to right within a row
- Picker items navigable with arrow keys
- No focus trap across the alt-screen boundary

### 12.5 Terminal width compatibility

- **Minimum supported width**: 60 columns. Below that, reflow rules apply (§12.6).
- **Below 40 columns**: CLI refuses to render interactive screens. Suggests running in a wider terminal or with `--json`.
- **60–100 columns**: normal rendering
- **Above 100 columns**: content is NOT stretched; caps at 100 columns for readability
- **Above 120 columns**: right-aligned annotations (like "7 peers") appear in the same row; below 120 they move to a new line

### 12.6 Sub-60-column reflow rules

1. **Status rows**: split label and value onto separate lines:
   ```
   Account
     ✔ Alejandro
   Mesh
     ✔ alejandro-mbp
   ```
2. **Pickers**: unchanged — already single-column
3. **List commands**: drop all right-annotations
4. **Help output**: truncate command descriptions at `width - 4`, append `…`
5. **Error messages**: reflow at the actual width instead of hard 60-col default
6. **Status-line integration**: compress to the most compact form (§15.3)

### 12.7 Font compatibility

All Unicode characters used (`✔ ✘ ⚠ ▸ • ◆ █ ◉ ◎`) are in the BMP and supported by every modern terminal font. No emoji (private-use area). No Powerline characters. No Nerd Font characters.

**ASCII fallback detection**: at startup, the CLI checks `TERM` env var against a known-good list (xterm-256color, xterm-color, alacritty, iterm, kitty, tmux-256color). If not in list OR `CLAUDEMESH_NO_UNICODE=1`, ASCII fallback is used:

| Unicode | ASCII fallback |
|---|---|
| `✔` | `[OK]` |
| `✘` | `[X]` |
| `⚠` | `[!]` |
| `▸` | `>` |
| `⠋` | `*` (static) |
| `◉` | `(*)` |
| `◎` | `( )` |

### 12.8 Locale support

- `CLAUDEMESH_LOCALE=<code>` switches the CLI locale
- Fallback: `en` if the locale isn't supported
- Detection: `LANG` env var on first run, stored in config
- Strings live in `locales/<code>.ts`
- v1.0.0 ships with `en` and `es`
- Date/time/number formatting respects the locale via ICU

### 12.9 Timezone

Timestamps are shown in the user's local timezone. ISO format for machine output (`--json`), human format for interactive display:

- Machine: `2026-04-10T21:50:00Z`
- Human: `Apr 10 at 9:50 PM` (local)

---

## 13. Dark/light terminal compatibility

### 13.1 Approved palette

Only colors that pass contrast in both dark and light themes:

- `primary` (cyan) — safe on both, brand color, selection color, heading color
- `success` (green) — safe on both
- `error` (red) — safe on both
- `warning` (yellow) — visible on both (use sparingly on light)
- `muted` (gray) — blackBright terminal value, works on both
- `dim` — reduces contrast for tertiary text

### 13.2 Forbidden colors

- Pure white (#FFFFFF) — invisible on light
- Pure black (#000000) — invisible on dark
- Low-saturation pastels — invisible on both
- **Custom hex colors beyond the six semantic roles**

The purple brand tint (`#7C3AED`) that appeared in earlier drafts is retired. The dashboard and marketing site keep the purple; the terminal does not.

### 13.3 Test matrix

Every PR with visual changes is tested on:
- macOS Terminal (default light, default dark)
- iTerm2 (Solarized Dark, Solarized Light)
- Alacritty (default)
- Windows Terminal (default)
- VS Code integrated terminal

If it's illegible on any of those, it doesn't ship.

---

## 14. Browser→terminal continuity

The missing feature in every CLI tool. v1.0.0 ships the clipboard handoff path; v1.1+ may add deep linking.

### 14.1 Clipboard handoff (v1.0.0)

Dashboard has a "Launch in CLI" button per mesh. Clicking it:
1. Generates a one-time handoff token server-side (60-second TTL)
2. Copies `claudemesh launch --mesh {slug}` to the clipboard (plus the token as an env var)
3. Shows a toast: "Copied. Paste in your terminal to join."

User pastes and runs. The CLI:
1. Resolves the mesh from `--mesh <slug>`
2. If the mesh isn't already joined locally, silently claims the one-time token and joins
3. Shows a one-line confirmation if state changed (see §14.2)
4. Launches Claude Code

### 14.2 Confirmation line for state-changing handoffs

When the clipboard handoff triggers a join (disk state changed), a single confirmation line appears:

```
✔ Joined "platform-team" from the dashboard link.
```

If the user was already a member:

```
Already in "platform-team". Launching…
```

These lines are exceptions to Rule 2 because state changed silently would be deceptive.

### 14.3 "Launch in CLI" button design (dashboard side)

```
┌──────────────────────────────────────┐
│  platform-team                        │
│  7 peers · 2 online                   │
│                                       │
│  [Launch in CLI]  [Settings]          │
└──────────────────────────────────────┘
```

"Launch in CLI" in the brand `primary` color, "Settings" in muted. Click → toast → done.

### 14.4 Browser copy catalog alignment

All browser-side copy related to CLI flows lives in a shared catalog at `packages/shared-copy/cli-auth/en.ts` and is imported by both `apps/web/` (for rendering) and `apps/cli-v2/` (for displaying "return to your terminal" hints and verifying backend responses match expected text). CI fails if the catalogs drift.

---

## 15. Claude Code status-line integration

### 15.1 What Claude Code sees

The MCP server exposes a mesh-status tool that Claude Code polls (or subscribes to):

```json
{
  "mesh_slug": "platform-team",
  "mesh_name": "Platform team",
  "peer_count": 7,
  "peers_online": 2,
  "broker_connected": true,
  "sync_pending": 0,
  "schema_version": "1.0"
}
```

### 15.2 Status line rendering

Claude Code's status line reads this and renders a single line at the bottom-right:

```
◉ platform-team · 2 peers
```

### 15.3 Responsive widths

Depending on available width:

- Full: `◉ platform-team · 2 peers`
- Medium: `◉ platform-team`
- Compact: `◉ ·2`
- Minimal: `◉`

When `peers_online === 0` (you're alone in the mesh):

- Full: `◉ platform-team · solo`
- Medium: `◉ platform-team`
- Compact: `◉ solo`
- Minimal: `◉`

ICU plural rules handle the `1 peer` / `2 peers` distinction for English and per-locale rules for Spanish.

### 15.4 Dot states

- `◉` (green via `success`) — broker connected, sync caught up
- `◉` (amber via `warning`) — broker connected, sync pending > 0
- `◉` (yellow via `warning`) — broker connecting (during reconnect)
- `◎` (gray via `muted`) — broker disconnected (queueing locally)
- (nothing) — not in a mesh or in personal mode without sync

### 15.5 Click or slash-command interaction

Clicking the status line (if Claude Code supports click) or running `/mesh` as a slash command opens a compact overlay:

```
◉  platform-team (owned)

Peers (7, 2 online)
  alice       working    launching CI
  bob         idle       —
  carol       offline    (last seen 2m ago)
  …

[Invite]  [Leave]
```

Dismissible. Actions at the bottom.

---

## 16. Delight beats (four total)

**Exactly four delight beats per major version.** Not six, not five, not one per screen. Four.

Trust surfaces (§8) are a distinct category and do NOT count against this budget.

### 16.1 The locked catalog

1. **First-run closing sentence**
   > `"You're in."`

   Shown exactly once per machine, in the first-run flow. State: `milestoneShown.firstRunClosing = true`.

2. **First publish success**
   > `"Your mesh is live. Anyone with the invite can join."`

   Shown when a personal mesh is successfully published as shared. State: `milestoneShown.firstPublish = true`.

3. **First invite sent**
   > `"Sent. They'll see it when they check their inbox."`

   Shown when the user successfully sends their first invite by email (not clipboard — the clipboard flow has its own confirmation in §6.6 that's utility, not delight). State: `milestoneShown.firstInvite = true`.

   **Why two sentences**: a single-word "Sent." is too minimal to register as delight — it reads as a confirmation checkmark, not an emotional payoff. The second sentence completes the beat with a calm acknowledgment of what happens next. Still under the 1-sentence verbosity budget because the two are parts of one thought (the payoff + the implication).

4. **100th session milestone**
   > `"Nice to see you again."`

   Shown exactly once, at the 100th `daily_launch` session (see §16.3 for counter semantics). State: `milestoneShown.hundredth = true`.

### 16.2 The 5th slot

Slot #5 is **reserved**. Not a placeholder — if no genuinely delightful moment is found for v1.0.0, the product ships with 4. Better to ship fewer good beats than to pad the count.

### 16.3 Counter semantics for the 100th-session milestone

- **What counts**: every successful `daily_launch` session that reaches the handoff to Claude Code. `--help`, `doctor`, `whoami`, first-run, and failed launches don't count.
- **Storage**: `~/.claudemesh/state.json` → `state.sessionCount: number`. Incremented atomically inside the handoff transaction.
- **Trigger**: when `sessionCount === 100` exactly (not ≥). Shown once. Never shown again even if state is reset.
- **Shown-flag**: `state.milestoneShown.hundredth: boolean` to prevent re-showing.
- **Reset behavior**: `claudemesh advanced telemetry off` does NOT reset the counter. `rm -rf ~/.claudemesh` does (effectively a new machine). Explicit `claudemesh advanced reset-milestones` exists for testing.
- **No network**: counter is purely local, never transmitted.

### 16.4 Growth across versions

**Four delight beats per major version.** v1.0.0 ships with 4. v1.1–1.9 can each add at most 1 new beat (minor version cap +1, total cap 13 in the v1 lifetime). v2.0 resets the counter.

**Strict rule**: a minor release cannot add more than 1 new delight beat. Additions require design review.

---

## 17. Anti-patterns (forbidden behaviors)

Literal blocklist. Every one of these has appeared in other CLIs and been painful.

### 17.1 Prompts we will never show

- "Do you want to continue? [Y/n]" — if yes is always correct, don't ask
- "Are you sure?" — use typed confirmation for destructive operations
- "Is this your first time?" — we know from the filesystem
- "What's your name?" — we know from the account
- "Would you like to install shell completions?" — ship them automatically
- "Please rate your experience"
- "We noticed you haven't used us in a while. Everything OK?"

### 17.2 Outputs we will never produce

- ASCII art logos on every command
- Emojis in log output
- Unicode box drawing around error messages
- Color-only state indication
- Rainbow gradients
- Blinking text
- Sound (bell character `\a`)
- Claiming success before success is confirmed
- Hiding errors behind "debug mode"
- Forcing the user to read a TOS on first run
- **Brand mark / ASCII art on the first-run welcome** (typography only)

### 17.3 Commands we will never add

- `claudemesh say <message>` — cutesy inter-peer chat belongs in Claude Code itself
- `claudemesh games`
- `claudemesh weather`
- `claudemesh update` self-updater — `npm i -g claudemesh-cli@latest` is the update path
- `claudemesh reset --hard` — too dangerous to expose as one command
- `claudemesh sudo`
- `claudemesh agi`

### 17.4 Behaviors we will never adopt

- Phoning home on startup except for opt-out update check
- Auto-updating without user action
- Silently modifying files outside `~/.claudemesh/`
- Starting background daemons without telling the user
- Running `sudo` without explicit permission
- Reading env vars we don't need
- Logging PII even hashed
- Emitting `\a` bell characters
- Overriding the user's locale
- Overriding the user's terminal theme colors

### 17.5 The "explain it in a tweet" test

Every feature, every command, every screen must pass this test: **can you explain what it does in a single tweet without sounding silly?** If not, it's over-designed.

---

## 18. Locked copy governance

### 18.1 What "locked" means

Some strings are marked **locked** in the microcopy catalog. A locked string cannot change without a design review.

Locked strings in v1.0.0:

- `firstRun.closing` = `"You're in."`
- `milestone.hundredth` = `"Nice to see you again."`
- `invite.email.sent` = `"✔ Sent to {email}."` (exact form)
- The first-run scenario scripts (§4.1, §4.2) — every word and linebreak
- The main `--help` command descriptions (§11.2)

### 18.2 Locked does not mean frozen

Locked strings can still be:
- Translated per locale (with per-locale length budgets)
- Reformatted for accessibility (e.g. ASCII fallback for icons)
- Reformatted for terminal width (e.g. sub-60-col reflow)

Locked means the **intent** is fixed. The English literal can change if a reviewer approves; the translated versions must preserve the intent.

### 18.3 Adding new strings

New user-visible strings follow a review path:
1. Draft in the microcopy catalog (`locales/en.ts`)
2. Pass the Copy Review Checklist (§20)
3. Approver (not the author) signs off
4. CI runs the forbidden-concepts lint across all locales
5. Ships

---

## 19. Visual audit checklist

Run through this before every visual change ships.

- [ ] No inline color strings — all from `ui/styles.ts`
- [ ] No inline icon unicode — all from `Icons`
- [ ] No boxes, borders, or Unicode drawing characters
- [ ] No emoji in user-visible output
- [ ] All status states distinguishable in monochrome
- [ ] Works at 60-column terminal width
- [ ] Works at 120-column terminal width without stretching
- [ ] Works in light-theme terminal
- [ ] Works in dark-theme terminal
- [ ] Works with `NO_COLOR=1`
- [ ] Works with `CLAUDEMESH_NO_UNICODE=1` (ASCII fallback)
- [ ] All spinners have >200ms minimum display time OR are removed
- [ ] Every string comes from `locales/`
- [ ] Error messages are 1–3 sentences, end with exactly one action
- [ ] Success messages are 1 line
- [ ] No forbidden concepts (§3.2)
- [ ] Picker preselects the most likely action
- [ ] Selection uses 3-signal indication (icon + bold + position)
- [ ] Keyboard conventions respected (Enter, Escape, arrows, Tab no-op)
- [ ] `?` overlay available on interactive screens
- [ ] Terminal state is clean after exit (no leftover ANSI, cursor visible)

## 20. Copy review checklist

Run through this before every string change ships.

- [ ] Voice is informed, restrained, competent, warm-but-not-familiar
- [ ] Active voice
- [ ] Second person singular ("you", "your")
- [ ] Present tense
- [ ] Specific over vague
- [ ] No forbidden concepts in EN or ES
- [ ] Within verbosity budget (§3.4)
- [ ] No exclamation marks
- [ ] No rhetorical questions
- [ ] No "we" when "claudemesh" or passive would be clearer
- [ ] Errors end with exactly one primary action
- [ ] ICU interpolation handles plurals correctly
- [ ] Reads well to a non-native speaker
- [ ] Reads well when said out loud

---

## 21. Stable JSON API versioning

Scripts depend on the shape of `--json` output. Breaking changes would break user automation.

### 21.1 Every JSON output includes `schema_version`

```json
{
  "schema_version": "1.0",
  "meshes": [
    {
      "slug": "alejandro-mbp",
      "name": "Alejandro's Mac",
      "kind": "personal",
      "peer_count": 1
    }
  ]
}
```

### 21.2 Rules

- Breaking changes bump `schema_version` (major)
- Additive changes (new fields) do not bump (minor)
- The CLI supports the current + previous schema version for at least 6 months
- Scripts check `schema_version` and adapt

### 21.3 Fields stable for v1.0.0

- `meshes[].slug`, `name`, `kind`, `peer_count`, `peers_online`, `last_used_at`
- `peers[].peer_id`, `display_name`, `status`, `summary`, `last_seen_at`
- `whoami.signed_in`, `user.id`, `user.display_name`, `user.email`, `token_source`

Adding new fields is safe. Renaming or removing fields requires a major bump.

---

**End of spec.**
