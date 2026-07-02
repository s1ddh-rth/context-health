---
name: set-threshold
description: Tune a context-health detector threshold in plain language, e.g. make goal-drift less sensitive. Writes to your user override config; never edits plugin files.
disable-model-invocation: true
argument-hint: "<detector> <key> <value>"
allowed-tools: Bash
---

Set a detector threshold. The user may phrase this loosely (e.g. "make goal drift
less sensitive"); map it to `<detector> <key> <value>` where detector is one of
distraction, confusion, goalDrift; common keys are:

- goalDrift: `cosineSimilarityYellow`, `cosineSimilarityRed` (lower = less sensitive)
- distraction: `repetitionRateYellow`, `repetitionRateRed`, `contextFillYellow`, `contextFillRed`
- confusion: `activeToolYellow`, `toolErrorRateYellow`, `toolErrorRateRed`

If the arguments are already in `<detector> <key> <value>` form, apply them directly:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/ch-config.js" threshold $ARGUMENTS`

If the request was ambiguous, ask which detector/key/value they mean before
running, then re-run the command above with the resolved values. Confirm the
change and note it takes effect on the next config read.
