# Context Health Detector for Claude Code

Everyone can see how *full* their context is. Nobody can see whether it has gone
*bad*. This Claude Code **plugin** watches a session live and flags the ways
context degrades — **distraction, confusion, goal-drift, and contradiction** —
surfaced as a color-coded health signal in the statusline that stays silent until
something is actually wrong.

Local-first, **zero API cost by default**, and **fully open-source — no paid
tier**. The first three detectors run entirely locally; the contradiction
detector is opt-in and off by default (and, when you turn it on, runs on your own
API key or a local model).

> Originally framed as five failure modes (Breunig's poisoning/distraction/
> confusion/clash plus goal-drift). Research showed **clash and poisoning collapse
> to the same local computation** — contradiction detection — so they're merged
> into one **contradiction** detector rather than shipped as two redundant,
> false-alarm-prone heuristics. Distraction, confusion, and goal-drift each keep a
> distinct, independently-calculable signal.

> **Status: Phase 2 shipped.** Corrected context math + distraction + confusion
> (Phase 1) run locally with no model. **Goal-drift** (Phase 2) adds a local
> FastEmbed model in a warm worker — still zero API cost, still offline after the
> one-time model download. The opt-in contradiction detector and the eval harness
> land in Phase 3 — see [Roadmap](#roadmap).

---

## What Phase 1 gives you

A statusline that beats a plain token counter:

- **Corrected context fill.** The raw `used_percentage` is measured against the
  full window, but Claude Code reserves a ~33k-token autocompact buffer you can't
  use. We report fill against the *usable* window, so the number hits 100% exactly
  when autocompaction fires — not at the hard limit. The corrected number is
  always higher than the raw one, which is the honest read.
- **Distraction detector.** Watches the recent tool-call stream for repetition
  (the "Pokémon failure mode" — the agent repeating past actions) and combines it
  with context fill. Either signal alone can warn.
- **Confusion detector.** Flags when too many tools are active (selection accuracy
  collapses past ~30) or the tool-error rate climbs.

The line stays green (and shows the fill %) until a detector trips, then turns
yellow or red and names the condition and a suggested action.

```
● ctx 24%                                      ← healthy, ambient
● confusion: 31 tools active                   ← yellow
● distraction: context 90% full                ← red
● goal drift: drifting from goal (46% similar) ← yellow (Phase 2)
```

**Goal-drift (Phase 2).** At the first prompt the session's goal is captured and
embedded (locally, 384-dim FastEmbed / BAAI/bge-small-en-v1.5). Each turn a warm
background worker embeds a rolling window of recent activity and measures its
cosine similarity to the goal — rising distance is drift. The goal-defining
prompt is excluded from the activity window so the goal isn't compared against
itself. A short goal is treated as a *weak anchor*, which raises the bar to fire
and cuts false alarms. All of this runs in a background process so the hooks and
statusline never load the model.

---

## Install

```
/plugin marketplace add s1ddh-rth/context-health
/plugin install context-health@context-health
```

**Prerequisites.** Node (bundled with Claude Code's environment) for the hooks
and statusline, and [`uv`](https://docs.astral.sh/uv/) for the Phase 2 worker.
The worker's Python environment is created and managed automatically by `uv` in
an isolated `.venv` — no global installs, no manual setup. The embedding model
downloads once (~90 MB) on first use, after which the tool is fully offline. If
`uv` or the model is unavailable, goal-drift simply stays quiet; distraction,
confusion, and the corrected context math keep working with zero dependencies.

The plugin ships its statusline registration in `settings.json`. If your Claude
Code version doesn't auto-apply a plugin's statusline, add this one line to your
own settings to point at the bundled renderer:

```json
"statusLine": { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/statusline/statusline.js\"" }
```

---

## How it works

Three native Claude Code primitives, wired through one shared state file.

| Primitive | Role |
|---|---|
| **Hooks** | `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` each drop a raw signal (a tool call, a prompt, an error flag) into the state file. Fast, observation-only, never block. |
| **Statusline** | The only place with live context metrics. Reads the state file, evaluates the detectors over the accumulated signals, renders one colored line. Read-only on state, so it stays fast. |
| **State file** | `~/.claude/context-health-state.json`, keyed by `session_id`. Hooks write raw signals; the statusline reads. Last write wins. |

Everything heavy is deferred. The observation hooks run `async` so Node's
start-up never blocks the session, and the detectors run over small bounded
arrays already in the state file, never by re-scanning the transcript. Because
async hooks (and, in phase 2, the warm worker) can write concurrently, every
state write takes a short cross-process lock, so no update is ever lost.

### Layout

```
context-health/
├── .claude-plugin/       manifest + marketplace manifest
├── hooks/hooks.json      registers the five lifecycle hooks
├── statusline/           the color-coded renderer entry point
├── monitors/             background-worker declaration (Phase 2)
├── bin/
│   ├── hooks/            one thin entry script per hook
│   └── lib/              tested pure logic (detectors, math, state, config)
├── worker/               Python warm worker (uv-managed, isolated .venv)
│   ├── context_health_worker/   embedder, drift, state_io, config, worker
│   └── tests/            pytest suite
├── settings.json         default config incl. all tunable thresholds
├── fixtures/             mock stdin payloads for testing scripts
└── test/                 node:test unit + integration tests
```

The worker reads the raw signals the Node hooks write, computes drift out of
band, and writes `computed.goalDrift` back — the two languages share the state
file (and its cross-process lock) but never call each other directly.

---

## Configuration

Every detector threshold is a **provisional default** (build-spec §5.6), tunable
without hard-coding. Resolution order (later wins):

1. Built-in defaults (baked into `bin/lib/config.js` — the tool works even with
   no config file).
2. The plugin's `settings.json`.
3. A user override at `~/.claude/context-health-config.json` — where phase-3
   slash commands will write tuned values, so you never edit plugin JSON by hand.

Key knobs (`detectors.distraction`, `detectors.confusion`):

| Setting | Default | Meaning |
|---|---|---|
| `repetitionRateYellow` / `Red` | 0.30 / 0.50 | share of recent tool calls that are repeats |
| `contextFillYellow` / `Red` | 50 / 85 | corrected fill % bands |
| `activeToolYellow` | 30 | active-tool ceiling before confusion warns |
| `toolErrorRateYellow` / `Red` | 0.05 / 0.10 | failed tool calls over the recent window |

`enabled: false` silences the plugin entirely; `muted: true` (global or
per-session) keeps the ambient fill but suppresses warnings.

---

## Development

```
npm test                       # Node: node:test, zero dependencies
cd worker && uv run pytest -q  # Python worker: pytest in the isolated env
```

Test any script the way Claude Code will invoke it — pipe a fixture on stdin:

```
node statusline/statusline.js < fixtures/statusline-healthy.json
node bin/hooks/pre-tool-use.js < fixtures/hook-pre-tool.json
```

Design rules the code holds itself to: hooks and statusline never crash (bad
input → fallback, always exit 0); scripts write only their own clean output to
stdout; the `Stop` hook checks `stop_hook_active` to avoid infinite loops; and
transcript/tool output is treated as untrusted text, never executed.

---

## Roadmap

- **Phase 1 — plumbing + free wins** *(done)*: scaffold, corrected context math,
  distraction + confusion detectors. Zero cost.
- **Phase 2 — the lead feature**: local FastEmbed embedding model in a warm
  worker, goal-drift detector.
- **Phase 3 — rigor + the opt-in detector**: eval harness (labeled corpus,
  LLM-judge scoring, adversarial threshold calibration), then the opt-in
  **contradiction** detector (LLM-judge on your own key or a local model, off by
  default) behind a slash command.
- **Phase 4 — reach**: desktop-app port, optional MCP companion.

## License

MIT
