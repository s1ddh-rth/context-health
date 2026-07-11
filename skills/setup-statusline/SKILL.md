---
name: setup-statusline
description: One-time setup — point Claude Code's statusline at the context-health signal. Wires a stable, update-proof path into your own ~/.claude/settings.json; never overwrites an existing custom statusline.
disable-model-invocation: true
allowed-tools: Bash
---

Wire the context-health statusline into the user's own Claude Code settings. This
is the one step a plugin cannot do automatically: Claude Code does not let a
plugin register a global statusline, so the plugin points the user's
`~/.claude/settings.json` at a stable, version-independent copy of the renderer
under the plugin's persistent data directory (which survives plugin updates).

Run:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/ch-config.js" setup-statusline "${CLAUDE_PLUGIN_DATA}" "${CLAUDE_PLUGIN_ROOT}"`

Then relay the command's output to the user. Notes:

- The command is additive and idempotent: it backs up `settings.json` first and
  is safe to run more than once.
- If it reports that a **custom** statusLine already exists, do NOT edit the
  user's settings yourself — show them the exact command line it printed and let
  them decide whether to switch.
- Remind the user that the statusline appears after a restart or a new session.
- To undo later, they can run the same script with `unsetup-statusline` instead
  of `setup-statusline`.
