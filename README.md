# Context Health Detector for Claude Code

Everyone can see how *full* their context is. Nobody can see whether it has gone
*bad*. This Claude Code **plugin** watches a session live and flags the five ways
context degrades — **poisoning, distraction, confusion, clash, and goal-drift** —
surfaced as a color-coded health signal in the statusline that stays silent until
something is actually wrong.

Local-first and **zero API cost by default**. The cheap detectors run on local
heuristics; the expensive semantic tier is opt-in and off by default.

> **Status: Phase 1 shipped.** Corrected context math + the two Tier-A detectors
> (distraction, confusion) run locally with no model and no API calls. Goal-drift,
> clash/poisoning, the eval harness, and the paid tier land in later phases — see
> [Roadmap](#roadmap).

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
● ctx 24%                              ← healthy, ambient
● confusion: 31 tools active           ← yellow
● distraction: context 90% full        ← red
```

---

## Install

```
/plugin marketplace add s1ddh-rth/context-health
/plugin install context-health@context-health
```

Requires Node (bundled with Claude Code's environment). Phase 1 has **zero
runtime dependencies** — no Python, no model, no network.

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
├── bin/
│   ├── hooks/            one thin entry script per hook
│   └── lib/              tested pure logic (detectors, math, state, config)
├── settings.json         default config incl. all tunable thresholds
├── fixtures/             mock stdin payloads for testing scripts
└── test/                 node:test unit + integration tests
```

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
npm test          # node:test, zero dependencies
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
  worker, goal-drift detector, heuristic clash + poisoning.
- **Phase 3 — rigor + paid tier**: eval harness (labeled corpus, LLM-judge
  scoring, adversarial threshold calibration), then an opt-in Tier-C semantic
  judge behind a slash command.
- **Phase 4 — reach**: desktop-app port, optional MCP companion.

## License

MIT
