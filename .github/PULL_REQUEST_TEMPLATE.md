<!-- Thanks for contributing! Keep PRs focused; see CONTRIBUTING.md. -->

## What & why

<!-- What does this change, and why? Explain the reasoning, not just the diff. -->

## Checklist

- [ ] `node --test test/*.test.js` passes
- [ ] `cd worker && uv run pytest -q` passes
- [ ] `node eval/run-eval.js --check` is green
- [ ] Added/updated tests for new logic
- [ ] Hooks/statusline stay fast and defensive (no crash on bad input, exit 0)
- [ ] Commits are signed off (`git commit -s`, per the DCO in CONTRIBUTING.md)

## Evidence (for threshold / detector / science changes)

<!-- If you changed a threshold or a formula, include the eval numbers
     (run-eval.js / eval_drift.py) and cite the source that justifies it. -->
