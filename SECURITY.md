# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for a security vulnerability. Instead, report
it privately via GitHub's [private security advisory](https://github.com/s1ddh-rth/context-health/security/advisories/new)
for this repository, or by contacting the maintainer through their GitHub profile
([@s1ddh-rth](https://github.com/s1ddh-rth)).

Please include what you can reproduce and the impact you observed. You'll get an
acknowledgement as soon as possible, and we'll work with you on a fix and
coordinated disclosure.

## Security model

This is a Claude Code plugin. Its hooks, statusline, and background monitor run
**unsandboxed, at the same trust level as your shell** — the same as any plugin you
install. Design choices that follow from that:

- **Local-first, zero network by default.** The default detectors run entirely
  locally. The embedding model downloads once on first use, after which the plugin
  is offline. No telemetry.
- **Untrusted input is never executed.** Transcript content and tool output are
  treated as data, never as instructions. The plugin writes only inside its own
  directory and the state file (`~/.claude/context-health-state.json`).
- **The opt-in contradiction detector** is off by default. When you enable it, it
  uses **your own** Claude API key (resolved by the official SDK from your existing
  credentials — nothing is pasted or stored by this plugin) or a local model. This
  plugin never transmits your data anywhere except, if you explicitly enable it, to
  the LLM endpoint you configured under your own account.
- **No secrets in the repo or state file.** The plugin does not read, store, or log
  API keys; credential resolution is delegated to the SDK / your environment.

## Scope

Because the plugin runs at your trust level, only install it (and review updates)
from a source you trust. Reports about the plugin executing untrusted input,
leaking the state file's contents off-machine, or mishandling credentials are in
scope and appreciated.
