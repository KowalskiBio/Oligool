# Oligool TODO

## Frontend / Visualization

- [ ] **Multi-stem hairpin SVG rendering**
  `HairpinSVG` currently renders only single unbranched stems. Dot-brackets with
  multiloops (e.g. `((((((...))))))(((...)))....`) fall back to plain
  sequence + dot-bracket text. Extend the renderer to draw multi-stem loops as
  an SVG diagram.

## Bugs

- [ ] **MOLigos "teleport" when dragged in the Context Viewer (MOLigo Provenance)**
  Diagnosed in `frontend/src/components/QueryViewer.tsx`. Two causes compound:

  **Cause 1: drag distance is measured in straight horizontal pixels, but the
  text wraps.** The context sequence renders as wrapped lines of 120 chars
  (`seqLineLength = 120`, L149, L1438, never changed), while the drag delta is
  `deltaX = e.clientX - startX` converted with `Math.round(deltaX / charWidth)`
  (L1084-1085). This is only correct within one visual line. When a move crosses
  a wrap: (a) if the user sweeps the cursor back to the next line's left edge,
  `clientX` collapses by ~120 chars of pixels in one event, so `deltaChars`
  jumps by ~120-240 bp instantly; (b) if the user keeps dragging straight right,
  the oligo flows onto the next line (a visual jump in itself) and the release
  position overshoots what the eye was tracking. Explains the "sometimes":
  short drags within a line feel fine, longer ones teleport.

  **Cause 2: mouse-up commit anchors to a stale context, not the current view.**
  Live preview uses current-space positions (`primers.start/end + offset`,
  L1177-1191), but the commit reads `fixedContextRef.current` (`fc`) and uses
  its old `offset`/`fullSeq`/`gappedSeq`/`start` (L1093-1108). Two reset paths
  null `fixedAbsCoords` without clearing `fixedContextRef`: the region-change
  effect (L218-225) and the new-BLAST effect (L584-591). Dragging in that state
  looks normal until release, when the commit converts through the stale
  context, writes `fixedAbsCoords` against it, and the view snaps into the old
  frame. Contributing smell: `dragState.initShift1/initShift2/initLen` are
  captured at mouse-down (L1075-1077) but never used by the commit, so any
  state change mid-drag shifts the landing spot.

  Potential fixes:
  1. Measure displacement in flow characters instead of pixels: tag each char
     span with a linear index (`data-idx={i}`, spans already have `key={i}`),
     and on `mousemove` resolve
     `document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-idx]')`.
     Delta = hovered index minus anchor index. Wrap-proof and scroll-proof.
  2. Make the commit base identical to the preview base: use the current
     `offsetRef.current` when `fixedAbsCoords` is null (do not fall back to a
     stale `fc`), and set `fixedContextRef.current = null` alongside
     `setFixedAbsCoords(null)` in both reset effects (L218-225, L584-591).
  3. Clamp the live preview to `[0, fullSeq.length]` the same way the commit
     does (L1124-1125), so releasing near the edges does not snap.
