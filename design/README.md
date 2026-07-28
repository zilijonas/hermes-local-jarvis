# Design artifacts — Jarvis Command Centre redesign (2026-07-28)

Source: claude.ai/design project `e173e490-2b4d-4116-b37f-f33f255161ad`
("Jarvis Command Centre redesign", owner Linas Jonas). Pulled via DesignSync.

- `Jarvis Command Centre.dc.html` — interactive prototype (dc-runtime format:
  `<x-dc>` template + `data-dc-script` Component class holding the real design
  logic — state machine, canvas core renderer, panel layouts, simulated feed).
- `support.js` — dc-runtime (template engine). Reference only, NOT ported.
- The companion "Jarvis Redesign Spec.dc.html" (same project) is the binding
  implementation plan; its key content is mirrored in the fable build prompt:
  tokens (§4), 15-state motion matrix (§5), file-by-file plan (§6),
  perf budget (§7), a11y (§8), open items (§9).

Design direction B — "anchored core, flanked context":
system bar · Memory column · Stage (core ≈45% + conversation log + composer)
· Work/Activity/System tabs. Breakpoints: ≥1280 three columns; 860–1279 memory
folds into tabs; <860 single column + bottom sheets. 2D-canvas fibonacci
lattice core replaces three.js (~430 KB bundle savings).
