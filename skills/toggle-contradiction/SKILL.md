---
name: toggle-contradiction
description: Turn the opt-in contradiction detector on or off. It is off by default and, when on, uses your own API key or a local model — this plugin never bills you.
disable-model-invocation: true
argument-hint: "on|off [byok|local] [model]"
allowed-tools: Bash
---

Toggle the context-health contradiction detector.

- `on` / `off` — enable or disable it (off by default).
- Optional judge backend: `byok` (your own Claude API key) or `local` (a local
  OpenAI-compatible model such as Ollama — no key, no cost), with an optional
  model name, e.g. `on local qwen2.5:0.5b` or `on local llama3.1`.

!`node "${CLAUDE_PLUGIN_ROOT}/bin/ch-config.js" contradiction $ARGUMENTS`

Relay the result above to the user in one short sentence. If they passed no
argument, tell them to run `/context-health:toggle-contradiction on` or `off`
(and mention they can append `local <model>` to use a local model).
