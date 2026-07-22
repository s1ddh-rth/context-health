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
from .contradiction import evaluate_contradiction
from .drift import (
    GOAL_TRUNCATION_LEN,
    build_activity_text,
    cosine_similarity,
    evaluate_drift,
    evaluate_drift_shadow,
    extract_goal_keywords,
    lexical_overlap,
)
from .embedder import Embedder
from .judge import make_judge


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
        max_tools=int(_num(drift_cfg.get("maxActivityToolCalls"), 10)),
        exclude=goal_text,  # don't compare the goal prompt against itself
    )
    if not activity:
        return None  # nothing to compare against yet

    act_vec = embedder.embed(activity)
    if act_vec is None:
        return None

    similarity = cosine_similarity(goal_vec, act_vec)
    # Measure the grace period from when the goal was set, not session start, so a
    # /reset-goal on a long session gets a fresh minTurnsBeforeFiring window.
    # Legacy state without goalSetTurn falls back to the old turnCount behavior.
    goal_set_turn = session.get("goalSetTurn")
    if isinstance(goal_set_turn, (int, float)) and not isinstance(goal_set_turn, bool):
        turns_since_goal = turn - goal_set_turn
    else:
        turns_since_goal = turn
    result = evaluate_drift(similarity, turns_since_goal, drift_cfg, weak_anchor)
    # round for a stable, compact state file
    result["similarity"] = round(float(similarity), 4)

    # Shadow-mode (Phase-3 candidate) signal: computed and attached as `_shadow`,
    # which run_once persists under computed.goalDriftShadow. It NEVER drives the
    # statusline (that reads goalDrift). Opt-in via goalDrift.shadow.enabled so the
    # extra per-turn embeds don't run unless configured (shipped on in settings.json).
    shadow_cfg = drift_cfg.get("shadow") or {}
    if shadow_cfg.get("enabled") is True:
        # Shadow is a diagnostic (OFF by default; opt in via the user config). It must
        # NEVER affect the shipped goalDrift signal, so isolate any failure here rather
        # than letting it abort the goalDrift write.
        try:
            prev_shadow = (session.get("computed") or {}).get("goalDriftShadow")
            shadow = _compute_shadow(session, goal_vec, goal_text, embedder, shadow_cfg,
                                     prev_shadow, turns_since_goal, turn)
            if shadow is not None:
                result["_shadow"] = shadow
        except Exception:
            pass
    return result


def _recent_user_prompts(session, exclude, max_n):
    """Recent USER prompts only (no tool calls), with the goal anchor excluded — the
    intent channel. Pooling prompts + tool-call strings dilutes intent, so the shadow
    signal compares the goal against user turns, kept separate."""
    prompts = (session or {}).get("prompts") or []
    ex = str(exclude) if exclude else None
    trunc = ex is not None and len(ex) >= GOAL_TRUNCATION_LEN
    out = []
    for p in prompts:
        sp = str(p)
        if ex is not None and (sp == ex or (trunc and sp.startswith(ex))):
            continue
        out.append(sp)
    return out[-max_n:] if max_n and max_n > 0 else out


def _mean_vec(vecs):
    if not vecs:
        return None
    dim = len(vecs[0])
    n = len(vecs)
    return [sum(v[i] for v in vecs) / n for i in range(dim)]


def _compute_shadow(session, goal_vec, goal_text, embedder, shadow_cfg, prev_shadow, turns_since_goal, turn):
    """Phase-3 candidate drift signal (logged to computed.goalDriftShadow, never the
    UI). Embeds recent USER turns SEPARATELY and scores drift with a per-session
    robust z-score of per-turn cosine-to-goal, gated by goal-keyword overlap. Returns
    None when there's nothing to score or the model is unavailable."""
    # Idempotent per turn: a monitor restart can reprocess the current turn (seen_turns
    # is in-memory), which would double-append to the series and double-count the
    # streak. If we already computed this turn, return the prior result unchanged.
    if prev_shadow is not None and prev_shadow.get("lastTurn") == turn:
        return prev_shadow
    win = int(_num(shadow_cfg.get("windowTurns"), 4))
    max_series = int(_num(shadow_cfg.get("maxSeries"), 40))
    prompts = _recent_user_prompts(session, goal_text, max(1, win * 2))
    if not prompts:
        return None
    vecs = []
    for p in prompts:
        v = embedder.embed(p)
        if v is None:
            return None  # model unavailable this tick
        vecs.append(v)
    current_sim = cosine_similarity(goal_vec, vecs[-1])

    # Window-to-window semantic drop (recent centroid vs the previous window) — the
    # sensitive detector of gradual shift; None until we have two full windows.
    w2w = None
    if len(vecs) >= 2 * win:
        w2w = cosine_similarity(_mean_vec(vecs[-win:]), _mean_vec(vecs[-2 * win:-win]))

    prev_series = [s for s in ((prev_shadow or {}).get("simSeries") or [])
                   if isinstance(s, (int, float)) and not isinstance(s, bool)]
    series = (prev_series + [round(float(current_sim), 4)])[-max_series:]

    cur_lex = lexical_overlap(extract_goal_keywords(goal_text), prompts[-1])
    prior_streak = (prev_shadow or {}).get("hitStreak") or 0

    result = evaluate_drift_shadow(series, cur_lex, prior_streak, turns_since_goal, shadow_cfg, w2w)
    result["simSeries"] = series
    result["lexical"] = round(float(cur_lex), 3) if cur_lex is not None else None
    result["lastTurn"] = turn
    return result


def run_once(embedder, config, goal_cache, seen_turns, last_severity,
             judge=None, contra_state=None):
    """One pass over all sessions. Returns notification lines for sessions that
    just went red on any detector. Drift and contradiction are handled
    independently per session so neither blocks the other."""
    detectors = config.get("detectors") or {}
    drift_cfg = detectors.get("goalDrift") or {}
    contra_cfg = detectors.get("contradiction") or {}
    drift_on = drift_cfg.get("enabled") is not False
    contra_on = contra_cfg.get("enabled") is True and judge is not None

    if not drift_on and not contra_on:
        return []

    if contra_state is None:
        contra_state = {}
    contra_seen = contra_state.setdefault("seen", {})
    contra_sev = contra_state.setdefault("sev", {})

    notifications = []
    all_state = state_io.load_state()

    for session_id, session in list(all_state.items()):
        if not isinstance(session, dict):
            continue
        turn = session.get("turnCount") or 0

        # --- goal drift ---
        if drift_on and not (seen_turns.get(session_id) == turn and session_id in last_severity):
            result = compute_session_drift(session, embedder, drift_cfg, goal_cache)
            if result is not None:
                shadow = result.pop("_shadow", None)
                state_io.update_session(session_id, _make_computed_writer("goalDrift", result))
                if shadow is not None:
                    state_io.update_session(session_id, _make_computed_writer("goalDriftShadow", shadow))
                prev = _prev_severity(session, last_severity, session_id, "goalDrift")
                last_severity[session_id] = result["severity"]
                if result["severity"] == "red" and prev != "red":
                    notifications.append(
                        f"Context health: goal-drift — {result['reason']}. "
                        "Restate your goal (keep it in a durable note) and re-anchor."
                    )
            seen_turns[session_id] = turn

        # --- contradiction (opt-in, throttled — it spends the user's tokens) ---
        if contra_on:
            gap = _num(contra_cfg.get("minTurnsBetweenChecks"), 3)
            last_checked = contra_seen.get(session_id)
            due = last_checked is None or (turn - last_checked) >= gap
            if due and turn >= 2:
                verdict = evaluate_contradiction(session, judge)
                contra_seen[session_id] = turn
                if verdict is not None:
                    state_io.update_session(session_id, _make_computed_writer("contradiction", verdict))
                    prev = contra_sev.get(session_id) or (
                        (session.get("computed") or {}).get("contradiction") or {}
                    ).get("severity") or "green"
                    contra_sev[session_id] = verdict["severity"]
                    if verdict["severity"] == "red" and prev != "red":
                        notifications.append(
                            f"Context health: contradiction — {verdict['reason']}. "
                            "Start fresh; don't compact the bad fact forward."
                        )

    return notifications


def _prev_severity(session, last_severity, session_id, field):
    if session_id in last_severity:
        return last_severity[session_id]
    # First sight this process (e.g. after a monitor restart): baseline from the
    # last persisted severity so we don't re-notify an already-fired red.
    return ((session.get("computed") or {}).get(field) or {}).get("severity") or "green"


def _make_computed_writer(field, result):
    def writer(s):
        computed = s.get("computed")
        if not isinstance(computed, dict):
            computed = {}
        computed[field] = result
        s["computed"] = computed
        return s

    return writer


def _num(value, default):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    return default


def _get_judge(config, holder):
    """Build the contradiction judge lazily, and rebuild only if the relevant
    config changed. Returns None when contradiction is disabled."""
    contra_cfg = (config.get("detectors") or {}).get("contradiction") or {}
    if contra_cfg.get("enabled") is not True:
        return None
    key = (contra_cfg.get("judge"), contra_cfg.get("model"), contra_cfg.get("endpoint"))
    if holder.get("built_for") != key:
        holder["judge"] = make_judge(contra_cfg)
        holder["built_for"] = key
    return holder.get("judge")


def main(argv=None):
    config = load_config()
    worker_cfg = config.get("worker") or {}
    interval = _num(worker_cfg.get("pollIntervalSeconds"), 1.5)
    model_name = worker_cfg.get("embeddingModel") or "BAAI/bge-small-en-v1.5"

    embedder = Embedder(model_name)
    goal_cache = {}
    seen_turns = {}
    last_severity = {}
    contra_state = {}
    judge_holder = {"built_for": None, "judge": None}

    # Warm the model once up front (so the first real turn isn't slow). If it
    # fails, keep running — drift just stays disabled.
    _ = embedder.available

    while True:
        try:
            config = load_config()
            judge = _get_judge(config, judge_holder)
            notes = run_once(embedder, config, goal_cache, seen_turns, last_severity,
                             judge=judge, contra_state=contra_state)
            for line in notes:
                print(line, flush=True)
        except Exception:
            # Never let a bad tick kill the worker.
            pass
        time.sleep(interval)


if __name__ == "__main__":
    main()
