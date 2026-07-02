"""Tests for judge backend routing and graceful degradation (no network)."""

from context_health_worker.judge import make_judge


def test_unknown_backend_returns_none():
    assert make_judge({"judge": "nonsense"}) is None


def test_local_backend_returns_a_callable():
    j = make_judge({"judge": "local", "endpoint": "http://localhost:1/nope"})
    assert callable(j)


def test_local_judge_degrades_to_none_on_unreachable_endpoint():
    # nothing is listening on this port -> connection refused -> None, not a crash
    j = make_judge({"judge": "local", "endpoint": "http://127.0.0.1:1/v1/chat/completions"})
    assert j("hello") is None


def test_byok_backend_is_none_when_sdk_not_installed():
    # the `anthropic` SDK is an opt-in extra; without it, byok degrades to None
    # (this env doesn't install the contradiction extra)
    try:
        import anthropic  # noqa: F401
        installed = True
    except Exception:
        installed = False
    j = make_judge({"judge": "byok"})
    if installed:
        assert callable(j)
    else:
        assert j is None
