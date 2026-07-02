"""Shared-state I/O for the worker — wire-compatible with the Node side.

The worker writes computed fields (goalDrift, goalVector) into the same
~/.claude/context-health-state.json that the Node hooks write raw signals to. To
share it safely they must agree on three things, all mirrored from bin/lib/state.js:

  * file shape: a JSON object keyed by session_id
  * atomic writes: temp file + os.replace (atomic, replaces on Windows)
  * the lock: a directory at `${statePath}.lock`, created with mkdir (atomic),
    stolen after LOCK_STALE_MS if a holder crashed

Everything is defensive: a missing/corrupt file degrades to {} and never raises.
"""

import json
import os
import time

MAX_SESSIONS = 20

LOCK_RETRIES = 60
LOCK_WAIT_S = 0.008
LOCK_STALE_S = 2.5


def get_state_path():
    env = os.environ.get("CONTEXT_HEALTH_STATE_FILE")
    if env:
        return env
    return os.path.join(os.path.expanduser("~"), ".claude", "context-health-state.json")


def _now_ms():
    return int(time.time() * 1000)


def load_state():
    path = get_state_path()
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read()
    except OSError:
        return {}
    # Strip any leading junk (e.g. a stray shell-rc echo) before the JSON object.
    start = raw.find("{")
    if start == -1:
        return {}
    try:
        parsed = json.loads(raw[start:])
    except (ValueError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def save_state(obj):
    path = get_state_path()
    directory = os.path.dirname(path)
    if directory:
        try:
            os.makedirs(directory, exist_ok=True)
        except OSError:
            pass
    tmp = f"{path}.{os.getpid()}.{int(time.time()*1000000) % 1000000}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(json.dumps(obj))
        os.replace(tmp, path)  # atomic replace
    except OSError:
        try:
            os.remove(tmp)
        except OSError:
            pass


def _lock_dir():
    return get_state_path() + ".lock"


def _acquire_lock():
    lock_dir = _lock_dir()
    for _ in range(LOCK_RETRIES):
        try:
            os.mkdir(lock_dir)
            return True
        except FileExistsError:
            try:
                age = time.time() - os.stat(lock_dir).st_mtime
                if age > LOCK_STALE_S:
                    try:
                        os.rmdir(lock_dir)
                    except OSError:
                        pass
                    continue
            except OSError:
                continue
            time.sleep(LOCK_WAIT_S)
        except OSError:
            time.sleep(LOCK_WAIT_S)
    return False


def _release_lock():
    try:
        os.rmdir(_lock_dir())
    except OSError:
        pass


def _default_session(session_id):
    return {
        "sessionId": session_id,
        "createdAt": None,
        "updatedAt": None,
        "computed": {"goalDrift": None, "contradiction": None},
    }


def _prune(all_state):
    if len(all_state) <= MAX_SESSIONS:
        return all_state
    ids = sorted(
        all_state.keys(),
        key=lambda k: (all_state[k] or {}).get("updatedAt") or 0,
        reverse=True,
    )
    return {k: all_state[k] for k in ids[:MAX_SESSIONS]}


def update_session(session_id, mutator):
    """Read-modify-write one session under the shared lock. `mutator(session)`
    returns the modified session dict. Returns the persisted session dict."""
    locked = _acquire_lock()
    try:
        all_state = load_state()
        current = all_state.get(session_id)
        if not isinstance(current, dict):
            current = _default_session(session_id)
        else:
            base = _default_session(session_id)
            base.update(current)
            current = base
            current.setdefault("computed", {"goalDrift": None, "contradiction": None})

        if current.get("createdAt") is None:
            current["createdAt"] = _now_ms()

        try:
            result = mutator(current)
            if isinstance(result, dict):
                current = result
        except Exception:
            pass  # a bad mutator must not corrupt state

        current["sessionId"] = session_id
        current["updatedAt"] = _now_ms()

        all_state[session_id] = current
        save_state(_prune(all_state))
        return current
    finally:
        if locked:
            _release_lock()
