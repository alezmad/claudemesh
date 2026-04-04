# TurboStarter Wireframe Library

## Overview

This folder contains reusable Excalidraw wireframes based on TurboStarter's boilerplate UI. Use these as templates when creating project-specific wireframes.

**Full Architecture:** See `ARCHITECTURE.md` for complete details on the design system, execution plan, and screen inventory.

## Folder Structure

```
.context/turbostarter-framework-context/wireframes/
├── CLAUDE.md                 # This file - AI context
├── ARCHITECTURE.md           # Full architecture documentation
├── wireframe-themes.json     # Theme color definitions (8 variants)
├── apply-theme.js            # Script to apply themes to wireframes
├── wireframe-theming.md      # Detailed theming documentation
│
├── _templates/               # Reusable building blocks ($tokens)
│   ├── layouts/              # dashboard, auth, marketing
│   └── components/           # sidebar, header, data-table, etc.
│
├── low-fidelity/             # Basic layouts ($tokens)
├── medium-fidelity/          # + Labels & content ($tokens)
├── high-fidelity/            # + Final polish ($tokens)
│
└── themed/                   # Ready-to-view files (actual colors)
    ├── high/                 # HIGH fidelity with orange theme
    ├── medium/               # MEDIUM fidelity with orange theme
    ├── low/                  # LOW fidelity with orange theme
    └── templates/            # Templates with orange theme
```

## Quick Start

### View Wireframes (Open in Excalidraw)

Use files from `themed/` folder - they have actual colors:
```
themed/high/auth-login.excalidraw
themed/high/dashboard-user.excalidraw
themed/high/data-table-users.excalidraw
```

### Change Theme

```bash
# Apply different theme to all files
cd .context/turbostarter-framework-context/wireframes
for f in high-fidelity/*.excalidraw; do
  node apply-theme.js "$f" blue-light "themed/high/$(basename $f)"
done
```

Available themes: `orange-light`, `orange-dark`, `blue-light`, `blue-dark`, `green-light`, `green-dark`, `violet-light`, `violet-dark`

## Token Colors (For Creating New Wireframes)

| Token | Purpose |
|-------|---------|
| `$background` | Page/screen background |
| `$foreground` | Primary text |
| `$primary` | Brand color, CTAs |
| `$primary-foreground` | Text on primary |
| `$secondary` | Secondary backgrounds |
| `$muted` | Disabled/placeholder backgrounds |
| `$muted-foreground` | Disabled/placeholder text |
| `$border` | Borders, dividers |
| `$card` | Card backgrounds |
| `$destructive` | Delete/error |
| `$success` | Success states |
| `$sidebar` | Sidebar background |
| `$sidebar-foreground` | Sidebar text |

## Screen Inventory (16 screens × 3 fidelities = 48 files)

### Auth Screens (4)
- `auth-login` - Email/password + OAuth
- `auth-register` - Registration form
- `auth-forgot-password` - Password reset
- `auth-join-org` - Organization invitation

### Dashboard Layouts (3)
- `dashboard-user` - User dashboard with cards
- `dashboard-org` - Organization analytics
- `dashboard-admin` - Admin panel

### Sidebars (3)
- `sidebar-apps` - Apps navigation
- `sidebar-dashboard` - User dashboard nav
- `sidebar-admin` - Admin navigation

### Settings (3)
- `settings-general` - Profile, language
- `settings-security` - 2FA, passkeys, sessions
- `settings-billing` - Plans, credits, history

### Data Tables (3)
- `data-table-users` - Admin users management
- `data-table-members` - Organization members
- `data-table-invitations` - Pending invitations

## Templates (9 reusable components)

### Layouts
- `dashboard` - Sidebar + Header + Content
- `auth` - Two-column auth split
- `marketing` - Header + Content + Footer

### Components
- `sidebar` - Collapsible navigation
- `header` - Dashboard header
- `data-table` - Table + toolbar + pagination
- `card-grid` - 3-column card layout
- `form` - Inputs + buttons + OAuth
- `modal` - Dialog with backdrop

## Fidelity Levels

| Level | What | Use For |
|-------|------|---------|
| **LOW** | Boxes, layout only | Early concepts, IA validation |
| **MEDIUM** | + Labels, content | Design reviews, feedback |
| **HIGH** | + Details, polish | Developer handoff, approval |

## Standard Dimensions

- Canvas: 1440×900 (desktop)
- Sidebar: 280px wide
- Header: 64px height
- Content padding: 24px
- Card gap: 16px
- Button/Input height: 40-44px
- Grid: 20px

## Commands

```bash
# Apply theme
node apply-theme.js input.excalidraw orange-light output.excalidraw

# Validate JSON
node -e "JSON.parse(require('fs').readFileSync('file.excalidraw')); console.log('Valid')"

# Open themed folder
open themed/high/
```

## Related Files

- **Architecture**: `ARCHITECTURE.md`
- **TurboStarter themes**: `packages/ui/shared/src/styles/themes/`
- **UI components**: `packages/ui/`
- **App pages**: `apps/web/src/app/[locale]/`
