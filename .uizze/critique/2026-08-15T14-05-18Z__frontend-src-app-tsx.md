---
target: frontend/src/App.tsx
total_score: 24
p0_count: 0
p1_count: 2
timestamp: 2026-08-15T14-05-18Z
slug: frontend-src-app-tsx
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Stepper shows progress; RID/time displayed. But search button just disables during async, no spinner on the button itself. |
| 2 | Match System / Real World | 3 | Domain language (BLAST, MSA, E-value, Tm) correct for audience. Czech What's New copy appropriate. |
| 3 | User Control and Freedom | 3 | Edit Search, Start Over, Save/Load session. Escape closes modals. No undo for destructive actions. |
| 4 | Consistency and Standards | 3 | Shared .btn-* and .icon-btn classes from index.css. But 4 buttons use inline classes (maxHits segmented, filter Yes/No, search) instead of shared component classes. |
| 5 | Error Prevention | 2 | Search disabled when no input (good). But "Start Over" has no confirmation dialog before wiping all state. Settings passwords have show/hide toggle (good). |
| 6 | Recognition Rather Than Recall | 2 | Labels visible. But settings panel is open by default showing 7 credential fields. No contextual help on controls (tooltips only on some buttons). |
| 7 | Flexibility and Efficiency of Use | 2 | No keyboard shortcuts. No bulk actions. Tab navigation works but no accelerators for expert users. |
| 8 | Aesthetic and Minimalist Design | 3 | Mostly clean, flat, on-brand. But settings expanded by default adds clutter above the fold. Footer has decorative Kowalski image. Main input card is 639px tall. |
| 9 | Error Recovery | 2 | Messages are clear ("Nothing to save yet. Run a search first.") but don't guide the user to the next action. No inline validation on form fields. |
| 10 | Help and Documentation | 1 | What's New modal serves as changelog only. No contextual help, no tooltips on most controls, no documentation link. |
| **Total** | | **24/40** | **Acceptable — significant improvements needed before users are happy** |

## Anti-Patterns Verdict

**Does this look AI-generated?** No. This is the strongest aspect of the current design.

**LLM assessment**: The aesthetic is distinctive and purposeful. The lab-instrument metaphor (zinc neutrals, single teal accent, IBM Plex typography, flat panels, hairline borders) reads as a deliberate design system, not AI-generated output. No gradients, no glassmorphism, no identical card grids, no hero-metric template, no side-stripe borders, no eyebrow-on-every-section, no numbered section markers, no em-dashes (after the de-slop pass), no buzzwords. The body background is clean near-white (oklch 0.967 0.001) — not the cream/sand AI default. The color strategy is "Restrained" (tinted neutrals + one accent) which fits the product register.

One residual tell: the settings panel open by default with 7 credential fields reads as "AI dumped all config options at once" rather than progressive disclosure. But this is an IA issue, not an aesthetic slop tell.

**Deterministic scan**: detect.mjs found 5 "gray-on-color" warnings at lines 783, 974, 983. **All 5 are false positives** — the detector parsed conditional template literal class strings and incorrectly paired classes from different branches:
- Line 783: Active step indicator. Detector reports "text-zinc-900 on bg-teal-700" but `text-zinc-900` is the dark-mode variant paired with `bg-teal-300`, not `bg-teal-700`. Light mode uses `text-white on bg-teal-700` (correct contrast).
- Lines 974, 983: Yes/No segmented buttons. Detector reports "text-zinc-600 on bg-teal-700" but `text-zinc-600` is on `bg-white` (inactive branch), while `bg-teal-700/10` pairs with `text-teal-800` (active branch). Different conditional branches.

**Browser visualization**: Chromium headless screenshots captured (default state, settings-open state, dark mode). Live DOM inspection confirmed: body background is `oklch(0.967 0.001 286.375)` (clean near-white), H1 uses IBM Plex Sans 18px 600, header computed position is `static` (sticky not working in practice).

## Overall Impression

The de-slop was successful aesthetically — the app looks like a precision lab instrument, not AI-generated SaaS. But the information architecture hasn't kept up with the visual polish. The settings panel is expanded by default, dumping 7 credential fields above the fold before the user can start their actual task. The main input card is 639px tall with 9 fields in one block. The biggest opportunity: collapse settings by default and use progressive disclosure to reduce cognitive load on first contact.

## What's Working

1. **Color discipline.** Zinc + teal, no gradients, no decorative color. The teal accent appears only on interactive elements (links, active states, focus rings) per DESIGN.md. Status colors are dots + text, not saturated pills. This is genuinely well-executed restraint.
2. **Typography hierarchy.** IBM Plex Sans/Mono with clear scale: text-lg for wordmark, text-sm for panel titles, text-[11px] for overline labels, font-mono tabular-nums for data (RID, lengths, e-values). The mono/tabular treatment of sequence data is correct and functional.
3. **Shared component system.** The `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-destructive`, `.icon-btn`, `.card`, `.panel-header` classes in index.css create one vocabulary. Most buttons use them. Focus-visible rings are defined once and inherited.

## Priority Issues

### [P1] Settings panel open by default dumps 7 credential fields above the fold
- **What**: `showSettings` initializes to `true` when no NCBI API key is stored (`useState(!localStorage.getItem('ncbi_api_key'))`). First-time users see NCBI Key, IDT Client ID, IDT Secret, IDT User, IDT Pass, IDT Region, and Search engine before they can paste a sequence.
- **Why it matters**: The primary task is "paste sequence, search, align." Credentials are secondary configuration. Showing them first inverts the task priority and adds 7 fields of cognitive load before the user can act. First impression is "config form" not "tool."
- **Fix**: Default `showSettings` to `false`. Auto-open settings only if a search is attempted without credentials and the backend requires them. Add a subtle "Configure credentials" hint near the search button if keys are missing.
- **Suggested command**: `layout` (restructure the information hierarchy)

### [P1] Header sticky positioning not working in practice
- **What**: The header is wrapped in `sticky top-0 z-40` but the browser computes `position: static`. When settings is expanded, the sticky wrapper's height grows and the sticky behavior breaks.
- **Why it matters**: DESIGN.md principle "Pinned context, scrolling data" requires the header to stay visible while results scroll. If the header doesn't stick, users lose context (step indicator, job name, action buttons) when scrolling through long alignments.
- **Fix**: Move the `sticky top-0 z-40` from the wrapper div to the header element itself. Don't include the settings panel in the sticky context — let it scroll independently below the header.
- **Suggested command**: `layout`

### [P2] Max hits segmented control shows 7 options
- **What**: The max hits selector offers All, 1000, 500, 100, 50, 10, and # (custom) as a horizontal segmented control with 7 buttons.
- **Why it matters**: Exceeds the 4-item working memory limit. Users must scan all 7 to find their preferred value. The horizontal layout will overflow on narrow viewports.
- **Fix**: Replace with a dropdown/select for the preset values, or reduce to 3-4 most common presets (50, 500, All, Custom) and move the rest into a dropdown.
- **Suggested command**: `layout`

### [P2] "Start Over" has no confirmation before destroying all state
- **What**: The "Start Over" button at line 1117 calls `handleReset` directly with no confirmation dialog. It wipes input, results, alignment, primers, and saved positions.
- **Why it matters**: A misclick destroys an entire session of work (BLAST search, alignment, primer picks). There is Save/Load, but users don't always save before resetting.
- **Fix**: Add a confirmation dialog (like the existing "Restore session?" pattern) before executing `handleReset`.
- **Suggested command**: `harden`

### [P2] No keyboard shortcuts or accelerators
- **What**: No keyboard shortcuts exist for any action (search, align, save, toggle settings, navigate steps). Tab navigation works but there are no expert accelerators.
- **Why it matters**: The target user (molecular biologist in long focused sessions) repeats the same workflow many times. Every click costs time. Expert users expect Ctrl+Enter to search, Esc to close modals (works), arrow keys to navigate hits.
- **Fix**: Add keyboard shortcuts for primary actions: Ctrl+Enter to submit search, Ctrl+S to save session, `?` to toggle settings, arrow keys to navigate BLAST hits.
- **Suggested command**: `harden`

## Persona Red Flags

### Alex (Power User)
- No keyboard shortcuts for any action. Every operation requires mouse clicks.
- Settings panel forces scrolling past 7 credential fields to reach the sequence input.
- Max hits selector has 7 options — Alex wants to type a number, not scan 7 buttons.
- No way to skip the stepper animation (250ms per step).
- Can save/load sessions (good), but no session history or recent items list.

### Sam (Accessibility-Dependent User)
- Focus-visible rings present on all .btn-* buttons (good), but 4 inline buttons (maxHits, filter Yes/No, search) only got focus-visible in the latest de-slop pass — verify they render correctly.
- Settings panel has no `<fieldset>`/`<legend>` grouping for the NCBI and IDT credential groups. Screen reader users hear 7 unrelated fields with no structure.
- Step indicator active state uses color (teal) + checkmark icon — good, not color alone.
- Password fields have show/hide toggle — good. But labels say "NCBI Key" and "IDT Secret" which may be ambiguous for screen readers without `aria-describedby`.
- Decorative images (rabbit, titmouse, Kowalski) have alt text but are positioned absolutely — may interfere with screen reader flow.

### Riley (Stress Tester)
- "Start Over" button destroys all state with no confirmation — Riley will accidentally trigger this.
- Refresh mid-search: no indication of how to resume a BLAST search (RID is shown but there's no "resume RID" input).
- Empty state when BLAST returns 0 hits: unclear if handled with guidance or just shows nothing.
- Long sequence input: no character limit or warning for very large pastes.
- What happens if the IDT API is down? No error handling visible for IDT failures during QC.

## Minor Observations

- Footer decorative images (rabbit, titmouse, Kowalski) don't carry information. DESIGN.md says "zero decoration that doesn't carry information." These are pre-existing brand mascots, so arguably voice, but they conflict with the stated principle.
- The `→` arrow in "BLAST Search → Multiple Sequence Alignment" subtitle is a Unicode arrow, which is fine, but the subtitle itself repeats information the stepper already shows.
- The What's New modal version badge uses `font-bold` while DESIGN.md's typography section doesn't define a bold weight for badges — minor inconsistency.
- The `text-zinc-700 dark:text-zinc-300` used for values inside the results summary (RID, Len, Hits, Time) is not in DESIGN.md's color table. It falls between primary (zinc-900) and secondary (zinc-500) text. Should be one or the other.
- Session restore modal uses `border-zinc-100` dividers — wait, these were fixed to `border-zinc-200` in the de-slop pass. Good.

## Questions to Consider

1. The settings panel and search form are both visible at once on first load. What if credentials were collected inline at the moment they're needed (first search attempts without a key), rather than in a panel that must be dismissed?
2. The app has one long scrolling page with no navigation. As features grow (MOLigo design, flanking primers, structural analysis, PDF reports), will this scale? Is there a point where tabs or views would reduce cognitive load better than a single scroll?
3. The stepper (Input → BLAST → MSA → Results) implies a linear flow, but the user can jump back to "Edit Search" from the done state. Would non-linear navigation (clickable stepper steps) serve expert users better?

## Run Notes
- Target slug: `frontend-src-app-tsx`
- Ignore list: none (no .uizze/critique/ignore.md)
- Assessment independence: degraded (oracle sub-agent launched but did not complete within 15 minutes; Assessment A conducted by orchestrator based on full source code review + DOM inspection)
- CLI detector: ran successfully, 5 findings, all false positives (conditional template literal parsing)
- Browser visibility: chromium headless screenshots captured (default, settings, dark mode). DOM structure extracted via Playwright evaluate.
- Overlay injection: not attempted (no live server started for critique)
- Live server cleanup: n/a (no server started)
- Temp-file cleanup: will clean up after persistence
