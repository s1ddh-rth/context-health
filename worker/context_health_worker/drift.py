"""Goal-drift logic — pure functions, no embedding model.

The worker embeds the goal once and, each turn, embeds a rolling window of recent
activity; this module turns the resulting cosine similarity into a severity using
the (tunable) thresholds, and builds the activity string from session state.

Firing rule: drift fires when similarity < threshold (strict). It holds fire for
the first few turns so early exploration doesn't trip it. A weak goal anchor
lowers the thresholds (makes firing harder) to cut false alarms.
"""

import math

# Node truncates the captured goal to this many chars (bin/lib/session-signals.js
# MAX_GOAL_CHARS) while storing the full prompt in prompts[]. So for a very long
# first prompt, goalText is a *prefix* of prompts[0], not an exact match.
GOAL_TRUNCATION_LEN = 4000


def cosine_similarity(a, b):
    """Cosine similarity of two equal-length numeric sequences.

    Defensive: mismatched lengths or a zero-magnitude vector return 0.0 rather
    than raising or producing NaN.
    """
    if a is None or b is None:
        return 0.0
    if len(a) != len(b) or len(a) == 0:
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na == 0.0 or nb == 0.0:
        return 0.0
    denom = math.sqrt(na) * math.sqrt(nb)
    if denom == 0.0 or not math.isfinite(denom):
        return 0.0
    result = dot / denom
    # A NaN/inf component (should never come from FastEmbed, but honor the
    # contract) collapses to 0.0 rather than propagating.
    return result if math.isfinite(result) else 0.0


def evaluate_drift(similarity, turn_count, config, weak_anchor=False):
    """Map a cosine similarity to a drift severity.

    Returns a dict: {severity, similarity, reason, belowMinTurns, weakAnchor}.
    """
    cfg = config or {}
    min_turns = _num(cfg.get("minTurnsBeforeFiring"), 3)
    yellow = _num(cfg.get("cosineSimilarityYellow"), 0.60)
    red = _num(cfg.get("cosineSimilarityRed"), 0.45)
    penalty = _num(cfg.get("weakAnchorThresholdPenalty"), 0.05)

    if weak_anchor:
        yellow -= penalty
        red -= penalty

    below_min = turn_count is None or turn_count < min_turns
    if below_min:
        return {
            "severity": "green",
            "similarity": similarity,
            "reason": "on goal",
            "belowMinTurns": True,
            "weakAnchor": weak_anchor,
        }

    if similarity < red:
        severity = "red"
    elif similarity < yellow:
        severity = "yellow"
    else:
        severity = "green"

    if severity == "green":
        reason = "on goal"
    else:
        pct = round(similarity * 100)
        reason = f"drifting from goal ({pct}% similar)"

    return {
        "severity": severity,
        "similarity": similarity,
        "reason": reason,
        "belowMinTurns": False,
        "weakAnchor": weak_anchor,
    }


def build_activity_text(session, max_prompts=5, max_tools=10, exclude=None):
    """Combine the most recent prompts and tool calls into one activity string
    to embed and compare against the goal vector.

    `exclude` (typically the goal text) is filtered out so the goal-defining
    prompt — which lives in the prompts list — doesn't get compared against
    itself and inflate the similarity, masking real drift.
    """
    session = session or {}
    prompts = session.get("prompts") or []
    tool_calls = session.get("recentToolCalls") or []

    if exclude:
        ex = str(exclude)
        # Exact match normally; prefix match only when the goal was truncated
        # (a >4000-char first prompt), so we don't over-exclude legitimate
        # short on-goal prompts that merely start with the same words.
        truncated = len(ex) >= GOAL_TRUNCATION_LEN

        def _is_anchor(p):
            sp = str(p)
            return sp == ex or (truncated and sp.startswith(ex))

        prompts = [p for p in prompts if not _is_anchor(p)]

    recent_prompts = prompts[-max_prompts:] if max_prompts > 0 else []
    recent_tools = tool_calls[-max_tools:] if max_tools > 0 else []

    parts = []
    parts.extend(str(p) for p in recent_prompts)
    for c in recent_tools:
        if not isinstance(c, dict):
            continue
        name = str(c.get("name", ""))
        params = str(c.get("paramsKey", ""))
        parts.append((name + " " + params).strip())

    return " \n".join(p for p in parts if p).strip()


def _num(value, default):
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        return float(value)
    return default
