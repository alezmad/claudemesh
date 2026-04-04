# TurboStarter Wireframe Theming System

## Overview

The TurboStarter wireframe theming system uses **token-based color references** that allow Excalidraw wireframes to be themed dynamically. Instead of hardcoding hex colors directly in Excalidraw files, designers use semantic tokens like `$background`, `$primary`, etc. These tokens are later replaced with actual colors using the `apply-theme.js` script.

### How It Works

1. **Create wireframes using tokens** - Use `$tokenName` syntax for colors in Excalidraw's `strokeColor` and `backgroundColor` properties
2. **Store the template** - Save the `.excalidraw` file with tokens intact
3. **Apply a theme** - Run `apply-theme.js` to generate a themed version with real hex colors
4. **Multiple outputs** - Generate different themed versions from the same template

This approach enables:
- Single source of truth for wireframes
- Consistent branding across all diagrams
- Easy theme switching without manual color updates
- Light/dark mode variants from the same template

---

## Token Reference

| Token | Usage | Light Mode Example | Dark Mode Example |
|-------|-------|-------------------|-------------------|
| `$background` | Page/screen background | `#ffffff` (white) | `#1a1a1a` (near black) |
| `$foreground` | Primary text color | `#1a1a1a` (dark gray) | `#fafafa` (near white) |
| `$primary` | Brand color, CTAs, active states | Varies by theme (e.g., `#e85d04` orange) | Same or adjusted |
| `$secondary` | Secondary backgrounds, subtle fills | `#f5f5f5` (light gray) | `#262626` (dark gray) |
| `$muted` | Disabled states, placeholders, subtle text | `#f5f5f5` (light gray) | `#262626` (dark gray) |
| `$border` | Borders, dividers, outlines | `#e5e5e5` (gray) | `#404040` (medium gray) |
| `$card` | Card and panel backgrounds | `#ffffff` (white) | `#1f1f1f` (dark) |
| `$destructive` | Delete buttons, error states, warnings | `#ef4444` (red) | `#ef4444` (red) |
| `$success` | Success states, confirmations | `#22c55e` (green) | `#22c55e` (green) |
| `$sidebar` | Sidebar background | `#fafafa` (off-white) | `#171717` (darker) |
| `$sidebar-foreground` | Sidebar text | `#1a1a1a` (dark) | `#fafafa` (light) |

### Token Naming Convention

- Tokens always start with `$` prefix
- Names match TurboStarter CSS variable names
- Use kebab-case for multi-word tokens

---

## Available Themes

The system includes **18 themes** (9 color palettes x 2 modes):

### Color Palettes

| Color | Light Theme | Dark Theme | Primary Color |
|-------|-------------|------------|---------------|
| Orange | `orange-light` | `orange-dark` | `#e85d04` |
| Blue | `blue-light` | `blue-dark` | `#2563eb` |
| Green | `green-light` | `green-dark` | `#16a34a` |
| Red | `red-light` | `red-dark` | `#dc2626` |
| Rose | `rose-light` | `rose-dark` | `#e11d48` |
| Violet | `violet-light` | `violet-dark` | `#7c3aed` |
| Yellow | `yellow-light` | `yellow-dark` | `#eab308` |
| Gray | `gray-light` | `gray-dark` | `#374151` / `#6b7280` |
| Stone | `stone-light` | `stone-dark` | `#44403c` / `#78716c` |

### Theme Structure

Each theme defines all 11 tokens. Example for `orange-light`:

```json
{
  "$background": "#ffffff",
  "$foreground": "#1a1a1a",
  "$primary": "#e85d04",
  "$secondary": "#f5f5f5",
  "$muted": "#f5f5f5",
  "$border": "#e5e5e5",
  "$card": "#ffffff",
  "$destructive": "#ef4444",
  "$success": "#22c55e",
  "$sidebar": "#fafafa",
  "$sidebar-foreground": "#1a1a1a"
}
```

---

## How to Apply Themes

### Prerequisites

- Node.js installed
- `wireframe-themes.json` in the same directory as `apply-theme.js`

### Basic Usage

```bash
node apply-theme.js <input.excalidraw> <theme-name> [output.excalidraw]
```

### Examples

```bash
# Apply orange-light theme, auto-generate output filename
node apply-theme.js wireframe.excalidraw orange-light
# Output: wireframe-orange-light.excalidraw

# Apply blue-dark theme with custom output
node apply-theme.js wireframe.excalidraw blue-dark themed-wireframe.excalidraw

# Apply theme with verbose output
node apply-theme.js wireframe.excalidraw violet-light --verbose
```

### Generating Multiple Themes

```bash
# Generate all light themes
for theme in orange blue green red rose violet yellow gray stone; do
  node apply-theme.js wireframe.excalidraw ${theme}-light
done

# Generate light and dark for one color
node apply-theme.js wireframe.excalidraw orange-light
node apply-theme.js wireframe.excalidraw orange-dark
```

---

## For AI Assistants

### Quick Reference

When creating or modifying Excalidraw wireframes:

1. **Always use tokens** - Never hardcode hex colors for themeable elements
2. **Token format** - Use `$tokenName` in `strokeColor` and `backgroundColor` fields
3. **Common patterns:**
   - Page background: `"backgroundColor": "$background"`
   - Text/icons: `"strokeColor": "$foreground"`
   - Buttons/CTAs: `"backgroundColor": "$primary"` + `"strokeColor": "$primary"`
   - Cards/panels: `"backgroundColor": "$card"` + `"strokeColor": "$border"`
   - Input fields: `"backgroundColor": "$background"` + `"strokeColor": "$border"`
   - Disabled elements: `"backgroundColor": "$muted"` + `"strokeColor": "$muted"`
   - Error states: `"strokeColor": "$destructive"`
   - Success states: `"strokeColor": "$success"`

### Example Element

```json
{
  "type": "rectangle",
  "id": "button-cta",
  "x": 100,
  "y": 200,
  "width": 120,
  "height": 40,
  "strokeColor": "$primary",
  "backgroundColor": "$primary",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "roundness": { "type": 3, "value": 4 }
}
```

### Workflow

1. Create wireframe using `$tokens` for all colors
2. Save as `.excalidraw` file
3. Run `apply-theme.js` to generate themed versions
4. Use themed output in documentation or presentations

---

## Color Mapping to TurboStarter CSS

Wireframe tokens map directly to TurboStarter's Tailwind CSS variables:

| Wireframe Token | CSS Variable | Tailwind Class |
|-----------------|--------------|----------------|
| `$background` | `--background` | `bg-background` |
| `$foreground` | `--foreground` | `text-foreground` |
| `$primary` | `--primary` | `bg-primary`, `text-primary` |
| `$secondary` | `--secondary` | `bg-secondary` |
| `$muted` | `--muted` | `bg-muted`, `text-muted-foreground` |
| `$border` | `--border` | `border-border` |
| `$card` | `--card` | `bg-card` |
| `$destructive` | `--destructive` | `bg-destructive`, `text-destructive` |
| `$success` | `--success` | `bg-success`, `text-success` |
| `$sidebar` | `--sidebar` | `bg-sidebar` |
| `$sidebar-foreground` | `--sidebar-foreground` | `text-sidebar-foreground` |

### CSS Variable Definition (TurboStarter)

TurboStarter defines these in `globals.css`:

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-secondary: var(--secondary);
  --color-muted: var(--muted);
  --color-border: var(--border);
  --color-card: var(--card);
  --color-destructive: var(--destructive);
  --color-success: var(--success);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  /* ... additional variables */
}
```

---

## File Locations

| File | Path | Purpose |
|------|------|---------|
| Theme definitions | `_bmad-output/excalidraw-diagrams/wireframe-themes.json` | All 18 theme color mappings |
| Theme applicator | `_bmad-output/excalidraw-diagrams/apply-theme.js` | Script to apply themes |
| Template storage | `_bmad-output/excalidraw-diagrams/` | Store wireframe templates here |
| TurboStarter themes | `packages/ui/shared/src/styles/themes/` | Source theme definitions (OKLCH) |

---

## Extending the System

### Adding Custom Tokens

1. Add the token to `wireframe-themes.json` under each theme
2. Use the new token in wireframes as `$token-name`

### Adding Custom Themes

Add a new entry to `wireframe-themes.json`:

```json
{
  "themes": {
    "custom-brand-light": {
      "$background": "#ffffff",
      "$foreground": "#1a1a1a",
      "$primary": "#your-brand-color",
      "$secondary": "#f5f5f5",
      "$muted": "#f5f5f5",
      "$border": "#e5e5e5",
      "$card": "#ffffff",
      "$destructive": "#ef4444",
      "$success": "#22c55e",
      "$sidebar": "#fafafa",
      "$sidebar-foreground": "#1a1a1a"
    }
  }
}
```

---

## Troubleshooting

### Token Not Replaced

- Verify the token name matches exactly (case-sensitive)
- Ensure the token includes the `$` prefix
- Check that the theme includes the token in `wireframe-themes.json`

### Colors Look Wrong

- Confirm you're using the correct theme name (light vs dark)
- Verify the `wireframe-themes.json` file is up to date
- Check for typos in token names

### Script Errors

- Ensure `wireframe-themes.json` is valid JSON
- Verify the input `.excalidraw` file is valid JSON
- Check Node.js is installed and accessible
