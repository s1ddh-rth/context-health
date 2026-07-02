"""LLM judge backends for the opt-in contradiction detector.

No paid tier: the judge runs on the user's OWN credentials. Two backends:

  * "byok" / "anthropic": the official `anthropic` SDK, which resolves the user's
    existing credentials automatically (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN /
    an `ant auth login` profile) — we never ask them to paste a key. Installed
    only when the user opts in (`uv sync --extra contradiction`); if the SDK isn't
    present or no credentials resolve, the backend is simply unavailable.
  * "local": a local OpenAI-compatible endpoint (e.g. Ollama) — a local model, no
    key, no cost.

make_judge(cfg) returns a callable judge(prompt) -> str | None (None = the judge
is unavailable or the call failed; the caller degrades to no alarm). Everything
is defensive — a judge failure must never crash the worker.
"""

import json
import urllib.request

DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5"
DEFAULT_LOCAL_ENDPOINT = "http://localhost:11434/v1/chat/completions"
DEFAULT_LOCAL_MODEL = "llama3.1"
MAX_TOKENS = 256


def make_judge(cfg):
    backend = (cfg or {}).get("judge", "byok")
    if backend in ("byok", "anthropic"):
        return _anthropic_judge(cfg or {})
    if backend == "local":
        return _local_judge(cfg or {})
    return None


def _anthropic_judge(cfg):
    try:
        import anthropic  # optional dependency — installed only when opted in
    except Exception:
        return None

    model = cfg.get("model") or DEFAULT_ANTHROPIC_MODEL
    # Construct the client lazily and cache it; the SDK resolves credentials
    # from the environment / profile without us handling a key.
    holder = {}

    def judge(prompt):
        try:
            client = holder.get("client")
            if client is None:
                client = anthropic.Anthropic()
                holder["client"] = client
            resp = client.messages.create(
                model=model,
                max_tokens=MAX_TOKENS,
                messages=[{"role": "user", "content": prompt}],
            )
            if getattr(resp, "stop_reason", None) == "refusal":
                return None
            parts = []
            for block in resp.content or []:
                if getattr(block, "type", None) == "text":
                    parts.append(getattr(block, "text", ""))
            text = "".join(parts)
            return text or None
        except Exception:
            return None

    return judge


def _local_judge(cfg):
    endpoint = cfg.get("endpoint") or DEFAULT_LOCAL_ENDPOINT
    model = cfg.get("model") or DEFAULT_LOCAL_MODEL

    def judge(prompt):
        try:
            body = json.dumps({
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": MAX_TOKENS,
                "temperature": 0,
            }).encode("utf-8")
            req = urllib.request.Request(
                endpoint, data=body, headers={"content-type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read())
            return data["choices"][0]["message"]["content"]
        except Exception:
            return None

    return judge
