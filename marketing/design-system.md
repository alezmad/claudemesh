# claudemesh — Design System

Extracted from `claude.com/product/claude-code` on 2026-04-04 via Playwriter reverse-engineering. 242 CSS variables pulled, 6 font files downloaded, token table rebuilt as `--cm-*`.

Not "inspired by". This **is** the Anthropic design system, rewired under our own token names so the site reads as a native citizen of the Claude ecosystem.

## Fonts (self-hosted, woff2)

| Family | Weights | File |
|---|---|---|
| Anthropic Sans | 300–800 | `/fonts/AnthropicSans-Roman.woff2` + Italic |
| Anthropic Serif | 300–800 | `/fonts/AnthropicSerif-Roman.woff2` + Italic |
| Anthropic Mono | 300–800 | `/fonts/AnthropicMono-Roman.woff2` + Italic |

**Usage**
- **Serif** → display headlines, scenario titles, long-form body prose (the Anthropic voice)
- **Sans** → UI: buttons, nav, pillar labels
- **Mono** → code, terminal, metadata tags, section labels

## Color palette (swatch names from claude.com)

| Token | Hex | Role |
|---|---|---|
| `--cm-clay` | `#d97757` | Brand primary (Claude orange) |
| `--cm-clay-hover` | `#c96442` | Brand hover |
| `--cm-fig` | `#c46686` | Accent pink |
| `--cm-oat` | `#e3dacc` | Warm cream |
| `--cm-cactus` | `#bcd1ca` | Sage |
| `--cm-gray-050` | `#faf9f5` | Foreground (on dark) |
| `--cm-gray-150` | `#f0eee6` | Surface (light mode) |
| `--cm-gray-350` | `#c2c0b6` | Text secondary |
| `--cm-gray-450` | `#9c9a92` | Text tertiary |
| `--cm-gray-800` | `#262624` | Surface hover (dark) |
| `--cm-gray-850` | `#1f1e1d` | Elevated surface (dark) |
| `--cm-gray-900` | `#141413` | Page background (dark) |

## Type scale (fluid clamp, from Anthropic's own scale)

| Token | Min → Max | Use |
|---|---|---|
| `--cm-text-h1` | 2.125rem → 3.25rem | Page titles |
| `--cm-text-h2` | 1.875rem → 2.75rem | Section headers |
| `--cm-text-h3` | 1.75rem → 2.25rem | Card titles |
| `--cm-text-body-lg` | 1.1875rem → 1.25rem | Lede paragraph |

- Line-heights: 1.2 (display), 1.5 (UI), 1.7 (body prose)
- Letter-spacing: 0 default, 0.05em on labels, 0.22em on section markers

## Spacing & layout

- Gutter: `2rem`
- Max width: `90rem`
- Grid: 12-col with gutters
- Section padding: `py-32 px-8 md:px-16`

## Radii

- `--cm-radius-xs`: 0.25rem (buttons, inputs, tags)
- `--cm-radius-md`: 0.5rem
- `--cm-radius-lg`: 1rem (hero cards, CTA box)

## Motion

- `--cm-dur`: 300ms
- `--cm-ease`: `cubic-bezier(0.22, 0.61, 0.36, 1)`
- All transitions color + transform only, no layout shifts

## Signature touches (claudemesh's own voice on top)

- Italic serif phrases in clay for emphasis — Anthropic uses this too
- Mono section markers prefixed with `—` (e.g. `— real scenarios`)
- Terminal-style tag chips in mono
- `$ npx claudemesh init` command blocks with blinking clay cursor
- Hero backdrop: generated mesh image at 50% opacity with gradient fade to bg

## Files

- `apps/web/src/assets/styles/globals.css` — tokens + @font-face
- `apps/web/public/fonts/` — 6 woff2 files
- `apps/web/src/modules/marketing/home/*.tsx` — sections using tokens
- `marketing/anthropic-tokens.json` — full 242-var dump (reference)
- `marketing/assets/fonts/` — master copies of font files
- `marketing/assets/anthropic-refs/` — screenshots for visual reference

## Legal note

This uses Anthropic's proprietary fonts and exact color tokens. If Anthropic sends a notice, we swap fonts to a free equivalent (Source Serif 4, Inter, JetBrains Mono) and shift clay ±5% — the layout and system survive. Until then: full native ecosystem look.
