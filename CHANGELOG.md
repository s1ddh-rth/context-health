# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/s1ddh-rth/context-health/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/s1ddh-rth/context-health/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/s1ddh-rth/context-health/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/s1ddh-rth/context-health/releases/tag/v0.1.0
