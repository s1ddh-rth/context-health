# Contributing to Context Health

Thanks for your interest — this project is small, local-first, and evidence-driven,
and contributions are welcome. This guide covers how to set up, test, and submit
changes.

By participating you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug** or a false alarm — open an issue with the failing input and what
  you expected. False positives matter here: this tool optimizes *precision over
  recall*, so a detector crying wolf is a first-class bug.
- **Improve a detector's accuracy** — the highest-value contribution is a better
  labeled corpus (`eval/`) so thresholds can be calibrated on real data rather than
  a small synthetic set. See [Evals](#evals).
- **Add remediation guidance** — the alert phrases are evidence-based; propose a
  better one *with a source*.
- **Docs, packaging, platform fixes** (esp. Windows / Git Bash quirks).

## Project layout & principles

- It's a **plugin**, not an MCP server: hooks + statusline + a background monitor.
- **Node** for the fast glue (hooks, statusline, config CLI) — zero dependencies,
  native JSON. **Python** (managed by `uv`) for the warm worker that owns the
  embedding model. The two share one JSON state file; they never call each other.
- **Nothing heavy runs in a hook or the statusline.** They do sub-millisecond work
  over small bounded arrays; the model and all expensive computation live in the
  worker.
- **Thresholds are config, never hard-coded.** They live in `settings.json` and are
  provisional until the eval harness calibrates them — cite evidence when changing
  one.

## Development setup

Prerequisites: **Node** (bundled with Claude Code) and [`uv`](https://docs.astral.sh/uv/)
for the Python worker.

```bash
git clone <your-fork>
cd context-health

# Node side has no dependencies to install.
# Python worker (isolated venv, created/managed by uv):
cd worker && uv sync --extra dev && cd ..
```

## Running the tests

Every change must keep both suites and the eval gate green:

```bash
node --test test/*.test.js          # Node unit + integration
cd worker && uv run pytest -q       # Python worker
node eval/run-eval.js --check       # eval gate: exits non-zero on any mismatch
```

Test scripts the way Claude Code invokes them — pipe a fixture on stdin:

```bash
node statusline/statusline.js < fixtures/statusline-healthy.json
node bin/hooks/pre-tool-use.js  < fixtures/hook-pre-tool.json
```

### Evals

`eval/run-eval.js` scores a labeled fixture corpus through the *production*
detectors and reports per-detector precision / recall / false-positive rate.
`worker/eval_drift.py` calibrates the goal-drift thresholds against labeled
on-goal/drifted pairs using the real model. If you change a detector or a
threshold, run these and include the numbers in your PR.

## Coding conventions

- Match the surrounding style; keep hooks and the statusline **fast and defensive**
  (bad input → fallback text, never a crash; always exit 0).
- Write only clean JSON/text to stdout from hooks and the statusline (guard against
  shell-rc echo pollution).
- Add tests for new logic. Pure logic lives in `bin/lib/` and
  `worker/context_health_worker/` and should be unit-tested.
- Treat transcript and tool output as untrusted text — never execute it; write only
  inside the plugin dir and the state file.

## Commits & the DCO

- Keep commit messages clear and imperative; explain the *why*, not just the *what*.
- We use the **Developer Certificate of Origin** ([developercertificate.org](https://developercertificate.org/))
  rather than a CLA. Sign off each commit to certify you wrote the code (or have the
  right to submit it) under the project's MIT license:

  ```bash
  git commit -s -m "your message"
  ```

  This adds a `Signed-off-by: Your Name <you@example.com>` trailer.
- **AI-assisted contributions are welcome and should be disclosed.** If a tool
  helped write the change, add a `Co-Authored-By:` trailer for it. You still own and
  are responsible for the contribution and its DCO sign-off.

## Pull requests

1. Branch from `main`; keep PRs focused.
2. Ensure both test suites and the eval `--check` are green, and include eval
   numbers for detector/threshold changes.
3. Describe the change and its evidence. For anything touching thresholds or the
   science, cite a source — claims in this project are asserted with evidence.
4. Be patient — this is a small project; reviews may take a little time.

Questions? Open an issue. Thank you for contributing.
