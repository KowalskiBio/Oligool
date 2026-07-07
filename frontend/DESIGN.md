# Oligool Frontend Design System

## 1. Atmosphere & Identity

A calm, technical workbench for molecular biology. The interface favors clarity and information density over ornament: soft slate surfaces, crisp indigo accents, and generous whitespace around tools so sequence data remains the hero. The signature is restrained utility — every panel feels like a precision instrument.

## 2. Color

### Palette

| Role | Token | Light | Dark | Usage |
|------|-------|-------|------|-------|
| Surface/page | `--surface-page` | `#f8fafc` | `#0f172a` | Page background |
| Surface/primary | `--surface-primary` | `#ffffff` | `#1e293b` | Cards, panels, header |
| Surface/secondary | `--surface-secondary` | `#f1f5f9` | `#334155` | Subtle panel backgrounds, hovered rows |
| Surface/elevated | `--surface-elevated` | `#ffffff` | `#1e293b` | Modals, popovers (same as primary) |
| Text/primary | `--text-primary` | `#1e293b` | `#f1f5f9` | Headings, primary labels |
| Text/secondary | `--text-secondary` | `#64748b` | `#94a3b8` | Captions, metadata, hints |
| Text/tertiary | `--text-tertiary` | `#94a3b8` | `#64748b` | Disabled, muted text |
| Border/default | `--border-default` | `#e2e8f0` | `#334155` | Cards, dividers, button borders |
| Border/subtle | `--border-subtle` | `#f1f5f9` | `#1e293b` | Soft separations inside panels |
| Accent/primary | `--accent-primary` | `#6366f1` | `#818cf8` | Primary buttons, active toggles, links |
| Accent/hover | `--accent-hover` | `#4f46e5` | `#a5b4fc` | Hover state on accent elements |
| Status/success | `--status-success` | `#10b981` | `#34d399` | Success feedback, completed steps |
| Status/warning | `--status-warning` | `#f59e0b` | `#fbbf24` | Warnings, medium-identity badges |
| Status/error | `--status-error` | `#ef4444` | `#f87171` | Errors, destructive actions, mismatches |
| Status/info | `--status-info` | `#3b82f6` | `#60a5fa` | Informational highlights |

### Rules
- Accent is reserved for interactive/active states; do not use it decoratively.
- Dark mode is implemented via Tailwind `dark:` variants and the `.dark` class on `<html>`.
- Raw hex codes outside this table should not be introduced; extend this table first.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| Page title | `1.875rem` / 30px | 700 | 1.2 | App title "Oligool" |
| Section title | `1.125rem` / 18px | 600 | 1.3 | Card headers, MSA title |
| Body | `0.875rem` / 14px | 400 | 1.5 | Default text, descriptions |
| Body/sm | `0.75rem` / 12px | 400 | 1.4 | Metadata, monospaced positions |
| Caption | `0.6875rem` / 11px | 500 | 1.3 | Labels, badges |

### Font Stack
- Primary: `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif`
- Mono: `"Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`

### Rules
- Body text never drops below 14px.
- Monospace is used for sequence data, positions, accession IDs, and bp counts.

## 4. Spacing & Layout

### Base Unit

All spacing derives from a base of **4px**.

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 4px | Tight icon-to-label gap |
| `--space-2` | 8px | Inline button groups, small gaps |
| `--space-3` | 12px | Toolbar gaps |
| `--space-4` | 16px | Card padding (horizontal/vertical) |
| `--space-5` | 20px | Section padding |
| `--space-6` | 24px | Major component separation |
| `--space-8` | 32px | Page-level vertical rhythm |
| `--space-10` | 40px | Hero/header spacing |

### Layout
- Max content width: `1280px` (`max-w-7xl`).
- Page padding: `16px` mobile, `24px` tablet, `32px` desktop (`px-4 sm:px-6 lg:px-8`).
- Cards: `rounded-xl`, `border border-slate-200 dark:border-slate-700`, `shadow-sm`.

## 5. Components

### Button / Toggle Pill
- **Structure:** `<button>` with `px-2 py-1 text-xs font-medium rounded-md border`.
- **Variants:**
  - Default: `border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700`.
  - Active/Accent: `border-indigo-300 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30`.
  - Destructive: `border-red-200 dark:border-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10`.
- **States:** hover, active, focus via Tailwind ring utilities; transitions use `transition-colors`.

### Card / Panel
- **Structure:** Outer `div` with `border rounded-xl shadow-sm overflow-hidden bg-white dark:bg-slate-800`.
- **Header:** Gradient background `from-slate-50 to-indigo-50/50 dark:from-slate-800 dark:to-indigo-900/20`, bottom border, `px-5 py-3` or `px-5 py-4`.
- **Body:** `bg-white dark:bg-slate-800`.

### Badge
- **Structure:** `inline-block px-2 py-0.5 rounded-full text-xs font-medium`.
- **Variants:** green (≥95%), yellow (≥80%), red (<80%), purple (100%).

## 6. Motion & Interaction

### Timing
- Micro transitions: `150ms` `ease-out` — button hovers, toggles.
- Standard transitions: `200ms` `ease-in-out` — panel visibility, mode switches.

### Rules
- Only animate `transition-colors`, `transform`, and `opacity`.
- Respect `prefers-reduced-motion` where feasible.
- Every interactive element has a visible hover state.

## 7. Depth & Surface

### Strategy: Borders + subtle tonal shift

Cards and panels use 1px borders plus soft gradient header backgrounds to create depth. Shadows are minimal (`shadow-sm`) and reserved for card containers.

| Level | Value | Usage |
|-------|-------|-------|
| Card rest | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | Cards, panels |
| Header gradient | `bg-gradient-to-r from-slate-50 to-indigo-50/50` | Panel headers (light mode) |
