# TurboStarter Wireframe Library Architecture

**Date:** 2026-02-01 16:15
**Context:** Designing a reusable Excalidraw wireframe library based on TurboStarter boilerplate UI

## Overview

A comprehensive wireframe system for TurboStarter projects featuring:
- Token-based theming (18 color variants)
- Component templates (reusable building blocks)
- Progressive fidelity (LOW → MEDIUM → HIGH)
- Maximum parallelization (3-5 agents per wave)

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  TURBOSTARTER WIREFRAME LIBRARY                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. TOKEN-BASED THEMING                                     │
│     └─ $tokens → apply-theme.js → 18 color variants         │
│                                                             │
│  2. COMPONENT TEMPLATES (Wave 0)                            │
│     └─ Reusable layouts + components = building blocks      │
│                                                             │
│  3. PROGRESSIVE FIDELITY (Waves 1-3)                        │
│     └─ LOW → copy+enhance → MEDIUM → copy+enhance → HIGH    │
│                                                             │
│  4. MAX PARALLELIZATION                                     │
│     └─ 3-5 agents per wave, templates inherited             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Folder Structure

```
_bmad-output/excalidraw-diagrams/
├── CLAUDE.md                  # AI context for managing wireframes
├── wireframe-themes.json      # 18 theme color definitions
├── apply-theme.js             # Script to apply themes
├── wireframe-theming.md       # Detailed theming docs
│
├── _templates/                # SHARED BASE COMPONENTS
│   ├── layouts/
│   │   ├── dashboard.excalidraw    # Sidebar + Header + Content
│   │   ├── auth.excalidraw         # Two-column auth split
│   │   └── marketing.excalidraw    # Header + Content + Footer
│   └── components/
│       ├── sidebar.excalidraw      # Collapsible sidebar
│       ├── header.excalidraw       # Dashboard header pattern
│       ├── data-table.excalidraw   # Table + toolbar + pagination
│       ├── card-grid.excalidraw    # 3-column card layout
│       ├── form.excalidraw         # Form with inputs/buttons
│       └── modal.excalidraw        # Dialog/modal pattern
│
├── low-fidelity/              # Quick sketches
├── medium-fidelity/           # Defined elements
└── high-fidelity/             # Detailed wireframes
```

## Theming System

### Token Colors

| Token | Purpose |
|-------|---------|
| `$background` | Page/screen background |
| `$foreground` | Primary text |
| `$primary` | Brand color, CTAs |
| `$secondary` | Secondary backgrounds |
| `$muted` | Disabled/placeholder |
| `$border` | Borders, dividers |
| `$card` | Card backgrounds |
| `$destructive` | Delete/error |
| `$success` | Success states |
| `$sidebar` | Sidebar background |
| `$sidebar-foreground` | Sidebar text |

### Available Themes (9 colors × 2 modes = 18)

- orange-light, orange-dark
- blue-light, blue-dark
- green-light, green-dark
- red-light, red-dark
- rose-light, rose-dark
- violet-light, violet-dark
- yellow-light, yellow-dark
- gray-light, gray-dark
- stone-light, stone-dark

### Apply Theme Command

```bash
node apply-theme.js <input.excalidraw> <theme-name> [output.excalidraw]
```

## Screen Inventory

### Auth Screens (4)
| Screen | Template Base | Description |
|--------|---------------|-------------|
| auth-login | layout-auth | Email/password + OAuth |
| auth-register | layout-auth | Registration form |
| auth-forgot-password | layout-auth | Password reset |
| auth-join-org | layout-auth | Organization invitation |

### Dashboard Layouts (3)
| Screen | Template Base | Description |
|--------|---------------|-------------|
| dashboard-user | layout-dashboard | User dashboard home |
| dashboard-org | layout-dashboard | Organization analytics |
| dashboard-admin | layout-dashboard | Admin panel |

### Sidebars (3)
| Screen | Template Base | Description |
|--------|---------------|-------------|
| sidebar-apps | component-sidebar | Apps navigation |
| sidebar-dashboard | component-sidebar | User dashboard nav |
| sidebar-admin | component-sidebar | Admin navigation |

### Settings Pages (3)
| Screen | Template Base | Description |
|--------|---------------|-------------|
| settings-general | layout-dashboard + form | Profile settings |
| settings-security | layout-dashboard + form | 2FA, passkeys |
| settings-billing | layout-dashboard + card-grid | Plans, credits |

### Data Components (3)
| Screen | Template Base | Description |
|--------|---------------|-------------|
| data-table-users | component-data-table | Admin users table |
| data-table-members | component-data-table | Org members |
| data-table-toolbar | component-data-table | Filters, search |

## Fidelity Levels

### LOW Fidelity
- Basic rectangles and shapes
- Placeholder text ("xxxxx")
- No styling details
- Focus on layout and flow
- **Use for:** Early concepts, quick iteration

### MEDIUM Fidelity
- Defined UI elements (buttons, inputs)
- Representative labels
- Basic iconography (rectangles with X)
- Approximate sizing
- **Use for:** Design reviews, stakeholder feedback

### HIGH Fidelity
- Realistic element sizes
- Actual content examples
- Proper spacing and alignment
- Icon placeholders that match intent
- **Use for:** Developer handoff, final approval

## Execution Plan

### Wave 0: Templates (3 parallel agents)

| Agent | Output |
|-------|--------|
| T1 | layouts/dashboard, layouts/auth, layouts/marketing |
| T2 | components/sidebar, components/header, components/data-table |
| T3 | components/card-grid, components/form, components/modal |

**Output:** 9 template files

### Wave 1: LOW Fidelity (5 parallel agents)

| Agent | Screens | Uses Templates |
|-------|---------|----------------|
| A | auth-login, auth-register, auth-forgot-password, auth-join-org | layout-auth |
| B | dashboard-user, dashboard-org, dashboard-admin | layout-dashboard |
| C | sidebar-apps, sidebar-dashboard, sidebar-admin | component-sidebar |
| D | settings-general, settings-security, settings-billing | layout-dashboard + form |
| E | data-table-users, data-table-members, data-table-toolbar | component-data-table |

**Output:** 16 LOW fidelity files

### Wave 2: MEDIUM Fidelity (5 parallel agents)

Same agent assignments. Each agent:
1. Reads corresponding LOW file
2. Copies all elements
3. Enhances with labels, better proportions, sizing
4. Saves to medium-fidelity/

**Output:** 16 MEDIUM fidelity files

### Wave 3: HIGH Fidelity (5 parallel agents)

Same agent assignments. Each agent:
1. Reads corresponding MEDIUM file
2. Copies all elements
3. Adds detail, realistic content, final polish
4. Saves to high-fidelity/

**Output:** 16 HIGH fidelity files

## Total Output

| Category | Files |
|----------|-------|
| Templates | 9 |
| LOW fidelity | 16 |
| MEDIUM fidelity | 16 |
| HIGH fidelity | 16 |
| **Total** | **57 files** |

With 18 theme variants available = unlimited themed outputs

## TurboStarter UI Reference

### Standard Dimensions (Desktop 1440×900)
- Sidebar width: 280px (expanded), 60px (collapsed)
- Header height: 64px
- Content padding: 24px
- Card gap: 16px
- Button height: 40px
- Input height: 40px

### Layout Patterns

**Dashboard Layout:**
```
┌─────────────────────────────────────────┐
│ SidebarProvider                         │
│ ┌──────────┬──────────────────────────┐ │
│ │ Sidebar  │ SidebarInset             │ │
│ │ ┌──────┐ │ ┌──────────────────────┐ │ │
│ │ │Header│ │ │ DashboardHeader      │ │ │
│ │ ├──────┤ │ ├──────────────────────┤ │ │
│ │ │Content│ │ │ Page Content         │ │ │
│ │ ├──────┤ │ │                      │ │ │
│ │ │Footer│ │ │                      │ │ │
│ │ └──────┘ │ └──────────────────────┘ │ │
│ └──────────┴──────────────────────────┘ │
└─────────────────────────────────────────┘
```

**Auth Layout:**
```
┌────────────────────┬────────────────────┐
│                    │                    │
│   Logo + Form      │   Branding/Image   │
│   (Auth content)   │   (Decorative)     │
│                    │                    │
└────────────────────┴────────────────────┘
```

## Agent Instructions Template

### For Template Creation (Wave 0)
```
Create Excalidraw template at [path].
Use $tokens for all colors (see wireframe-themes.json).
Follow grid alignment (20px).
Include: [specific elements for this template]
Standard desktop: 1440×900.
```

### For Screen Creation (Waves 1-3)
```
[LOW] Create screen by copying [template], customize for [screen purpose].
[MEDIUM] Read [low file], copy elements, enhance with labels and sizing.
[HIGH] Read [medium file], copy elements, add detail and realistic content.
Save to [fidelity-level]/[screen-name].excalidraw.
```

## Related Files

- **Theme source:** `packages/ui/shared/src/styles/themes/`
- **UI components:** `packages/ui/`
- **App pages:** `apps/web/src/app/[locale]/`
- **Feature modules:** `apps/web/src/modules/`
- **Wireframe docs:** `_bmad-output/excalidraw-diagrams/CLAUDE.md`

## Next Steps

1. Execute Wave 0 (templates) - 3 parallel agents
2. Review templates
3. Execute Wave 1 (LOW) - 5 parallel agents
4. Review LOW screens
5. Execute Wave 2 (MEDIUM) - 5 parallel agents
6. Execute Wave 3 (HIGH) - 5 parallel agents
7. Final review and validation
