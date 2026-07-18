"""Tests for the pure goal-drift logic (no model needed)."""

import math

from context_health_worker.config import BUILT_IN_DEFAULTS
from context_health_worker.drift import (
    cosine_similarity,
    evaluate_drift,
    build_activity_text,
)

# Drive the tests from the SHIPPED thresholds, not a hand-picked copy, so the suite
# actually guards production behavior (it previously pinned a retired 0.70 yellow
# and asserted classifications the shipped 0.55 would not make).
CONFIG = dict(BUILT_IN_DEFAULTS["detectors"]["goalDrift"])


def test_config_tracks_shipped_thresholds():
    # Guardrail: if the shipped defaults move, this test (and the ones below) must
    # be revisited rather than silently passing on stale numbers.
    assert CONFIG["cosineSimilarityYellow"] == 0.55
    assert CONFIG["cosineSimilarityRed"] == 0.50


# --- cosine_similarity ---

def test_cosine_identical_is_one():
    assert cosine_similarity([1, 2, 3], [1, 2, 3]) == 1.0


def test_cosine_orthogonal_is_zero():
    assert abs(cosine_similarity([1, 0], [0, 1])) < 1e-9


def test_cosine_opposite_is_minus_one():
    assert abs(cosine_similarity([1, 0], [-1, 0]) + 1.0) < 1e-9


def test_cosine_zero_vector_is_safe():
    # a zero vector has no direction; must not divide by zero
    assert cosine_similarity([0, 0, 0], [1, 2, 3]) == 0.0


def test_cosine_length_mismatch_is_safe():
    assert cosine_similarity([1, 2], [1, 2, 3]) == 0.0


# --- evaluate_drift thresholds ---

def test_drift_high_similarity_is_green():
    r = evaluate_drift(0.9, turn_count=5, config=CONFIG)
    assert r["severity"] == "green"


def test_drift_below_yellow_is_yellow():
    # between red (0.50) and yellow (0.55) => yellow under the shipped thresholds
    r = evaluate_drift(0.52, turn_count=5, config=CONFIG)
    assert r["severity"] == "yellow"


def test_drift_below_red_is_red():
    r = evaluate_drift(0.40, turn_count=5, config=CONFIG)
    assert r["severity"] == "red"


def test_drift_holds_fire_until_min_turns():
    # only 2 turns in: even a terrible similarity must not fire yet
    r = evaluate_drift(0.10, turn_count=2, config=CONFIG)
    assert r["severity"] == "green"
    assert r["belowMinTurns"] is True


def test_drift_exactly_at_yellow_threshold_is_green():
    # fire when similarity < threshold (strict), so exactly 0.55 is still green
    r = evaluate_drift(0.55, turn_count=5, config=CONFIG)
    assert r["severity"] == "green"


def test_weak_anchor_makes_firing_harder():
    # penalty (0.05) lowers the thresholds so a weak anchor cuts false alarms:
    # 0.52 is yellow with a strong anchor (< 0.55), but green with a weak one (>= 0.50)
    strong = evaluate_drift(0.52, turn_count=5, config=CONFIG, weak_anchor=False)
    weak = evaluate_drift(0.52, turn_count=5, config=CONFIG, weak_anchor=True)
    assert strong["severity"] == "yellow"
    assert weak["severity"] == "green"


def test_drift_reason_mentions_similarity():
    r = evaluate_drift(0.40, turn_count=5, config=CONFIG)
    assert "drift" in r["reason"].lower() or "goal" in r["reason"].lower()


# --- build_activity_text ---

def test_build_activity_combines_recent_prompts_and_tools():
    session = {
        "prompts": ["build a parser", "add tests", "fix the bug", "refactor io", "write docs"],
        "recentToolCalls": [
            {"name": "Grep", "paramsKey": '{"pattern":"x"}'},
            {"name": "Read", "paramsKey": '{"file":"a"}'},
        ],
    }
    text = build_activity_text(session, max_prompts=3, max_tools=5)
    # includes the most recent prompts
    assert "write docs" in text
    assert "refactor io" in text
    # oldest prompt dropped when max_prompts=3
    assert "build a parser" not in text
    # includes tool names
    assert "Grep" in text


def test_build_activity_handles_empty_session():
    text = build_activity_text({}, max_prompts=3, max_tools=5)
    assert isinstance(text, str)


def test_build_activity_excludes_the_goal_anchor():
    # the goal-defining prompt lives in prompts; it must not count as activity
    session = {
        "prompts": ["build a CSV parser", "what is the best pizza recipe"],
        "recentToolCalls": [],
    }
    text = build_activity_text(session, max_prompts=5, max_tools=5, exclude="build a CSV parser")
    assert "pizza" in text
    assert "CSV parser" not in text


def test_build_activity_excludes_truncated_long_goal_by_prefix():
    # Node truncates goalText to 4000 chars but stores the full prompt; a >4000
    # char first prompt must still be recognized as the anchor via prefix match.
    long_prompt = "spec " * 1000  # 5000 chars
    goal_text = long_prompt[:4000]  # what Node stores as goalText
    session = {"prompts": [long_prompt, "now do something unrelated"], "recentToolCalls": []}
    text = build_activity_text(session, max_prompts=5, max_tools=5, exclude=goal_text)
    assert "unrelated" in text
    assert "spec spec" not in text  # the long anchor prompt was excluded


def test_build_activity_short_goal_does_not_over_exclude():
    # a short goal must NOT prefix-exclude a longer on-goal follow-up
    session = {"prompts": ["fix the bug", "fix the bug in the parser too"], "recentToolCalls": []}
    text = build_activity_text(session, max_prompts=5, max_tools=5, exclude="fix the bug")
    assert "in the parser too" in text  # follow-up kept
