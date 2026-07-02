---
name: mute
description: Mute context-health warnings for the current session. The ambient context-fill indicator still shows; only the yellow/red condition alerts are silenced. Pass 'off' to unmute.
disable-model-invocation: true
argument-hint: "(nothing to mute; 'off' to unmute)"
allowed-tools: Bash
---

Mute (or unmute, if the argument is `off`) context-health warnings for the
current session.

!`node "${CLAUDE_PLUGIN_ROOT}/bin/ch-config.js" mute $ARGUMENTS`

Relay the result to the user.
