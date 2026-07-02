"""Contradiction detector (opt-in, off by default) — the merged clash+poisoning.

Research showed clash and poisoning collapse to the same computation: detecting a
contradiction between two items in context (a later statement negating an earlier
constraint, or a claim contradicting a grounded fact). Locally, with marker
heuristics, this is too false-alarm-prone to ship. So it runs only when the user
opts in, and delegates to an LLM judge — the user's own Claude API key or a local
model (no billing by this plugin).

The judge call is injected as `judge_fn(prompt) -> str | None`, so the decision
logic here is pure and unit-tested with a fake judge. Precision over recall: the
prompt tells the judge to flag only clear contradictions, and anything it can't
parse degrades to green (no alarm).
"""

import json

JUDGE_PROMPT = """You are a precise contradiction detector for an AI coding session.
Below is a numbered list of statements and actions from the recent context
(user requests, stated constraints, and tool actions), oldest first.

Decide whether any LATER item clearly CONTRADICTS an EARLIER stated constraint or
fact — for example a "never do X / always do Y / use X" that a later item
violates, or a claim that conflicts with an earlier grounded fact.

Be conservative: only report a contradiction you are confident about. Ambiguity,
a change of topic, or normal refinement is NOT a contradiction.

Respond with ONLY a JSON object, no prose:
{{"contradiction": true|false, "severity": "green"|"yellow"|"red", "reason": "<short>"}}
Use "yellow" for a single clear contradiction, "red" for a constraint that is
repeatedly violated. Use "green" and contradiction=false when there is none.

Statements:
{statements}
"""


def build_judge_input(session, max_prompts=8, max_tools=10):
    """Build the numbered statement list the judge inspects, from the session's
    recent prompts and tool actions."""
    session = session or {}
    prompts = (session.get("prompts") or [])[-max_prompts:]
    tools = (session.get("recentToolCalls") or [])[-max_tools:]

    def _oneline(s):
        # Collapse internal newlines so each statement occupies exactly one line
        # (keeps the numbered list readable and makes the item count reliable).
        return " ".join(str(s).split())

    items = []
    for p in prompts:
        items.append("user: " + _oneline(p))
    for c in tools:
        if isinstance(c, dict):
            items.append("action: " + _oneline(c.get("name", "")) + " " + _oneline(c.get("paramsKey", "")))

    numbered = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(items))
    return numbered


def parse_judge_verdict(text):
    """Parse the judge's JSON verdict into {severity, reason}. Anything
    unparseable or malformed degrades to green (no false alarm)."""
    if not text or not isinstance(text, str):
        return {"severity": "green", "reason": "no verdict"}
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        return {"severity": "green", "reason": "unparseable verdict"}
    try:
        obj = json.loads(text[start:end + 1])
    except (ValueError, TypeError):
        return {"severity": "green", "reason": "unparseable verdict"}
    if not isinstance(obj, dict):
        return {"severity": "green", "reason": "unparseable verdict"}

    if obj.get("contradiction") is not True:
        return {"severity": "green", "reason": "no contradiction"}
    severity = obj.get("severity")
    if severity not in ("yellow", "red"):
        severity = "yellow"  # contradiction=true but odd severity -> conservative yellow
    reason = obj.get("reason") or "contradiction detected"
    return {"severity": severity, "reason": str(reason)[:200]}


def evaluate_contradiction(session, judge_fn, min_items=2):
    """Run the judge over the session's recent context. Returns {severity, reason}
    or None if there's too little context or the judge is unavailable."""
    statements = build_judge_input(session)
    if not statements or statements.count("\n") + 1 < min_items:
        return None  # not enough to compare

    prompt = JUDGE_PROMPT.format(statements=statements)
    try:
        response = judge_fn(prompt)
    except Exception:
        return None
    if response is None:
        return None
    return parse_judge_verdict(response)
