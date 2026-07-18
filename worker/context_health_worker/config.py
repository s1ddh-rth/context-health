"""Config loader for the worker — mirrors bin/lib/config.js resolution so both
sides read the same thresholds. Later source wins:

  1. BUILT_IN_DEFAULTS (below)
  2. ${CLAUDE_PLUGIN_ROOT}/settings.json  (the plugin defaults)
  3. ~/.claude/context-health-config.json (user override; env-overridable)

Only the fields the worker needs are kept in the built-in defaults; unknown keys
from the files pass through untouched.
"""

import json
import os

BUILT_IN_DEFAULTS = {
    "enabled": True,
    "context": {"autocompactBufferTokens": 33000, "defaultWindowSize": 200000},
    "detectors": {
        "goalDrift": {
            "enabled": True,
            "rollingActivityTurns": 5,
            "maxActivityToolCalls": 10,
            "minTurnsBeforeFiring": 3,
            # Calibrated from eval/drift-pairs.json (eval_drift.py): on-goal floor
            # ~0.559, drifted mean ~0.450. yellow 0.55 = just under the on-goal
            # floor (0 FP, 93% recall); red 0.50 catches clear drift (0.45 was too
            # low to fire usefully).
            "cosineSimilarityYellow": 0.55,
            "cosineSimilarityRed": 0.50,
            "weakAnchorMinTokens": 12,
            "weakAnchorThresholdPenalty": 0.05,
        },
        "contradiction": {
            "enabled": False,  # opt-in
            "judge": "byok",
            "model": "claude-haiku-4-5",
            "minTurnsBetweenChecks": 3,  # throttle: it spends the user's tokens
        },
    },
    "worker": {"pollIntervalSeconds": 1.5, "embeddingModel": "BAAI/bge-small-en-v1.5"},
}


def _deep_merge(base, override):
    out = dict(base)
    if not isinstance(override, dict):
        return out
    for key, ov in override.items():
        if isinstance(ov, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], ov)
        elif isinstance(ov, dict):
            # deep-copy the subtree (parity with the Node loader) so callers
            # never alias the parsed override JSON
            out[key] = _deep_merge({}, ov)
        else:
            out[key] = ov
    return out


def _read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read()
    except OSError:
        return None
    start = raw.find("{")
    if start == -1:
        return None
    try:
        parsed = json.loads(raw[start:])
    except (ValueError, TypeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _plugin_settings_path():
    root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    if not root:
        # worker/context_health_worker/config.py -> plugin root is two levels up
        root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    return os.path.join(root, "settings.json")


def _user_override_path():
    env = os.environ.get("CONTEXT_HEALTH_CONFIG_FILE")
    if env:
        return env
    return os.path.join(os.path.expanduser("~"), ".claude", "context-health-config.json")


def load_config():
    import copy

    cfg = copy.deepcopy(BUILT_IN_DEFAULTS)
    plugin = _read_json(_plugin_settings_path())
    if plugin:
        cfg = _deep_merge(cfg, plugin)
    user = _read_json(_user_override_path())
    if user:
        cfg = _deep_merge(cfg, user)
    return cfg
