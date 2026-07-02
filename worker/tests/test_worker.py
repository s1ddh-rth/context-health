"""Tests for the worker core with a fake embedder (no model, no network)."""

import json

import pytest

from context_health_worker import state_io, worker


DRIFT_CFG = {
    "enabled": True,
    "rollingActivityTurns": 5,
    "minTurnsBeforeFiring": 3,
    "cosineSimilarityYellow": 0.70,
    "cosineSimilarityRed": 0.50,
    "weakAnchorMinTokens": 12,
    "weakAnchorThresholdPenalty": 0.05,
}
CONFIG = {"detectors": {"goalDrift": DRIFT_CFG}}


class FakeEmbedder:
    """Returns goal_vec for the goal string, activity_vec for anything else."""

    def __init__(self, goal_text, goal_vec, activity_vec):
        self.goal_text = goal_text
        self.goal_vec = goal_vec
        self.activity_vec = activity_vec
        self.calls = 0

    def embed(self, text):
        self.calls += 1
        return self.goal_vec if text == self.goal_text else self.activity_vec


def make_session(goal="build a streaming CSV parser for large files", turn=5, prompts=None):
    return {
        "sessionId": "s1",
        "goalText": goal,
        "turnCount": turn,
        "prompts": prompts if prompts is not None else ["work on the parser"],
        "recentToolCalls": [],
    }


# --- compute_session_drift ---

def test_no_goal_returns_none():
    emb = FakeEmbedder("g", [1, 0], [1, 0])
    assert worker.compute_session_drift({"turnCount": 5}, emb, DRIFT_CFG, {}) is None


def test_no_activity_returns_none():
    s = make_session(prompts=[])
    s["recentToolCalls"] = []
    emb = FakeEmbedder(s["goalText"], [1, 0], [0, 1])
    assert worker.compute_session_drift(s, emb, DRIFT_CFG, {}) is None


def test_on_goal_is_green():
    s = make_session()
    emb = FakeEmbedder(s["goalText"], [1, 0], [1, 0])  # identical -> cos 1
    r = worker.compute_session_drift(s, emb, DRIFT_CFG, {})
    assert r["severity"] == "green"
    assert r["similarity"] == 1.0


def test_orthogonal_activity_is_red():
    s = make_session()
    emb = FakeEmbedder(s["goalText"], [1, 0], [0, 1])  # cos 0 -> below red
    r = worker.compute_session_drift(s, emb, DRIFT_CFG, {})
    assert r["severity"] == "red"


def test_goal_vector_is_cached_across_calls():
    s = make_session()
    emb = FakeEmbedder(s["goalText"], [1, 0], [1, 0])
    cache = {}
    worker.compute_session_drift(s, emb, DRIFT_CFG, cache)
    calls_after_first = emb.calls
    worker.compute_session_drift(s, emb, DRIFT_CFG, cache)
    # second call re-embeds activity but NOT the goal (cached) -> +1 call only
    assert emb.calls == calls_after_first + 1


def test_short_goal_is_treated_as_weak_anchor():
    s = make_session(goal="fix it")  # 2 words < weakAnchorMinTokens
    # choose similarity 0.66-ish region: use vectors giving ~0.66
    # [1,0] vs [2,1] -> cos = 2/sqrt(5) ~= 0.894 (green). Use [1,0] vs [1,1] -> 0.707 (green, >0.70)
    # For weak-anchor test we just assert the flag is set.
    emb = FakeEmbedder(s["goalText"], [1, 0], [1, 1])
    r = worker.compute_session_drift(s, emb, DRIFT_CFG, {})
    assert r["weakAnchor"] is True


# --- run_once (touches the state file) ---

@pytest.fixture()
def state_path(tmp_path, monkeypatch):
    p = tmp_path / "state.json"
    monkeypatch.setenv("CONTEXT_HEALTH_STATE_FILE", str(p))
    return str(p)


def _seed(state_path, session):
    with open(state_path, "w", encoding="utf-8") as f:
        json.dump({"s1": session}, f)


def test_run_once_writes_computed_goaldrift(state_path):
    _seed(state_path, make_session())
    emb = FakeEmbedder(make_session()["goalText"], [1, 0], [0, 1])  # red
    notes = worker.run_once(emb, CONFIG, {}, {}, {})
    saved = state_io.load_state()["s1"]
    assert saved["computed"]["goalDrift"]["severity"] == "red"
    assert len(notes) == 1  # first transition to red notifies


def test_run_once_notifies_red_only_on_transition(state_path):
    _seed(state_path, make_session())
    goal = make_session()["goalText"]
    emb = FakeEmbedder(goal, [1, 0], [0, 1])
    seen, sev = {}, {}
    n1 = worker.run_once(emb, CONFIG, {}, seen, sev)
    assert len(n1) == 1
    # same turn, still red -> skipped entirely (seen_turns unchanged) -> no dup notify
    n2 = worker.run_once(emb, CONFIG, {}, seen, sev)
    assert n2 == []


def test_run_once_skips_when_disabled(state_path):
    _seed(state_path, make_session())
    emb = FakeEmbedder("g", [1, 0], [0, 1])
    cfg = {"detectors": {"goalDrift": {**DRIFT_CFG, "enabled": False}}}
    notes = worker.run_once(emb, cfg, {}, {}, {})
    assert notes == []
    # nothing written
    saved = state_io.load_state()["s1"]
    assert saved.get("computed", {}).get("goalDrift") in (None, {})


def test_run_once_does_not_renotify_red_after_restart(state_path):
    # simulate a prior run having persisted a red drift result
    session = make_session()
    session["computed"] = {"goalDrift": {"severity": "red", "reason": "drifting", "similarity": 0.3}}
    _seed(state_path, session)
    goal = make_session()["goalText"]
    emb = FakeEmbedder(goal, [1, 0], [0, 1])  # still red
    # fresh in-memory dicts == a restarted monitor process
    notes = worker.run_once(emb, CONFIG, {}, {}, {})
    # already-red on restart must NOT re-notify
    assert notes == []


def test_run_once_reprocesses_after_turn_advances(state_path):
    _seed(state_path, make_session(turn=5))
    goal = make_session()["goalText"]
    emb = FakeEmbedder(goal, [1, 0], [1, 0])  # green
    seen, sev = {}, {}
    worker.run_once(emb, CONFIG, {}, seen, sev)
    assert seen["s1"] == 5
    # advance the turn and flip activity to orthogonal (red)
    _seed(state_path, make_session(turn=6))
    emb2 = FakeEmbedder(goal, [1, 0], [0, 1])
    notes = worker.run_once(emb2, CONFIG, {}, seen, sev)
    assert state_io.load_state()["s1"]["computed"]["goalDrift"]["severity"] == "red"
    assert len(notes) == 1
