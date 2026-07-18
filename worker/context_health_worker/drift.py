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
    yellow = _num(cfg.get("cosineSimilarityYellow"), 0.55)
    red = _num(cfg.get("cosineSimilarityRed"), 0.50)
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


# --- Shadow-mode drift signal (Phase-3 candidate; logged, does NOT drive the UI) ---
#
# Research (2024-2026, two deep reviews) converged: an absolute cosine cutoff is
# indefensible (anisotropy/mean-bias — Steck WWW-2024, mean-bias arXiv 2511.11041),
# anchor-to-goal cosine misses subtle in-domain drift, and short streams (<20 turns)
# rule out ADWIN/BOCPD/online-MMD (they need a large stationary reference). The
# candidate is a COMPOSITE fired only on agreement + persistence:
#   * semantic — per-turn cos(goal, user_turn), scored as a one-sided robust
#     modified z-score (median/MAD, finite-sample scale) vs THIS session's on-goal
#     baseline, with an absolute floor for cold-start;
#   * lexical  — drop in goal-keyword overlap (an anisotropy-immune precision gate);
#   * persistence — N consecutive hits before firing.
# All pure + tunable (settings.json goalDrift.shadow). Representation change that
# matters most: compare the goal to individual USER turns, never a pooled blob of
# prompts + tool-call strings (that dilutes intent — arXiv 2603.21437).

import re as _re

_STOPWORDS = frozenset(
    "a an the of to in on for and or but with without into onto from by at as is are be this that these "
    "those it its your my our their we you they add fix make build create update change use using do does "
    "can could should would will just also please help need want let set get put run code".split()
)

# Finite-sample MAD scale constants Cn (Park-Kim-Wang 2020, via Akinshin) so MAD
# estimates sigma without the asymptotic 1.4826 under-estimating it at small n
# (which would inflate false positives — the wrong direction for precision-first).
_MAD_C = {3: 2.205, 4: 2.017, 5: 1.804, 6: 1.764, 7: 1.687, 8: 1.672, 9: 1.643, 10: 1.625}
_MAD_C_INF = 1.4826


def _median(xs):
    s = sorted(xs)
    n = len(s)
    if n == 0:
        return 0.0
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2.0


def _mad_scale_constant(n):
    return _MAD_C_INF if n >= 11 else _MAD_C.get(n, _MAD_C_INF)


def robust_modified_zscore_drop(baseline, x):
    """One-sided modified z-score: how far x sits BELOW the baseline sample, using
    median + MAD with a finite-sample scale constant. Returns a non-negative drop
    (0 when x >= median), or None when the baseline is too small (n<3) or degenerate
    (MAD==0, e.g. tied early values — the caller falls back to the absolute floor)."""
    vals = [v for v in (baseline or []) if isinstance(v, (int, float)) and not isinstance(v, bool)]
    n = len(vals)
    if n < 3:
        return None
    med = _median(vals)
    mad = _median([abs(v - med) for v in vals])
    scale = _mad_scale_constant(n) * mad
    if scale <= 0:
        return None
    z = (med - x) / scale
    return z if z > 0 else 0.0


def extract_goal_keywords(goal_text, max_keywords=12):
    """Salient lowercase tokens from the goal for an anisotropy-immune lexical gate:
    words >=3 chars that aren't stopwords, plus likely identifiers (camelCase, or a
    token with a digit/underscore). Deterministic (first-occurrence order)."""
    if not goal_text:
        return frozenset()
    out, seen = [], set()
    for t in _re.findall(r"[A-Za-z0-9_]+", str(goal_text)):
        tl = t.lower()
        if tl in seen:
            continue
        ident = any(c.isdigit() for c in t) or "_" in t or (t[:1].islower() and any(c.isupper() for c in t[1:]))
        if ident or (len(tl) >= 3 and tl not in _STOPWORDS):
            out.append(tl)
            seen.add(tl)
        if len(out) >= max_keywords:
            break
    return frozenset(out)


def lexical_overlap(goal_keywords, text):
    """Fraction of goal keywords present in text (token match, case-insensitive).
    None when there are no keywords (gate inactive)."""
    if not goal_keywords:
        return None
    toks = {t.lower() for t in _re.findall(r"[A-Za-z0-9_]+", str(text or ""))}
    hits = sum(1 for k in goal_keywords if k in toks)
    return hits / len(goal_keywords)


def evaluate_drift_shadow(sim_series, current_lexical, prior_streak, turns_since_goal, config, w2w_similarity=None):
    """Compose the SHADOW (candidate) drift severity from the persisted per-turn
    similarity series. Pure; no model. Never drives the statusline — logged so the
    Phase-3 harness can calibrate against real sessions.

    sim_series:      per-turn cos(goal, user_turn), oldest..newest (current is last).
    current_lexical: goal-keyword overlap for the latest turn (or None).
    prior_streak:    consecutive prior 'hit' turns (persistence state).
    """
    cfg = config or {}
    z_thresh = _num(cfg.get("zThreshold"), 3.5)
    z_thresh_cold = _num(cfg.get("zThresholdColdStart"), 4.5)
    z_red_margin = _num(cfg.get("zRedMargin"), 1.5)
    abs_floor = _num(cfg.get("absoluteFloor"), 0.35)
    baseline_min = _num(cfg.get("baselineMinTurns"), 3)
    persistence = _num(cfg.get("persistenceTurns"), 2)
    min_turns = _num(cfg.get("minTurnsBeforeFiring"), 3)
    lex_drop = _num(cfg.get("lexicalOverlapDropThreshold"), 0.5)
    require_lexical = cfg.get("requireLexicalAgreement") is not False

    series = [s for s in (sim_series or []) if isinstance(s, (int, float)) and not isinstance(s, bool)]
    if not series:
        return {"severity": "green", "reason": "no activity", "hitStreak": 0, "current": None,
                "z": None, "semanticHit": False, "lexicalHit": False, "w2w": None}

    current = series[-1]
    baseline = series[:-1]
    n = len(baseline)
    z = robust_modified_zscore_drop(baseline, current)

    # Widen the bar while the baseline is thin; never fire before min_turns (early
    # exploration must stay quiet — precision first).
    active_thresh = z_thresh if n >= (baseline_min + 2) else z_thresh_cold
    below_floor = current < abs_floor
    semantic_hit = below_floor or (z is not None and z >= active_thresh)
    lexical_hit = (current_lexical is not None and current_lexical < lex_drop)
    fire = semantic_hit and (lexical_hit or not require_lexical)
    if turns_since_goal is not None and turns_since_goal < min_turns:
        fire = False

    streak = (int(prior_streak) if isinstance(prior_streak, (int, float)) and not isinstance(prior_streak, bool) else 0)
    streak = streak + 1 if fire else 0

    if streak >= persistence:
        strong = below_floor or (z is not None and z >= active_thresh + z_red_margin)
        severity = "red" if strong else "yellow"
        reason = f"drifting from goal ({round(current * 100)}% similar)"
    else:
        severity = "green"
        reason = "on goal"

    return {
        "severity": severity,
        "reason": reason,
        "hitStreak": streak,
        "current": round(float(current), 4),
        "z": (round(float(z), 3) if z is not None else None),
        "semanticHit": bool(semantic_hit),
        "lexicalHit": bool(lexical_hit),
        "w2w": (round(float(w2w_similarity), 4) if isinstance(w2w_similarity, (int, float)) and not isinstance(w2w_similarity, bool) else None),
    }
