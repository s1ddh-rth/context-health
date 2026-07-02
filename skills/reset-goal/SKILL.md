---
name: reset-goal
description: Reset the captured goal for the current session so goal-drift re-anchors. Use after you intentionally change what you are working on.
disable-model-invocation: true
allowed-tools: Bash
---

Clear the goal anchor for the current session. The next prompt becomes the new goal.

!`node "${CLAUDE_PLUGIN_ROOT}/bin/ch-config.js" reset-goal`

Relay the result and remind the user that their next message will be captured as
the new goal.
