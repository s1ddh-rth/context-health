"""Tests for the contradiction detector logic (fake judge, no network)."""

from context_health_worker.contradiction import (
    build_judge_input,
    parse_judge_verdict,
    evaluate_contradiction,
)


def session(prompts=None, tools=None):
    return {"prompts": prompts or [], "recentToolCalls": tools or []}


# --- build_judge_input ---

def test_build_input_numbers_prompts_and_actions():
    s = session(prompts=["use tabs not spaces", "actually use spaces"],
                tools=[{"name": "Edit", "paramsKey": "{}"}])
    text = build_judge_input(s)
    assert "1. user: use tabs not spaces" in text
    assert "2. user: actually use spaces" in text
    assert "action: Edit" in text


# --- parse_judge_verdict ---

def test_parse_no_contradiction_is_green():
    v = parse_judge_verdict('{"contradiction": false, "severity": "green", "reason": "none"}')
    assert v["severity"] == "green"


def test_parse_yellow_contradiction():
    v = parse_judge_verdict('{"contradiction": true, "severity": "yellow", "reason": "tabs vs spaces"}')
    assert v["severity"] == "yellow"
    assert "tabs" in v["reason"]


def test_parse_red_contradiction():
    v = parse_judge_verdict('{"contradiction": true, "severity": "red", "reason": "repeated"}')
    assert v["severity"] == "red"


def test_parse_extracts_json_from_surrounding_prose():
    v = parse_judge_verdict('Here is my answer: {"contradiction": true, "severity": "yellow", "reason": "x"} done')
    assert v["severity"] == "yellow"


def test_parse_garbage_degrades_to_green():
    assert parse_judge_verdict("not json").get("severity") == "green"
    assert parse_judge_verdict("").get("severity") == "green"
    assert parse_judge_verdict(None).get("severity") == "green"


def test_parse_contradiction_true_but_bad_severity_is_conservative_yellow():
    v = parse_judge_verdict('{"contradiction": true, "severity": "banana"}')
    assert v["severity"] == "yellow"


# --- evaluate_contradiction (fake judge) ---

def test_evaluate_calls_judge_and_returns_verdict():
    s = session(prompts=["never commit secrets", "commit the .env file with the API key"])
    captured = {}

    def judge(prompt):
        captured["prompt"] = prompt
        return '{"contradiction": true, "severity": "red", "reason": "committing secrets"}'

    v = evaluate_contradiction(s, judge)
    assert v["severity"] == "red"
    assert "Statements:" in captured["prompt"]  # the prompt was built and passed


def test_evaluate_returns_none_with_too_little_context():
    s = session(prompts=["just one thing"])
    called = {"n": 0}

    def judge(prompt):
        called["n"] += 1
        return "{}"

    assert evaluate_contradiction(s, judge, min_items=2) is None
    assert called["n"] == 0  # judge not called when there's nothing to compare


def test_evaluate_returns_none_when_judge_unavailable():
    s = session(prompts=["a", "b", "c"])
    assert evaluate_contradiction(s, lambda p: None) is None


def test_evaluate_survives_a_throwing_judge():
    s = session(prompts=["a", "b", "c"])

    def judge(prompt):
        raise RuntimeError("network down")

    assert evaluate_contradiction(s, judge) is None
