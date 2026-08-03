# Oligool Design System

> Branch `slop` — full de-slop redesign. This file replaces the indigo/gradient era entirely.
> Every visual decision traces back here. No orphan hex codes, no ad-hoc Tailwind palettes.

## 1. Atmosphere & Identity

A precision lab instrument. Oligool feels like the software on a well-built bench device:
quiet, flat, exact. Neutrals do all the structural work; color appears only where it carries
meaning — one accent for interactivity to the exclusion of all decoration. Data (sequences,
alignments, coordinates) is the hero and always renders in monospace with tabular figures.

The signature is **flat exactness**: hairline borders and tonal surfaces instead of shadows
and gradients; small, dense, confident type; square-ish corners; zero gradients anywhere.

## 2. Color

One neutral family: **zinc**. One accent: **gel teal**. Status hues desaturated, sparing.

| Role | Light (Tailwind class) | Dark | Usage |
|------|------------------------|------|-------|
| Surface/page | `zinc-100` #f4f4f5 | `zinc-950` #09090b | App background |
| Surface/primary | `white` #ffffff | `zinc-900` #18181b | Cards, panels |
| Surface/secondary | `zinc-50` #fafafa | `zinc-800/60` | Panel headers, hovered rows |
| Surface/inset | `zinc-100` #f4f4f5 | `zinc-800` #27272a | Wells, inputs, skeleton blocks |
| Text/primary | `zinc-900` #18181b | `zinc-100` #f4f4f5 | Headings, values |
| Text/secondary | `zinc-500` #71717a | `zinc-400` #a1a1aa | Captions, metadata |
| Text/tertiary | `zinc-400` #a1a1aa | `zinc-500` #71717a | Disabled, placeholders |
| Border/default | `zinc-200` #e4e4e7 | `zinc-800` #27272a | Cards, dividers |
| Border/strong | `zinc-300` #d4d4d8 | `zinc-700` #3f3f46 | Control borders, hover borders |
| Accent/primary | `teal-700` #0f766e | `teal-300` #5eead4 | Links, active states, selection, focus |
| Accent/tint | `teal-700/10` | `teal-300/10` | Active segmented/tab/badge background |
| Accent/hover | `teal-800` #115e59 | `teal-200` #99f6e4 | Link/button hover |
| Ink (primary button) | `zinc-900` #18181b | `zinc-100` #f4f4f5 | Primary action background (white/zinc-900 text on top) |
| Status/success | `emerald-600` #059669 | `emerald-400` #34d399 | Completed, valid |
| Status/warning | `amber-600` #d97706 | `amber-400` #fbbf24 | Caution, medium quality |
| Status/error | `red-600` #dc2626 | `red-400` #f87171 | Errors, destructive |
| Status/info | `teal-700` (accent) | `teal-300` | Informational — reuse accent, no blue |

### Data-visualization palette (canvas/SVG sequence semantics — NOT chrome)

Alignment data colors stay semantic and unchanged in meaning: match `zinc`,
mismatch `red`, insertion `#3b82f6` (blue), deletion `purple`. These live inside
MSAViewer canvas / SVG schematics only and never leak into UI chrome.

### Rules
- **No gradients.** None. Not page backgrounds, not headers, not text, not buttons.
- **No indigo, no purple, no blue, no slate in chrome.** Those scales are gone. (`slate-*` → `zinc-*`).
- Accent teal is for interactive indication only (links, active, focus, selection). Never decorative.
- Status colors appear as dots + text, never as saturated filled pills.
- Dark mode: `.dark` class on `<html>`, Tailwind `dark:` variants.

## 3. Typography

### Font Stack (self-hosted via `@fontsource`, imported in `index.css`)
- Sans: `"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif` — weights 400/500/600/700.
- Mono: `"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace` — weights 400/500/600.
- No other families. No remote font URLs (desktop app must work offline).

### Scale

| Level | Class recipe | Usage |
|-------|--------------|-------|
| App wordmark | `text-lg font-semibold tracking-tight` | "Oligool" — plain text, never gradient-clipped |
| Panel title | `text-sm font-semibold` | Card/panel headers |
| Overline label | `text-[11px] font-medium uppercase tracking-wider text-zinc-500` | Section labels, legend titles |
| Body | `text-sm` | Default UI text |
| Body/sm | `text-xs` | Secondary text, table cells |
| Caption | `text-[11px]` | Hints, footers |
| Data | `font-mono text-xs tabular-nums` | Sequences, coordinates, counts, RID, e-values |

### Rules
- Sequence data, positions, accessions, bp counts, timers: always mono + `tabular-nums`.
- Numbers in data contexts use tabular figures.
- Headings are sentence case. Acronyms (BLAST, MSA, IDT, Tm, ΔG) stay uppercase.
- Body never below 12px except captions/hints (11px).

## 4. Spacing & Layout

Base-4 rhythm; existing layout structure is preserved (this is a restyle, not a re-layout).

| Token | Value | Usage |
|-------|-------|-------|
| space-2 | 8px | Inline groups, icon-label gap |
| space-3 | 12px | Control padding, toolbar gaps |
| space-4 | 16px | Card padding |
| space-5 | 20px | Panel header padding (x) |
| space-6 | 24px | Card separation, section gaps |
| space-8 | 32px | Page vertical rhythm |

- Max width unchanged: `max-w-7xl`, page padding `px-4 sm:px-6 lg:px-8`, `py-8`.
- Do not change grid/flex structures of working layouts — change surface/type/color only.

## 5. Components

Shared utilities live in `index.css` under `@layer components`. Use them; do not hand-roll.

### `.card`
`rounded-lg border border-zinc-200 dark:border-[#2e2e33] bg-white dark:bg-[#1b1b1f]` — no shadow.

### `.panel-header`
Flat `bg-zinc-50 dark:bg-[#222226]` strip with `border-b` + `px-5 py-3`, containing a
`text-sm font-semibold` title and optional eyebrow captions (`.eyebrow` class). Never gradient.

### `.btn` base
`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors
disabled:opacity-50 disabled:pointer-events-none`
- `.btn-primary`: ink — `border-transparent bg-zinc-900 text-white hover:bg-zinc-700
  dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300`.
- `.btn-secondary`: `border-zinc-300 dark:border-[#3a3a40] bg-white dark:bg-[#222226]
  text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-500`.
- `.btn-destructive`: like secondary but `text-red-600 dark:text-red-400` + red border/hover tint.
- Focus: `focus-visible:outline-2 focus-visible:outline-offset-2 outline-teal-700 dark:outline-teal-300`.

### `.input`
`w-full rounded-md border border-zinc-300 dark:border-[#3a3a40] bg-white dark:bg-[#222226]
text-sm px-3 py-2 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400
focus:border-teal-700 dark:focus:border-teal-300 focus:outline-none focus:ring-1
focus:ring-teal-700 dark:focus:ring-teal-300 disabled:opacity-50`

### Segmented control
Bordered group (`rounded-md border overflow-hidden flex`), segments `px-2.5 py-1 text-xs font-medium`;
active = `bg-teal-700/10 dark:bg-teal-300/10 text-teal-800 dark:text-teal-200`,
inactive = default surface + secondary text. Never solid accent fills.

### Status dot + text
`w-1.5 h-1.5 rounded-full` dot in status hue + `text-xs font-medium tabular-nums` label.
Replaces all rainbow pill badges (identity %, quality tiers).

### Modal
Overlay `bg-zinc-950/40` + `backdrop-blur-sm` (blur restored per user request — it improves
popup/background separation), panel `.card` + `shadow-xl` (the only place shadows live,
besides popovers/tooltips).

### Icon buttons
`p-2 rounded-md border border-transparent text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100
dark:hover:bg-[#26262b]` — SVG stroke consistent with existing set (heroicons outline, strokeWidth 2).

### Tooltips / popovers
`bg-zinc-900 text-zinc-100 dark:bg-zinc-700` small rounded-md text-xs shadow-lg border border-zinc-700/50.

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| Micro | 150ms | ease-out | Hovers, toggles |
| Standard | 250ms | ease-in-out | Panel expand/collapse, stepper |

- Animate `colors`, `transform`, `opacity` only. **Never** the global `* { transition }` selector.
- Spinners: `border-zinc-300 border-t-zinc-700 dark:border-zinc-600 dark:border-t-zinc-300` neutral.
- Every interactive element keeps hover + focus-visible + disabled states.
- Respect `prefers-reduced-motion`.

## 7. Depth & Surface

**Strategy: borders + tonal shift. Shadows are for floating layers only.**

| Level | Value | Usage |
|-------|-------|-------|
| Resting cards / panels | 1px `border/default`, zero shadow | Everything on the page |
| Floating (modal, popover, tooltip) | `shadow-xl` neutral | Overlays only |
| Skeleton / inset wells | `surface/inset` fill, no border | Loading placeholders |

- Depth hierarchy comes from page → primary → secondary → inset tonal steps, not elevation.
