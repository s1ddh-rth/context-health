"""Tests for the pure calibration helpers (synthetic scores, no model)."""

from context_health_worker.calibration import (
    separation,
    sweep_thresholds,
    recommend_threshold,
)

# cleanly separable: on_goal high (>=0.75), drifted low (<=0.45)
SEPARABLE = (
    [("on_goal", 0.90), ("on_goal", 0.80), ("on_goal", 0.75)]
    + [("drifted", 0.20), ("drifted", 0.40), ("drifted", 0.45)]
)


def test_separation_reports_margin():
    sep = separation(SEPARABLE)
    assert sep["on_goal_min"] == 0.75
    assert sep["drifted_max"] == 0.45
    assert abs(sep["margin"] - 0.30) < 1e-9


def test_sweep_precision_and_recall_move_as_expected():
    rows = {r["threshold"]: r for r in sweep_thresholds(SEPARABLE, [0.50, 0.70])}
    # threshold 0.50: flags the three drifted, no on_goal -> perfect
    assert rows[0.50]["precision"] == 1.0
    assert rows[0.50]["recall"] == 1.0
    # threshold 0.70: still flags all drifted, no on_goal (min on_goal is 0.75)
    assert rows[0.70]["precision"] == 1.0
    assert rows[0.70]["recall"] == 1.0


def test_high_threshold_creates_false_positives():
    # at 0.85 the two on_goal at 0.80/0.75 get flagged -> false positives
    row = sweep_thresholds(SEPARABLE, [0.85])[0]
    assert row["fp"] == 2
    assert row["precision"] < 1.0


def test_recommend_precision_first_picks_largest_zero_fp_threshold():
    rec = recommend_threshold(SEPARABLE, precision_target=1.0)
    # largest threshold with no false positive is just under min on_goal (0.75)
    assert rec is not None
    assert 0.70 <= rec["threshold"] <= 0.75
    assert rec["fp"] == 0
    assert rec["precision"] == 1.0


def test_recommend_returns_none_when_target_unreachable():
    # fully overlapping classes: no threshold gives precision 1.0 with any TP.
    # A tp==0 cut is vacuously precise but not a real recommendation -> None.
    overlap = [("on_goal", 0.5), ("drifted", 0.5)]
    rec = recommend_threshold(overlap, precision_target=1.0)
    assert rec is None
