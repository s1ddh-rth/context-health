"""The warm worker.

Runs for the session lifetime as a plugin background monitor. Keeps the embedding
model loaded, and every tick:

  * reads the shared state file
  * for each session with a captured goal, embeds the goal once (cached in
    memory) and embeds a rolling window of recent activity
  * writes computed.goalDrift back into the state file (under the shared lock)
  * prints a single-line alert to stdout when a session first goes red — the
    monitor delivers that line to Claude as a notification

Only computes when a session's turn count has advanced, so idle ticks are cheap.
Degrades silently if the model can't load: drift stays null, hooks/statusline
are unaffected.

The per-session logic is factored into compute_session_drift() so it can be unit
tested with a fake embedder and no model.
"""

import sys
import time

MAX_GOAL_CACHE = 64

from . import state_io
from .config import load_config
from .drift import build_activity_text, cosine_similarity, evaluate_drift
from .embedder import Embedder


def _word_count(text):
    return len((text or "").split())


def compute_session_drift(session, embedder, drift_cfg, goal_cache):
    """Compute the goalDrift result for one session, or None if there's nothing
    to compute yet (no goal, no activity, or the model is unavailable).

    goal_cache: dict {goal_text: vector} shared across ticks so the goal is
    embedded only once.
    """
    goal_text = (session or {}).get("goalText")
    if not goal_text:
        return None

    turn = session.get("turnCount") or 0
    weak_min = _num(drift_cfg.get("weakAnchorMinTokens"), 12)
    weak_anchor = _word_count(goal_text) < weak_min

    goal_vec = goal_cache.get(goal_text)
    if goal_vec is None:
        goal_vec = embedder.embed(goal_text)
        if goal_vec is None:
            return None  # model unavailable
        goal_cache[goal_text] = goal_vec
        # Bound the cache: a long-lived monitor could otherwise accumulate one
        # vector per distinct goal string ever seen. Evict oldest (insertion
        # order) beyond the cap; re-embedding an evicted goal is cheap.
        while len(goal_cache) > MAX_GOAL_CACHE:
            goal_cache.pop(next(iter(goal_cache)))

    activity = build_activity_text(
        session,
        max_prompts=int(_num(drift_cfg.get("rollingActivityTurns"), 5)),
        max_tools=10,
        exclude=goal_text,  # don't compare the goal prompt against itself
    )
    if not activity:
        return None  # nothing to compare against yet

    act_vec = embedder.embed(activity)
    if act_vec is None:
        return None

    similarity = cosine_similarity(goal_vec, act_vec)
    result = evaluate_drift(similarity, turn, drift_cfg, weak_anchor)
    # round for a stable, compact state file
    result["similarity"] = round(float(similarity), 4)
    return result


def run_once(embedder, config, goal_cache, seen_turns, last_severity):
    """One pass over all sessions. Returns a list of notification lines (for
    sessions that just went red). Mutates seen_turns and last_severity."""
    drift_cfg = (config.get("detectors") or {}).get("goalDrift") or {}
    if drift_cfg.get("enabled") is False:
        return []

    notifications = []
    all_state = state_io.load_state()

    for session_id, session in list(all_state.items()):
        if not isinstance(session, dict):
            continue
        turn = session.get("turnCount") or 0
        # Skip if this session hasn't advanced since we last processed it.
        if seen_turns.get(session_id) == turn and session_id in last_severity:
            continue

        result = compute_session_drift(session, embedder, drift_cfg, goal_cache)
        if result is None:
            seen_turns[session_id] = turn
            continue

        state_io.update_session(session_id, _make_drift_writer(result))
        seen_turns[session_id] = turn

        if session_id in last_severity:
            prev = last_severity[session_id]
        else:
            # First time this process sees the session (e.g. after a monitor
            # restart): baseline from the severity we last persisted, so we don't
            # re-notify a red that already fired in a previous run.
            persisted = ((session.get("computed") or {}).get("goalDrift") or {})
            prev = persisted.get("severity") or "green"
        last_severity[session_id] = result["severity"]
        if result["severity"] == "red" and prev != "red":
            notifications.append(
                f"Context health: goal-drift — {result['reason']}. "
                "Restate the goal or start fresh."
            )

    return notifications


def _make_drift_writer(result):
    def writer(s):
        computed = s.get("computed")
        if not isinstance(computed, dict):
            computed = {}
        computed["goalDrift"] = result
        s["computed"] = computed
        return s

    return writer


def _num(value, default):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    return default


def main(argv=None):
    config = load_config()
    worker_cfg = config.get("worker") or {}
    interval = _num(worker_cfg.get("pollIntervalSeconds"), 1.5)
    model_name = worker_cfg.get("embeddingModel") or "BAAI/bge-small-en-v1.5"

    embedder = Embedder(model_name)
    goal_cache = {}
    seen_turns = {}
    last_severity = {}

    # Warm the model once up front (so the first real turn isn't slow). If it
    # fails, keep running — drift just stays disabled.
    _ = embedder.available

    while True:
        try:
            config = load_config()
            notes = run_once(embedder, config, goal_cache, seen_turns, last_severity)
            for line in notes:
                print(line, flush=True)
        except Exception:
            # Never let a bad tick kill the worker.
            pass
        time.sleep(interval)


if __name__ == "__main__":
    main()
