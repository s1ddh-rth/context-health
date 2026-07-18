#!/bin/sh
# context-health launcher — find a usable `node` and run a bundled script with it.
#
# Why this exists: Claude Code runs hook / statusline commands through a
# non-interactive shell (`/bin/sh -c` on macOS/Linux, PowerShell or Git Bash on
# Windows). That shell does NOT source ~/.bashrc / ~/.zshrc / nvm / fnm, so a
# `node` that is on the user's *interactive* PATH is often missing at hook time
# (the classic `/bin/sh: node: command not found`, exit 127). And the native
# Claude Code installer ships no `node` at all. So we:
#   1. locate node from PATH, then from common version-manager / install prefixes;
#   2. if node truly cannot be found, exit 0 SILENTLY so the plugin degrades
#      quietly instead of spamming exit-127 errors on every turn.
#
# Invoked via `sh` (not a shebang) so it works regardless of the exec bit and
# regardless of which shell the host used to launch it.
#
#   sh ch-run.sh <script.js> [args...]              # hook mode: silent if no node
#   sh ch-run.sh --statusline <script.js> [args...] # statusline: prints a hint

statusline=0
if [ "${1:-}" = "--statusline" ]; then
  statusline=1
  shift
fi

find_node() {
  # 1. Already resolvable on PATH.
  for n in node nodejs; do
    p=$(command -v "$n" 2>/dev/null) || p=''
    if [ -n "$p" ]; then
      printf '%s\n' "$p"
      return 0
    fi
  done
  # 2. Common version managers and install prefixes not on the hook PATH.
  #    (First executable match wins — sufficient for a fallback.)
  for c in \
    "$HOME/.volta/bin/node" \
    "$HOME/.local/share/fnm/node-versions"/*/installation/bin/node \
    "$HOME/.fnm/node-versions"/*/installation/bin/node \
    "$HOME/.nvm/versions/node"/*/bin/node \
    "$HOME/.asdf/installs/nodejs"/*/bin/node \
    "$HOME/n/bin/node" \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /usr/bin/node \
    /snap/bin/node
  do
    if [ -x "$c" ]; then
      printf '%s\n' "$c"
      return 0
    fi
  done
  return 1
}

NODE=$(find_node) || NODE=''
if [ -z "$NODE" ]; then
  # No node anywhere. Hooks stay silent; the statusline shows one actionable hint
  # (its stdout IS the statusline text — the ideal place for a persistent notice).
  if [ "$statusline" -eq 1 ]; then
    printf '\342\227\214 ctx-health: Node not found (install Node >=18)'
  fi
  exit 0
fi

exec "$NODE" "$@"
