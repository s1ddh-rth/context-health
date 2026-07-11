# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.4] - 2026-07-11

### Fixed
- **Statusline install actually works now.** The old README told users to add a
  `statusLine` pointing at `${CLAUDE_PLUGIN_ROOT}/statusline/statusline.js` — but
  Claude Code does **not** expand `${CLAUDE_PLUGIN_ROOT}` in a user's own
  `settings.json`, and a plugin cannot auto-register a global statusline at all
  (only `agent`/`subagentStatusLine` are honored). That instruction was broken on
  first install. The plugin's own `settings.json` `statusLine` block (also inert)
  is replaced with a `$statusLineNote` explaining the constraint.

### Added
- **`/context-health:setup-statusline` skill + self-healing renderer copy.** A
  one-time command wires the statusline into the user's `~/.claude/settings.json`,
  pointing at a stable, version-independent copy of the renderer under
  `${CLAUDE_PLUGIN_DATA}/current/` (documented to survive plugin updates, so the
  wiring never rots on the next release). A new async `SessionStart` hook
  (`materialize-statusline.js`) refreshes that copy on every version change; the
  common path is a single stamp compare. The settings write is additive, backs up
  first, is idempotent, and refuses to overwrite a foreign statusline. New
  `bin/lib/statusline-wiring.js` + `test/statusline-wiring.test.js` (the launcher
  smoke test runs standalone with no plugin env vars, on Windows and Ubuntu CI).

## [0.1.3] - 2026-07-09

### Fixed
- **Goal-drift grace period survives `/reset-goal`.** The `minTurnsBeforeFiring`
  window is now measured from when the goal was set (`goalSetTurn`), not from
  session start — so resetting the goal on a long session gets a fresh grace
  window instead of being able to fire red on the very next turn.
- **Each stored prompt is length-capped (4000 chars).** Previously only the prompt
  *count* was bounded; a large pasted diff/log could bloat the shared state file
  that every hook read-modify-writes (and inflate the opt-in judge's token cost).
- **Contradiction judge `reason` is sanitized** (control/ANSI/newline stripped)
  before it is persisted and rendered — closing a terminal-escape-injection
  surface on the untrusted judge output. The statusline renderer also strips
  control characters from any reason defensively.
- **`context-math`: buffer ≥ window no longer yields absurd percentages.** A
  degenerate/misreported buffer now falls back to the full window instead of
  producing e.g. 1,000,000%.
- **`confusion` internal fallback window corrected 10 → 20** to match the shipped,
  quantization-safe default (a lone error no longer implies a 0.10 rate).
- **`isErrorOutput` no longer treats `{error: "0"}` (string zero) as an error.**

### Added
- **GitHub Actions CI**: JS tests + structural eval (`--check`) on ubuntu &
  windows, Python worker tests on ubuntu.
- `package.json` `repository`/`author`/`homepage`/`bugs`/`engines` metadata.

## [0.1.2] - 2026-07-08

### Fixed
- **Statusline now shows the remediation tip inline.** The per-condition remedy was
  computed but never rendered — the statusline only named the condition. Yellow/red
  now read e.g. `● goal drift: … → restate your goal and re-anchor`, dimmed.
- **Distraction detector now catches real Bash command loops.** The repetition
  signature included the tool call's cosmetic `description`, which the agent
  regenerates on every call — so identical repeated commands looked unique and the
  detector never fired. Cosmetic fields (`description`) are now stripped from the
  signature; a repeated command trips distraction as intended (verified live).

### Added
- One-command local judge: `/context-health:toggle-contradiction on local [model]`
  sets the contradiction judge to a local OpenAI-compatible model (e.g. Ollama) — no
  more hand-editing config. BYOK remains the default.

### Changed
- Docs: reconciled the README goal-drift thresholds to the shipped/calibrated
  **0.55/0.50** (a stale 0.60/0.45 reference remained); softened the agent-drift
  citation to note it's an early single-author preprint; clarified that the "40–70%"
  degradation range is a cross-study generalization, not a single benchmarked figure;
  added local-judge capability guidance (a tiny model false-alarms — verified
  end-to-end against a real local model — so pick a capable judge).

## [0.1.1] - 2026-07-07

### Changed
- Calibrated goal-drift thresholds to **yellow 0.55 / red 0.50** (from 0.60/0.45),
  grounded in the measured cosine distribution of the labeled corpus (on-goal floor
  ~0.559) and verified against the bge-small model card.
- Widened the confusion error-rate window to **20 calls** so the 0.05/0.10
  thresholds are meaningful (a 10-call window made a single error trip yellow).
- Replaced the alert phrases with evidence-based remediation tips (sourced to the
  context-engineering literature).

### Added
- `docs/METHODOLOGY.md` — per-detector what/how/why with verified sources.
- `LICENSE` (MIT), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and
  issue/PR templates.

## [0.1.0]

Initial working plugin — phases 1–3.

### Added
- **Phase 1 — plumbing + free wins.** Plugin scaffold, shared state file, and a Node
  statusline with buffer-corrected context math, plus the distraction and confusion
  detectors. Zero dependencies, zero API cost.
- **Phase 2 — goal-drift.** A warm background worker (Python via `uv`) that keeps a
  local FastEmbed model loaded and computes goal-drift out of band; wired into the
  statusline and a background-monitor alert. Node↔Python share one state file behind
  a cross-process lock.
- **Phase 3 — rigor + the opt-in detector.** An eval harness (labeled corpus,
  precision/recall/FPR metrics, threshold calibration), plain-language config slash
  commands, and the opt-in **contradiction** detector (LLM judge on the user's own
  key or a local model — off by default, never billed).

### Notes
- Detects four conditions: distraction, confusion, goal-drift, and contradiction.
  The original clash and poisoning modes were merged into one contradiction detector
  after research showed they collapse to the same local computation.
- Fully open-source; no paid tier.

[Unreleased]: https://github.com/s1ddh-rth/context-health/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/s1ddh-rth/context-health/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/s1ddh-rth/context-health/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/s1ddh-rth/context-health/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/s1ddh-rth/context-health/releases/tag/v0.1.0
