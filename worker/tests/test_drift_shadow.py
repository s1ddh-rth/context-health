"""Tests for the shadow-mode (Phase-3 candidate) goal-drift signal — pure logic,
no embedding model. These validate the composite relative signal that is LOGGED
alongside the shipped absolute detector; it does not drive the statusline yet."""

from context_health_worker.drift import (
    robust_modified_zscore_drop,
    extract_goal_keywords,
    lexical_overlap,
    evaluate_drift_shadow,
)

# Mirrors the settings.json goalDrift.shadow defaults.
SHADOW = {
    "zThreshold": 3.5,
    "zThresholdColdStart": 4.5,
    "zRedMargin": 1.5,
    "absoluteFloor": 0.35,
    "baselineMinTurns": 3,
    "persistenceTurns": 2,
    "minTurnsBeforeFiring": 3,
    "lexicalOverlapDropThreshold": 0.5,
    "requireLexicalAgreement": True,
}


# --- robust modified z-score ---

def test_zscore_none_below_min_sample():
    assert robust_modified_zscore_drop([0.7, 0.71], 0.4) is None  # n<3


def test_zscore_none_on_zero_mad():
    # tied baseline => MAD 0 => undefined scale => None (caller uses absolute floor)
    assert robust_modified_zscore_drop([0.7, 0.7, 0.7, 0.7], 0.4) is None


def test_zscore_zero_when_at_or_above_median():
    assert robust_modified_zscore_drop([0.70, 0.71, 0.72, 0.73], 0.73) == 0.0


def test_zscore_positive_and_large_on_a_real_drop():
    base = [0.70, 0.71, 0.72, 0.69, 0.73]
    z = robust_modified_zscore_drop(base, 0.45)
    assert z is not None and z > 3.5, f"expected a big drop z, got {z}"


# --- keyword extraction + lexical overlap ---

def test_extract_keywords_keeps_salient_drops_stopwords():
    kw = extract_goal_keywords("add JWT auth with refresh tokens")
    assert "jwt" in kw and "auth" in kw and "refresh" in kw and "tokens" in kw
    assert "add" not in kw and "with" not in kw  # stopwords dropped


def test_extract_keywords_keeps_identifiers():
    kw = extract_goal_keywords("wire up parseConfig and OAUTH2 flow")
    assert "parseconfig" in kw  # camelCase identifier kept
    assert "oauth2" in kw       # has a digit


def test_lexical_overlap_fraction():
    kw = extract_goal_keywords("add JWT auth token")  # {jwt, auth, token}
    assert lexical_overlap(kw, "fix the JWT token bug") == 2 / 3
    assert lexical_overlap(kw, "refactor the logging module") == 0.0
    assert lexical_overlap(frozenset(), "anything") is None  # gate inactive


# --- composite shadow evaluator ---

def _run(series, lexicals, cfg=SHADOW, turns=None):
    """Replay a whole series turn-by-turn, threading the persistence streak, and
    return the final result (mimics how the worker calls it each turn)."""
    streak = 0
    res = None
    for i in range(len(series)):
        tsg = turns[i] if turns else i + 1
        res = evaluate_drift_shadow(series[: i + 1], lexicals[i], streak, tsg, cfg)
        streak = res["hitStreak"]
    return res


def test_shadow_stays_green_on_goal():
    series = [0.72, 0.71, 0.73, 0.72, 0.71, 0.73]
    lex = [1.0] * len(series)
    r = _run(series, lex)
    assert r["severity"] == "green"


def test_shadow_fires_on_sustained_semantic_and_lexical_drop():
    # healthy baseline, then two consecutive turns that drop hard AND lose the goal
    # keywords => should fire (semantic AND lexical, persisted 2 turns).
    series = [0.72, 0.71, 0.73, 0.70, 0.44, 0.42]
    lex = [1.0, 1.0, 1.0, 1.0, 0.0, 0.0]
    r = _run(series, lex)
    assert r["severity"] in ("yellow", "red")
    assert r["semanticHit"] and r["lexicalHit"]
    assert r["hitStreak"] >= SHADOW["persistenceTurns"]


def test_shadow_single_dip_does_not_fire_persistence():
    # one bad turn then recovery => never reaches the 2-turn persistence => green
    series = [0.72, 0.71, 0.73, 0.70, 0.44, 0.72]
    lex = [1.0, 1.0, 1.0, 1.0, 0.0, 1.0]
    r = _run(series, lex)
    assert r["severity"] == "green"


def test_shadow_semantic_without_lexical_is_suppressed():
    # cosine drops but the goal keywords are still present => lexical gate blocks the
    # alarm (the precision gate: probably legit on-goal sub-task, not drift).
    series = [0.72, 0.71, 0.73, 0.70, 0.44, 0.43]
    lex = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0]
    r = _run(series, lex)
    assert r["severity"] == "green"
    assert r["lexicalHit"] is False


def test_shadow_holds_fire_before_min_turns():
    # a catastrophic drop on turn 2 must not fire (below minTurnsBeforeFiring)
    r = evaluate_drift_shadow([0.72, 0.20], 0.0, 0, turns_since_goal=2, config=SHADOW)
    assert r["severity"] == "green"


def test_shadow_absolute_floor_catches_hard_pivot_in_coldstart():
    # thin baseline (z undefined) but a catastrophic absolute drop below the floor,
    # sustained + lexical loss => the absolute-floor backstop still fires.
    series = [0.70, 0.71, 0.20, 0.18]
    lex = [1.0, 1.0, 0.0, 0.0]
    r = _run(series, lex)
    assert r["severity"] in ("yellow", "red")
