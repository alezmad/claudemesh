# CLI Wizard Architecture Refactor

**Status:** backlog
**Created:** 2026-04-10
**Source:** Reverse-engineered from `@posthog/wizard` (npm cache), applied to `apps/cli/src/commands/launch.ts`

## Why

Launch wizard has three compounding problems:

1. **Imperative branching** — `launch.ts` checks account → mesh → name → role → exec in hardcoded order. Adding a screen requires touching existing code. Hard to reason about `--resume`, `--non-interactive`, and skip conditions.
2. **Terminal bleed-through on handoff** — wizard→`claude` exec corrupts Ink's TUI state (garbled word wraps, tool labels overwritten, spinner fragments fused to paths). Root cause is spread across multiple exit paths instead of one choke point.
3. **Inconsistent visual design** — ad-hoc colors per file, no central palette, no shared icon set, no shared layout primitives. Every screen reinvents status rows, centering, and spacing.

PostHog's wizard solves all three with one architectural pattern: **declarative flow pipelines + session-as-store + shared visual primitives**. This artifact captures the plan to port that pattern.

## What PostHog does (the reference)

### Flow pipeline (`flows.ts` + `router.ts`)

Each wizard flow is an array of screen entries:

```ts
export const FLOWS = {
  [Flow.Wizard]: [
    { screen: Screen.Intro,       isComplete: s => s.setupConfirmed },
    { screen: Screen.HealthCheck, isComplete: s => s.readinessResult !== null },
    { screen: Screen.Setup,       show: needsSetup, isComplete: s => !needsSetup(s) },
    { screen: Screen.Auth,        isComplete: s => s.credentials !== null },
    { screen: Screen.Run,         isComplete: s => s.runPhase === RunPhase.Completed },
    { screen: Screen.Outro,       isComplete: s => s.outroDismissed },
  ],
};
```

The router walks the array, skips entries where `show(s) === false` or `isComplete(s) === true`, and returns the first remaining entry. Zero switch statements. Zero hardcoded transitions. Adding a screen = appending an object.

### Overlay stack

Separate from the linear flow cursor. Interrupts (port conflict, auth expired, managed settings) are pushed onto `overlays[]` from anywhere and popped when dismissed. Active screen = top of overlay stack OR flow cursor. Flows never need to know about interrupts.

### Session as single source of truth

One `WizardStore` holds all session state. Screens subscribe via React 18 `useSyncExternalStore`. Completion predicates read session; imperative code writes session; the router re-resolves on every change.

### Visual primitives

- `styles.ts` — 6-color palette (`Colors`), 9-icon set (`Icons`), alignment enums (`HAlign`, `VAlign`)
- `CardLayout` — semantic centering wrapper used by every screen
- `PickerMenu` — the only selection primitive, used for every choice
- `screen-registry.ts` — maps `Screen` enum → React component
- Brand mark: three colored `█` blocks next to the wizard name on every screen header

## What claudemesh should do

### Target file layout

```
apps/cli/src/
├── commands/
│   └── launch.ts                 # thin entrypoint: parse flags → start TUI
└── ui/
    ├── styles.ts                 # palette, icons, alignment enums
    ├── store.ts                  # LaunchStore (session + subscribe)
    ├── router.ts                 # flow cursor + overlay stack
    ├── flows.ts                  # FLOWS = { Launch: [...], Join: [...] }
    ├── screen-registry.ts        # Screen enum → component
    ├── primitives/
    │   ├── CardLayout.tsx
    │   ├── PickerMenu.tsx
    │   ├── StatusRows.tsx        # new: "Directory ✓ /claudemesh" pattern
    │   ├── BrandMark.tsx         # new: 3 colored squares + label
    │   └── LoadingBox.tsx
    └── screens/
        ├── WelcomeScreen.tsx
        ├── AccountScreen.tsx
        ├── MeshPickerScreen.tsx
        ├── NameRoleScreen.tsx
        ├── ConfirmScreen.tsx
        └── HandoffScreen.tsx     # last screen; its unmount triggers exec claude
```

### Flow definition

```ts
export const FLOWS = {
  [Flow.Launch]: [
    { screen: Screen.Welcome,    isComplete: s => s.welcomed },
    { screen: Screen.Account,    show: s => !s.hasAccount,     isComplete: s => s.hasAccount },
    { screen: Screen.MeshPicker, show: s => s.meshes.length > 1, isComplete: s => s.meshSlug !== null },
    { screen: Screen.NameRole,   isComplete: s => s.displayName !== null && s.role !== null },
    { screen: Screen.Confirm,    isComplete: s => s.confirmed },
    { screen: Screen.Handoff,    isComplete: () => false }, // terminal screen
  ],
};
```

### `--resume` works for free

`--resume <id>` populates the session from saved state; every satisfied predicate auto-skips. The wizard renders only the screens that still need input. No special `--resume` branches in screen code.

### `--non-interactive` works for free

Non-interactive mode: walk the flow, for each incomplete entry check if its required session fields can be sourced from CLI flags. If yes, populate and continue. If no, **fail fast with a clear message** naming the missing flag. Never silently guess defaults.

```
$ claudemesh launch --non-interactive --name Alexis
✗ Missing --mesh (required in non-interactive mode when >1 mesh joined)
  Available meshes: alexis-mou, dev, staging
```

### Overlay interrupts claudemesh needs

- `BrokerDisconnect` — WS dropped mid-wizard, retry countdown
- `InviteInvalid` — paste invite screen rejected token
- `MeshNotFound` — `--mesh foo` passed but not joined
- `RateLimit` — broker rate limited the CLI, backoff timer
- `UpdateAvailable` — newer CLI version on npm, non-blocking banner

### Terminal handoff choke point

The last flow entry (`Screen.Handoff`) renders a brief "Launching Claude Code…" card, then:

```ts
// apps/cli/src/ui/screens/HandoffScreen.tsx (on mount)
useEffect(() => {
  (async () => {
    await inkApp.unmount();
    await inkApp.waitUntilExit();
    resetTerminal();                 // single choke point for ANSI teardown
    await flushStdout();
    execa('claude', claudeArgs, { stdio: 'inherit' });
  })();
}, []);
```

`resetTerminal()` lives in `apps/cli/src/ui/terminal.ts`:

```ts
export function resetTerminal() {
  process.stdout.write(
    '\x1b[0m' +       // reset SGR
    '\x1b[?25h' +     // show cursor
    '\x1b[?1049l' +   // exit alt-screen
    '\x1b[?1000l' +   // disable mouse tracking
    '\x1b[?1002l' +
    '\x1b[?1003l' +
    '\x1b[?1006l' +
    '\x1b[?2004l' +   // disable bracketed paste
    '\x1b[2J' +       // clear screen
    '\x1b[H'          // cursor home
  );
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
}
```

PostHog only does SGR reset + clear + home on unmount — they don't hand off to another full-screen app, so that's enough for them. Claudemesh needs the full mode-reset because Claude Code takes over the TTY.

### Visual design system

`apps/cli/src/ui/styles.ts`:

```ts
export const Colors = {
  primary: 'cyan',
  accent: '#7C3AED',      // claudemesh purple
  title: '#4C1D95',
  success: 'green',
  error: 'red',
  warning: 'yellow',
  muted: 'gray',
} as const;

export const Icons = {
  check: '✔',
  cross: '✘',
  warning: '⚠',
  arrow: '▶',
  smallArrow: '▸',
  bullet: '•',
  diamond: '◆',
  square: '█',
} as const;

export enum HAlign { Left = 'flex-start', Center = 'center', Right = 'flex-end' }
export enum VAlign { Top = 'flex-start', Center = 'center', Bottom = 'flex-end' }
```

Every screen imports from here. No inline color strings allowed.

### Status rows pattern

Replaces the current plain-text banner:

```
  ██  claudemesh launch

  Directory  ✔  /claudemesh
  Account    ✔  agutierrez@mineryreport.com
  Mesh       ✔  alexis-mou (9 peers online)
  Name       ✔  Alexis
  Role       ▸  (pick one)

  ▸ Continue
    Change mesh
    Cancel
```

## Implementation order

| # | Impact | Effort | Scope |
|---|---|---|---|
| 1 | High  | S | `ui/styles.ts` — palette + icons + alignment enums; migrate existing screens |
| 2 | High  | S | `ui/primitives/StatusRows.tsx` + `BrandMark.tsx` |
| 3 | High  | M | `ui/store.ts` + `ui/router.ts` + `ui/flows.ts` (flow pipeline core) |
| 4 | High  | M | Refactor `launch.ts` to render through router; port existing screens |
| 5 | High  | S | `HandoffScreen` + `resetTerminal()` choke point — fixes TUI bleed bug |
| 6 | High  | S | Preselect "Continue" on every confirmation screen (one-keypress happy path) |
| 7 | Med   | M | Overlay stack + first two overlays (`BrokerDisconnect`, `InviteInvalid`) |
| 8 | Med   | M | `--non-interactive` mode using flow walker + fail-fast flag check |
| 9 | Med   | S | Per-mesh/per-role `preRunNotice` extension point |
| 10| Low   | L | `DissolveTransition` / `ContentSequencer` polish primitives |

Steps 1–5 are the atomic unit of value: they fix the bleed-through bug, establish the visual system, and unblock everything else. Should ship as one PR.
Steps 6–9 can each ship independently.
Step 10 is polish — defer until after v0.2.

## Open questions

- **Ink version**: current CLI uses Ink 4.x? PostHog is on Ink 5 with `useSyncExternalStore`. Check `apps/cli/package.json` before porting the store pattern — Ink 4 needs a different subscription approach.
- **React version**: `useSyncExternalStore` is React 18+. Confirm.
- **Flow granularity**: should `Join` (paste invite) be a separate flow from `Launch`, or an overlay inside `Launch`? PostHog-style: separate flow triggered from the welcome screen. Simpler.
- **Resume semantics**: does `--resume <id>` resume the *Claude* session only, or also restore the wizard's last mesh/name/role choice? If the latter, need a `~/.claudemesh/sessions/<id>.json` alongside Claude's own session file.

## References

- PostHog wizard source: `~/.npm/_npx/b48b11b34a0cada0/node_modules/@posthog/wizard/dist/src/ui/tui/`
  - `start-tui.js` — Ink bootstrap + cleanup
  - `router.js` — flow cursor + overlay stack
  - `flows.js` — declarative pipeline definition
  - `styles.js` — palette + icons
  - `screens/IntroScreen.js` — reference for status rows + picker
  - `primitives/CardLayout.js` — semantic centering
