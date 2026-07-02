---
name: status
description: Show the current context-health settings — which detectors are on and their thresholds.
disable-model-invocation: true
allowed-tools: Bash
---

Show the current context-health configuration.

!`node "${CLAUDE_PLUGIN_ROOT}/bin/ch-config.js" show`

Present the settings above to the user clearly.
