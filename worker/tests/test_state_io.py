"""Tests for the Python state I/O — must be wire-compatible with the Node side
(same file shape, same lock protocol)."""

import json
import os
import subprocess
import sys
import tempfile

import pytest

from context_health_worker import state_io


@pytest.fixture()
def state_path(tmp_path, monkeypatch):
    p = tmp_path / "state.json"
    monkeypatch.setenv("CONTEXT_HEALTH_STATE_FILE", str(p))
    return str(p)


def test_get_state_path_honors_env(state_path):
    assert state_io.get_state_path() == state_path


def test_load_missing_file_returns_empty(state_path):
    assert state_io.load_state() == {}


def test_load_corrupt_file_returns_empty(state_path):
    with open(state_path, "w") as f:
        f.write("{ not valid json ")
    assert state_io.load_state() == {}


def test_load_strips_leading_junk(state_path):
    with open(state_path, "w") as f:
        f.write('shell-rc noise\n{"a": {"turnCount": 2}}')
    assert state_io.load_state()["a"]["turnCount"] == 2


def test_update_session_round_trips(state_path):
    def mut(s):
        s["turnCount"] = 5
        return s

    state_io.update_session("sess-1", mut)
    all_state = state_io.load_state()
    assert all_state["sess-1"]["turnCount"] == 5
    assert all_state["sess-1"]["sessionId"] == "sess-1"


def test_update_session_preserves_existing_fields(state_path):
    # simulate a hook having written raw signals
    with open(state_path, "w") as f:
        json.dump({"sess-1": {"sessionId": "sess-1", "goalText": "build X", "turnCount": 3}}, f)

    def set_drift(s):
        s.setdefault("computed", {})["goalDrift"] = {"severity": "yellow", "similarity": 0.6}
        return s

    state_io.update_session("sess-1", set_drift)
    s = state_io.load_state()["sess-1"]
    assert s["goalText"] == "build X"  # untouched
    assert s["turnCount"] == 3
    assert s["computed"]["goalDrift"]["severity"] == "yellow"


def test_update_session_stamps_updated_at(state_path):
    s = state_io.update_session("t", lambda x: x)
    assert isinstance(s["updatedAt"], int)
    assert s["updatedAt"] > 0


def test_atomic_write_leaves_no_temp_files(state_path):
    state_io.update_session("t", lambda x: x)
    d = os.path.dirname(state_path)
    leftovers = [f for f in os.listdir(d) if f.endswith(".tmp")]
    assert leftovers == []


def test_lock_dir_name_matches_node_convention(state_path):
    # Node uses `${statePath}.lock`; Python must agree or they won't mutually exclude.
    assert state_io._lock_dir() == state_path + ".lock"


def test_concurrent_python_writers_do_not_lose_updates(state_path):
    # spawn several processes that each increment the same counter
    child = (
        "import os;"
        "from context_health_worker import state_io;"
        "state_io.update_session('shared', lambda s: {**s, 'turnCount': s.get('turnCount', 0) + 1})"
    )
    env = dict(os.environ)
    procs = [
        subprocess.Popen([sys.executable, "-c", child], env=env)
        for _ in range(10)
    ]
    for p in procs:
        p.wait()
    assert state_io.load_state()["shared"]["turnCount"] == 10
