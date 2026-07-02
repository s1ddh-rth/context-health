---
name: toggle-contradiction
description: Turn the opt-in contradiction detector on or off. It is off by default and, when on, uses your own API key or a local model — this plugin never bills you.
disable-model-invocation: true
argument-hint: "on|off"
allowed-tools: Bash
---

Toggle the context-health contradiction detector.

!`node "${CLAUDE_PLUGIN_ROOT}/bin/ch-config.js" contradiction $ARGUMENTS`

Relay the result above to the user in one short sentence. If they passed no
argument, tell them to run `/context-health:toggle-contradiction on` or `off`.
