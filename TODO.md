# Oligool TODO

## Frontend / Visualization

- [ ] **Multi-stem hairpin SVG rendering**
  `HairpinSVG` currently renders only single unbranched stems. Dot-brackets with
  multiloops (e.g. `((((((...))))))(((...)))....`) fall back to plain
  sequence + dot-bracket text. Extend the renderer to draw multi-stem loops as
  an SVG diagram.
