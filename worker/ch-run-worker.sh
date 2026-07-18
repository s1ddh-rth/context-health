#!/bin/sh
# context-health worker launcher — find `uv` and start the warm drift worker.
#
# The monitor runs `uv run ...`. If `uv` is not on the (non-interactive) PATH the
# monitor dies with exit 127 and Claude Code reports "Monitor script failed",
# which looks broken. Per the plugin's design, goal-drift is OPTIONAL: when uv or
# the model is unavailable it should simply stay quiet while the zero-dependency
# detectors keep working. So we locate uv robustly and, if it is genuinely
# absent, idle quietly instead of erroring.
#
#   sh ch-run-worker.sh <worker-dir> [args...]

find_uv() {
  p=$(command -v uv 2>/dev/null) || p=''
  if [ -n "$p" ]; then
    printf '%s\n' "$p"
    return 0
  fi
  for c in \
    "$HOME/.local/bin/uv" \
    "$HOME/.cargo/bin/uv" \
    /opt/homebrew/bin/uv \
    /usr/local/bin/uv \
    /usr/bin/uv
  do
    if [ -x "$c" ]; then
      printf '%s\n' "$c"
      return 0
    fi
  done
  return 1
}

UV=$(find_uv) || UV=''
if [ -z "$UV" ]; then
  # No uv: goal-drift stays off (documented behavior). Idle instead of exiting hot
  # so the "when: always" monitor is not respawned in a tight loop; the session
  # ends this process, and a new session re-checks for uv.
  sleep 3600 2>/dev/null || true
  exit 0
fi

dir="$1"
shift 2>/dev/null || true
exec "$UV" run --directory "$dir" python -m context_health_worker.worker "$@"
