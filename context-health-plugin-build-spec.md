# Context Health Detector for Claude Code — Build Spec

A real-time detector that watches a Claude Code session and flags the five ways context degrades, surfaced live in the terminal with a one-glance toggle. Local-first and zero-API-cost by default, with an opt-in paid tier for deep semantic checks.

Version 0.1 (working draft). All mechanics below were verified against current Claude Code docs and community sources as of July 2026. Where something is a design choice rather than a documented fact, it is flagged.

---

> **⚠️ Scope updated after this draft — read `CLAUDE.md` for the current design.** Two decisions supersede the text below:
> 1. **Four detectors, not five.** Research showed *clash* and *poisoning* collapse to the same local computation (contradiction detection), so they are merged into one **contradiction** detector. Everywhere this spec says "five failure modes" / "five detectors" / describes separate clash and poisoning heuristics (esp. §2.1, §5, §5.6, §13), treat it as historical — build the four: distraction, confusion, goal-drift, contradiction.
> 2. **Fully open-source, no paid tier.** The "opt-in paid tier" framing is dropped. The contradiction detector is opt-in and off by default; when enabled it runs an LLM judge on the *user's own* API key or a local model — never billed by this plugin.
> 3. **Path variable:** for a *plugin*, bundled script paths use `${CLAUDE_PLUGIN_ROOT}`, not `$CLAUDE_PROJECT_DIR` (see §9). The code is correct; the older prose in §9 is not.

---

## 1. What this is, in one paragraph

Everyone building on Claude Code today can see how *full* their context is. Nobody can see whether it has gone *bad*. This tool closes that gap. It classifies five distinct failure conditions as they happen (poisoning, distraction, confusion, clash, and goal-drift), tracks six underlying variables, and renders a color-coded health signal in the statusline that stays silent until something is actually wrong. The cheap detectors run on local heuristics and a small local embedding model with no API calls. The expensive semantic detector is opt-in and off by default, which is what keeps token cost flat for the normal user.

---

## 2. The problem, grounded in the research

### 2.1 The five conditions worth detecting

The reference taxonomy is Drew Breunig's four failure modes, which the field now treats as canonical. To those we add goal-drift, which lives in a separate body of work but is the condition with the least existing tooling and the one worth leading on.

| Condition | Plain definition | Root proxy signal |
|---|---|---|
| Poisoning | A hallucination or error enters context and gets referenced again and again, so the model reasons on a false premise | A fact that entered via a tool result keeps being cited after being contradicted |
| Distraction | Context grows so long the model over-focuses on its own history and repeats past actions instead of reasoning fresh | Length plus action-repetition rate |
| Confusion | Superfluous content or too many tools pull the model toward a low-quality or wrong choice | Active tool count and wrong-tool or malformed-parameter patterns |
| Clash | New information or tools contradict something already in the prompt | Contradiction markers between sources in context |
| Goal-drift | The session started aimed at X and is now doing Y, without anyone deciding to change course | Rising cosine distance between the stated goal and recent activity |

The honest framing, and it helps the product rather than hurting it, is that these are not five independent diseases. They are five symptoms of one condition, which is attention-budget exhaustion plus contamination. That is why most of the signal can come from cheap proxies before a single token is spent on semantic analysis.

### 2.2 The evidence base

- Anthropic's position is that LLMs have a finite attention budget that depletes with every token, because the transformer creates n-squared pairwise relationships, so attention gets stretched thin as length grows. Their remedies are compaction, structured note-taking, and sub-agent architectures. (Effective context engineering for AI agents, Sep 2025.)
- Chroma's Context Rot report is the empirical backbone. Across 18 frontier models including the 1M-token ones, every single model degraded with length. Accuracy dropped 30-plus points when the relevant fact sat mid-context, with a 7.9 percent floor loss from length alone. A counterintuitive finding is that coherent document structure hurt more than shuffled distractors. A practical cap that teams now ship with is roughly 25 to 30 percent of the advertised window, since RULER-style checks put usable context nearer 50 to 65 percent of advertised.
- Google DeepMind supplied the clearest distraction anecdote. The Pokemon-playing Gemini agent started repeating actions from history once context passed about 100k tokens, despite a 1M-plus window.
- The confusion threshold has a number, but treat it as a conservative floor, not a law. A single anecdote (a *quantized* Llama 3.1 8b on an edge device) failed with 46 tools but succeeded with 19; the figure "30" does not appear in that source and does not generalize to frontier models like Claude, which tolerate far more (often 50–100+). See `docs/METHODOLOGY.md`.
- Drift has measured incidence. One 2026 analysis found semantic drift in nearly half of multi-agent workflows by around 600 interactions, while task drift dropped to near-zero with the right design.

---

## 3. Competitive landscape and the exact gap

Existing tooling clusters into three groups, and none of them do semantic health classification.

**Token and context-fill monitors.** Claude HUD is the proof the delivery surface works and that people want it. It hit around 9,000 GitHub stars, renders a persistent color-coded context bar below the input, and reads existing session data rather than making extra API calls, so overhead is negligible and it refreshes near 300ms. But it only counts and displays. It says the tank is full, not that the fuel is contaminated. Others in this group are ccstatusline, claude-code-usage-bar, and claude-lens.

**Observability dashboards.** Claude-Code-Agent-Monitor and agent-flow tail the transcript JSONL and visualize tool calls, timelines, and subagent orchestration. They make the black box visible but pass no judgment on health.

**Task and workflow trackers.** Claude-Project-Tracker, Task Orchestrator, and the fractal recursive planner enforce structure but do not detect drift from intent.

The single closest neighbor is a "session intelligence" tool that reads the projects JSONL to surface token waste, CLAUDE.md adherence failures, and attention-curve degradation, read-only with zero telemetry. That is the nearest thing to this idea, but it is post-hoc analysis and its adherence check is rule-matching, not live semantic classification of the five conditions.

**The gap.** Nobody is doing real-time semantic detection of poisoning, distraction, confusion, clash, and goal-drift, surfaced live, with an effortless toggle. That is the whole opportunity.

---

## 4. Architecture decision — a plugin, not an MCP server

Our earlier working assumption was an MCP server. The research updates that. Build this as a **Claude Code plugin**, because Claude Code has native primitives that fit this exact job far better than MCP, and the plugin path solves the local-versus-remote cost worry cleanly.

Why a plugin over an MCP server, in one line each. A plugin runs in-process with the host, can hook agent lifecycle events, ship a custom statusline renderer, and register background monitors. An MCP server exposes portable tools over a protocol but has no native access to session lifecycle, the statusline, or live context metrics. This tool needs the latter, so it is a plugin. If a portable tool surface is ever wanted later, an MCP server can be added alongside, but it is not the core.

### 4.1 The three native primitives that do the work

1. **Hooks** are the event triggers. They fire at defined points and the handler reads JSON on stdin and can return a decision or inject context. The events that matter here are SessionStart and SessionEnd (once per session), UserPromptSubmit and Stop (once per turn), and PreToolUse and PostToolUse (every tool call). UserPromptSubmit and SessionStart are special because whatever the hook prints to stdout is added to what Claude sees, and a hook can also return a `systemMessage` that is shown to the user. Hooks support `async: true` to run in the background without blocking, and an HTTP transport if a warning ever needs to reach a remote service.

2. **Statusline** is the live surface. Claude Code pipes a JSON object to the statusline script on each update, including `context_window.used_percentage` and `session_id`, and whatever the script prints to stdout renders in the terminal. This is where the color-coded health signal lives.

3. **Plugin background monitors** are the newer piece and they matter for warnings. A plugin can declare a monitor that Claude Code starts automatically when the plugin is active. It runs a shell command for the session lifetime and delivers every stdout line to Claude as a notification. This is a cleaner way to push a real alert than trying to cram it into the statusline. It requires Claude Code v2.1.105 or later and runs unsandboxed at the same trust level as hooks.

### 4.2 Shared-state design

Copy the proven pattern from the context-recovery community tooling. Hooks and the statusline never talk to each other directly. Each hook writes signals to a small local state file, the statusline reads that file and renders, and nothing blocks the main loop. Statusline scripts must be fast, so the rule is enqueue-and-process-async. A hook drops a raw signal in under a few milliseconds, and any heavier work happens out of band.

Suggested state file at `~/.claude/context-health-state.json`, keyed by `session_id`, holding the six variables plus the current worst-condition flag and its severity.

### 4.3 Plugin layout

```
context-health/
├── .claude-plugin/
│   ├── plugin.json          # manifest (name, version, author, repository as a string URL)
│   └── marketplace.json     # marketplace manifest for distribution
├── hooks/
│   └── hooks.json           # registers SessionStart, UserPromptSubmit, Post/PreToolUse, Stop
├── monitors/                # background monitor for red-level alerts
├── skills/                  # slash-command surface for config in plain language
├── statusline/              # the color-coded renderer
├── bin/                     # the detector logic (embedding model, heuristics)
├── settings.json            # default settings applied on plugin enable
└── README.md
```

Install path for users is two commands. `/plugin marketplace add <user>/context-health` then `/plugin install context-health@<marketplace>`. All component paths must be relative and start with `./`, and the manifest is technically optional but worth including for metadata.

---

## 5. The five detectors, ranked by how doable they are

Ship them in this order. The ordering is deliberate, cheapest and most certain first, so there is a useful tool in the world after phase one and the expensive parts come only once the plumbing is proven.

### Tier A — free, local, no model. Ship first.

**Distraction detector.** Mostly a length-and-repetition signal. Context percentage comes straight from the statusline JSON. Add an n-gram or action-repetition check over the recent transcript and flag when tool calls or actions start repeating. This catches the Pokemon failure mode with zero API cost. Default warning band around the point where usable context is thinning, informed by the 25 to 30 percent effective-window research rather than the raw window size.

**Confusion detector.** Mostly structural. Count active tools against a conservative ~30-tool floor (a small-model heuristic, not a Claude-calibrated threshold — see `docs/METHODOLOGY.md`) and watch the tool-call stream for wrong-tool selection and malformed parameters. No semantic model needed.

### Tier B — free, local, small embedding model. Ship second.

**Goal-drift detector.** At SessionStart, capture the stated goal and embed it. On each turn, embed a rolling window of recent activity and track cosine distance from the original goal vector. Rising distance over turns is the drift signal. Runs on a small local embedding model with no API cost. This is the lead feature because it has the least competition and it was the original idea that started this whole thread.

**Clash and poisoning, heuristic pass.** Watch for contradiction markers, track when an early stated constraint stops being honored, and flag when a tool-sourced fact keeps getting referenced after being contradicted. Still local, still no API, though lower precision than the semantic tier.

### Tier C — opt-in, paid, off by default.

**LLM-as-judge for clash and poisoning.** For ambiguous cases only, let the user point the detector at their own Claude API key or a local model to run a real semantic pass. This is the only tier that costs tokens, so it is off by default and the user enables it knowingly. This structure is the cost-control answer. Free and local by default, precise and paid on demand. The key runs on the user's own account, so the user pays Anthropic directly and we never act as a billing middleman. Read the key from the Claude Code credential store the user already has, never ask them to paste it.

### 5.6 Detector math (starting defaults, calibrate in phase 3)

Every number below is a provisional default, not a measured truth. Ship these in `settings.json` so they are user-tunable, then replace them with calibrated values once the eval harness exists (section 7). Do not hard-code them in the detector logic.

**Distraction.** Take the last 20 tool calls from the transcript. A call counts as a duplicate when its tool name matches an earlier recent call and its normalized parameters are the same or near-identical. Repetition rate is duplicate calls divided by total recent calls. Combine with context fill. Flag yellow when repetition rate is above 0.30 or usable context fill (after the 33K buffer subtraction) passes the effective-window band around 50 percent. Flag red when repetition rate is above 0.50 or context fill is deep into the danger zone above roughly 85 percent. The two signals are OR-combined, since either one alone is a reason to warn.

**Confusion.** Track two numbers. Active tool count is a running count of distinct tools available in the session. Tool-error rate is malformed or non-existent tool calls divided by total calls over the last 10 calls, where a call is malformed if its parameters fail the tool's own schema or it names a tool not in the registry. Flag yellow when active tools exceed 30 or tool-error rate is above 0.05. Flag red when tool-error rate is above 0.10.

**Goal-drift.** Capture the goal once at SessionStart from the first user prompt and embed it to a 384-dimension vector with FastEmbed. Each turn, embed a rolling window of recent activity, meaning the last 3 to 5 user prompts plus the latest assistant turn, as one combined string. Compute cosine similarity between the recent-activity vector and the goal vector. Cosine similarity is the dot product of the two vectors divided by the product of their magnitudes, giving a value from -1 to 1 where 1 is identical meaning. Flag yellow when similarity falls below 0.70. Flag red when it falls below 0.50. Only fire after at least 3 turns, so early exploratory turns do not trip it. If the first prompt is under a small token count, fall back to embedding the first 3 turns combined as the goal and mark the anchor as weak, which raises the flag thresholds slightly to cut false alarms.

**Clash, heuristic.** Maintain a list of stated constraints and decisions pulled from user prompts and assistant commitments, using simple markers like "use X", "do not X", "never", "always", "instead of". A clash event is a later statement or tool action that negates an earlier active constraint. Contradiction rate is clash events per turn over a rolling window. Flag yellow above one clash per 10 turns, red above one per 5 turns.

**Poisoning, heuristic.** Tag facts that enter via tool output as grounded. A poisoning event is a later assistant claim that contradicts a grounded fact, or a grounded fact that was misread and then reused. Count these the same way as clashes. Flag yellow at one event, red at two or more within the recent window, since poisoning is rarer and more serious than drift.

**Severity roll-up.** The statusline shows the single worst condition. Overall color is red if any detector is red, yellow if any is yellow, otherwise green. The one-line alert on a red event names the condition and the suggested action, usually to compact now or start a fresh session and reload.

---

## 6. The dashboard — six variables

These six are what the tool tracks and surfaces. Five compute with zero API cost.

| Variable | What it measures | Source | Cost |
|---|---|---|---|
| Context fill percent | How full the usable window is | statusline JSON, adjusted for the autocompact buffer | free |
| Turns since goal set | How long since the last explicit objective | SessionStart plus turn counter | free |
| Drift distance | Cosine distance of recent activity from the goal vector | local embedding model | free |
| Active tool count | Tools live against the confusion threshold | tool registry at turn time | free |
| Repetition rate | How often recent actions or tool calls repeat | transcript n-gram scan | free |
| Contradiction count | Conflicting facts detected in context | heuristic pass, optionally semantic | free, or paid in Tier C |

---

## 7. Evals — how to measure the variables you manage

This is where the tool can be more rigorous than anything currently in the space, which is the credibility differentiator. Everyone else counts tokens. Nobody proves their detector is right.

### 7.1 Detector accuracy

Treat each of the five conditions as a binary or graded classification against a labeled set. Label a corpus of real transcripts for whether each condition actually occurred, have the detector predict, and report precision and recall per condition. The established method, from LongMemEval, is to use an LLM as judge for the labels, and note that GPT-4o as judge reached over 97 percent agreement with human experts, while also grounding against evidence with recall and NDCG where retrieval traces exist.

Tune toward **precision over recall**. A noisy detector that cries wolf gets switched off, so a false positive costs more than a missed detection in this product. Target few false alarms even at the cost of some misses.

### 7.2 Threshold calibration, adversarially

Each threshold should be a measured number, not a guess, and the method is simple enough to run in-house. Per model, run three injections.

- Overload the context and find the token count where quality drops. That is the distraction threshold.
- Inject two conflicting facts and see which one the model uses. That is the clash exposure.
- Remove a key fact and see whether the model admits it does not know or hallucinates to fill the gap. That is the poisoning risk.

Run these per model, since thresholds differ across models.

### 7.3 Validate against established benchmarks

Do not reinvent the degradation curve. Validate against RULER for retrieval and multi-hop at length, LongMemEval for the multi-session write-and-retrieve loop, and Chroma's Context Rot suite for position-and-length effects. LongMemEval's abstention task, questions about events that never happened graded on correct refusal, is the cleanest existing proxy for poisoning and can be borrowed directly.

---

## 8. Delivery and UX

### 8.1 Where it lives

CLI first. That is where the hook, statusline, and monitor machinery is native, and where the audience that feels this pain lives. Claude HUD proved the surface works and is CLI-only. The chat and desktop-app ports come later and are harder because they lack the same native hook access, so leading with them would be building on weaker ground. Worth noting the desktop app reads the same settings.json tree as the CLI, so a good deal of the config layer carries over when that port comes.

### 8.2 The ambient signal

The default experience is a color-coded statusline that stays silent until something is wrong. Green when the six variables are healthy, yellow as they approach thresholds, red when a condition fires. This mirrors the convention users already know from Claude HUD, roughly green below 70 percent, yellow 70 to 85, red above. Glanceable, non-intrusive, respects flow.

### 8.3 The one allowed interruption

A genuine red event is the only moment the tool speaks up. Route that through a plugin background monitor, which pushes a single-line notification to Claude, or through a UserPromptSubmit hook that injects a short `systemMessage` shown to the user. Keep it to one line naming the condition and the suggested action, usually to compact or start fresh.

### 8.4 The toggle, on three levels

- Coarse on-off is plugin enable-disable, one command.
- In-session, the statusline color is the ambient control and needs no interaction.
- Config that should never require editing JSON becomes plain-language slash commands, shipped as skills in the plugin. Things like turning on the paid LLM-judge tier, tuning a threshold, or choosing which detectors are live. The precedent is a popular statusbar plugin that lets users say "switch theme to nord" and routes it to the right command. Default settings ship in the plugin's settings.json and apply on enable, so the tool is useful the moment it is installed with no setup.

---

## 9. Context math gotcha to bake in

The context percentage is not naive. The `remaining_percentage` field includes a fixed autocompact buffer of about 33,000 tokens. To show true free-until-autocompact rather than free-until-hard-limit, subtract that buffer.

```js
const AUTOCOMPACT_BUFFER_TOKENS = 33000;
const autocompactBufferPct = (AUTOCOMPACT_BUFFER_TOKENS / windowSize) * 100;
const freeUntilCompact = Math.max(0, pctRemainTotal - autocompactBufferPct);
```

> **Implementation note (supersedes the snippet above).** `bin/lib/context-math.js` reports fill against the *usable* window instead: `fillPercent = usedTokens / (windowSize - buffer) * 100`, which reaches 100% exactly at the autocompact boundary (the sketch above never reaches 100%). That is the number the statusline and distraction detector consume.

Also use the `${CLAUDE_PLUGIN_ROOT}` prefix for all bundled hook, statusline, monitor, and skill script paths — a bare relative path throws a module-not-found error once the working directory moves, and `$CLAUDE_PROJECT_DIR` points at the user's project rather than the installed plugin.

---

## 10. Lessons from developers who already shipped hooks and statuslines

These are hard-won failure modes from people who built context tooling, formatting hooks, and statuslines in public. Follow them so we do not relearn them.

**Hooks**

- Stop-hook infinite loops. A Stop hook that makes Claude continue can re-fire itself forever. Always check `stop_hook_active` at the top of a Stop or SubagentStop handler and exit 0 when it is true. Every developer learns this one the hard way, so we learn it for free.
- PreToolUse prevents, PostToolUse only reacts. By the time PostToolUse fires the file is already written, so it cannot undo anything. Use PreToolUse for anything that must block, PostToolUse for observation.
- Do not let two hooks fight over the same field. If multiple PreToolUse hooks rewrite the same tool input, the order is non-deterministic. Keep one writer per field.
- `additionalContext` has a 10,000 character cap and goes stale on resume. Time-sensitive values belong in SessionStart, which re-runs on resume with source set to "resume", not in per-turn hooks whose saved output just gets replayed.
- Shell profile pollution breaks JSON. An unconditional echo in a shell rc file lands in the hook's stdout and corrupts the JSON the hook is supposed to emit. Wrap any interactive shell output in an interactive-shell guard, and have our scripts write only their own clean JSON to stdout.
- Hooks still run under bypass mode. A PreToolUse deny fires even under the skip-permissions flag, which is good for safety guards but also means our hooks must never assume a permission prompt will gate them.

**Statusline**

- It must be boringly fast and boringly defensive. The statusline command runs on every update. If it shells out to git, reads package metadata, and computes a big summary each time, the whole interface feels sluggish. Prefer fields Claude Code already sends over recomputing anything, and cache any expensive check.
- Not every field appears for every account, version, or route. Print sensible fallback text instead of crashing when a field is missing. A blank or erroring statusline is worse than a partial one.
- If it is slow or stale, isolate the layer. Run the script by hand with mock JSON on stdin first. Fast outside but stale inside points at trust, path, or update-trigger issues rather than the script itself.
- Windows and Git Bash are the usual break point. Shell and path behavior differ, so test the exact command through the exact shell Claude Code will invoke. This matters for our target environment specifically.

**CLAUDE.md and instructions**

- CLAUDE.md is advisory, hooks are deterministic. The model treats CLAUDE.md as context it may or may not apply, so anything that must always happen goes in a hook, not in prose.
- Keep it small or it gets ignored. Frontier models reliably follow on the order of 150 to 200 instructions and Claude Code's own system prompt already spends some of that budget. Teams that ship this well keep CLAUDE.md well under a few hundred lines and move detail into skills. Put only what the model would otherwise get wrong.
- The 60 to 70 percent "dumb zone" is practitioner folklore, not a benchmarked finding, and we do NOT treat it as validation (see `docs/METHODOLOGY.md`). Practitioners report that once context passes 60 to 70 percent the model starts ignoring instructions and making basic errors, and some compact manually at 50 percent rather than waiting for auto-compaction. It is a directional hint for the yellow band only; the real thresholds come from the eval harness, not this anecdote.

---

## 11. Runtime and environment — the Docker and venv question, answered

Short answer. No Docker. A `uv`-managed Python environment plus a small Node or shell layer for the fast glue. Here is the reasoning so Claude Code can build it without guessing.

**Do we need Docker.** No, and we should actively avoid it. Docker would force the user to have a daemon running and would make a terminal plugin feel heavy, which defeats the whole point of a glanceable local tool. The only things we run are a small embedding model and some text heuristics, neither of which needs containerization.

**Do we need a virtual environment.** Yes for the Python part, but do not make the user hand-build one. Use `uv`, which creates and manages an isolated environment automatically and runs cross-platform including on Windows. The established pattern in this ecosystem is to invoke the Python detector with `uv run` from the hook or statusline config, so the environment is handled transparently. This is how other Claude Code Python tooling ships.

**Which embedding model.** FastEmbed with its default BAAI/bge-small-en-v1.5. It runs on the ONNX runtime with no PyTorch and no CUDA, needs no GPU, is CPU-optimized, produces 384-dimension vectors, and its quantized default reportedly beats OpenAI ada-002 on quality. Dependencies are minimal, which keeps install fast and disk use low. The model downloads and caches on first use, so the plugin needs network access exactly once at first run, after which it is fully offline. For a fully air-gapped install we can vendor the ONNX model file and point FastEmbed at the local path.

**The latency trap, and the fix.** Loading the embedding model on every turn would make a per-turn hook slow, which is the cardinal statusline and hook sin from section 10. The fix is a warm worker. A small background process, started as a plugin monitor, keeps FastEmbed loaded in memory for the session lifetime. The fast hooks and the statusline never load the model. They write the text to embed into the shared state file or a local socket, the warm worker computes the vector and the drift distance out of band, and the statusline just reads the already-computed number. This mirrors the enqueue-and-process-async pattern proven in the memory tooling, where hooks stay under a few milliseconds and heavy work happens in the worker.

**Language split.** Statusline renderer and the lightweight hooks in Node, because JSON parsing is native and there is no jq dependency to worry about across platforms. The embedding and drift math in Python via `uv run` and FastEmbed. The warm worker in Python since it owns the model. The shared state file is the contract between them, so the two languages never need to call each other directly.

**No jq.** Do not depend on jq. Parse the incoming JSON with the runtime's native parser (Node or Python), since jq is an extra install that community scripts repeatedly get bitten by, especially on Windows.

---

## 12. Questions Claude Code will hit while building this, answered

This section exists so the CLI can build autonomously. Each item is a question it would otherwise stop and ask.

- **What is the entry data for a turn.** Hooks receive JSON on stdin. The common fields are `session_id`, `transcript_path`, `cwd`, and `hook_event_name`. UserPromptSubmit adds `prompt`. PreToolUse adds `tool_name` and `tool_input`. PostToolUse adds `tool_output`. SessionStart adds `source` with values like startup, resume, clear, compact.
- **Where do live context metrics come from.** Only the statusline receives them. The statusline JSON on stdin includes `context_window.used_percentage` and token fields, plus `model.display_name`, `cwd`, `session_id`, and cost and rate-limit blocks. Read the percentage from here, then subtract the 33K autocompact buffer as shown in section 9.
- **How do we read the full conversation.** Open the file at `transcript_path`. It is JSONL, one message per line, and includes tool calls and `message.usage` token accounting. Parse it for repetition-rate and tool-count signals. Do not re-read the whole file every turn, track a byte offset and read only new lines.
- **Where does session state live.** A single JSON file at `~/.claude/context-health-state.json`, keyed by `session_id`, holding the six variables, the goal vector reference, the current worst condition, and its severity. Last write wins, so only the worker writes computed fields and only hooks write raw signals.
- **How do we capture the goal.** On SessionStart with source startup, take the first user prompt of the session as the stated goal and have the worker embed it. If the first prompt is thin, fall back to embedding the first two or three turns combined. Store the goal vector once and do not recompute it unless the user runs a reset command.
- **How do we test without a live session.** Pipe mock JSON into each script. For the statusline, echo a fixture with a `context_window.used_percentage` and a `session_id` and confirm the rendered line. For hooks, echo the matching event fixture and confirm the state file updates. Build a fixtures folder of representative turns before wiring anything into settings.
- **How do we package it.** A `.claude-plugin/plugin.json` manifest with name, version, author, and a repository string URL, plus `.claude-plugin/marketplace.json` for distribution. Components sit at the plugin root in `hooks/`, `statusline/`, `monitors/`, `skills/`, and `bin/`, and default config goes in `settings.json` which applies on enable. Install is `/plugin marketplace add <user>/<repo>` then `/plugin install <name>@<marketplace>`.
- **How do we ship the on-off and settings without JSON editing.** As slash commands implemented as skills in the plugin. One to toggle the paid Tier-C judge, one to set thresholds, one to reset the goal anchor, one to mute for the current session. Defaults ship in settings.json so the tool works immediately on install.
- **How do we avoid blocking.** Fast scripts only in hooks and statusline, all heavy work in the warm worker, communication through the state file. Add `async: true` to any hook that does more than write a raw signal. Keep every hook and statusline invocation well under the point a user would notice.
- **What breaks on resume.** SessionStart re-runs with source resume, so refresh anything time-sensitive there. Do not rely on per-turn hook output surviving a resume, since it is replayed rather than regenerated.
- **What are the safety limits.** Monitors and hooks run unsandboxed at the user's trust level. Write only inside the plugin directory and the state file, never execute arbitrary transcript content, and treat tool output in the transcript as untrusted text, not as instructions.

---

## 13. Phased roadmap

**Phase 1 — the plumbing and the free wins.** Plugin scaffold, shared-state file, statusline renderer with the corrected context math, and the two Tier-A detectors (distraction and confusion). Outcome is a genuinely useful, zero-cost tool that already beats pure token counters.

**Phase 2 — the lead feature.** Add the local embedding model and the goal-drift detector, plus the heuristic clash and poisoning pass. Outcome is the thing nobody else ships.

**Phase 3 — rigor and the paid tier.** Build the eval harness (labeled corpus, LLM-judge scoring, the three adversarial calibrations), then add the opt-in Tier-C semantic judge behind a slash-command toggle. Outcome is a tool with measured accuracy, which is the pitch.

**Phase 4 — reach.** Port the surface to the desktop app and explore a portable MCP-server companion for non-Claude-Code clients.

---

## 14. Honest caveats and open questions

- **The semantic tiers are the unproven part.** Distraction and confusion are close to certain to work because they lean on structural signals. Goal-drift via embeddings is plausible and well-motivated but the precision is unknown until tested. Clash and poisoning are the hardest and may need the paid tier to be reliable. Do not oversell the local semantic detectors before the eval numbers exist.
- **Drift distance needs a good goal anchor.** If the user never states a clear objective at the start, the goal vector is weak and drift detection degrades. A fallback is to infer the goal from the first few turns, but that is itself a small semantic task.
- **False-positive fatigue is the main product risk.** Precision tuning is not optional. One too many wrong red alerts and the tool gets uninstalled.
- **Monitors and hooks run unsandboxed at user trust level.** Be conservative about what the detector executes, since users are handing it the same access their shell has.
- **Thresholds are model-specific and will drift as models change.** The calibration harness is not a one-time job. Plan to rerun it per model and per major Claude Code release.

---

## 15. Key sources

- Anthropic, Effective context engineering for AI agents, Sep 2025.
- Chroma, Context Rot report (18-model degradation study).
- Drew Breunig, How Long Contexts Fail and How to Fix Your Context (the four-mode taxonomy).
- Claude Code docs, Hooks reference, Customize your status line, Plugins reference.
- Claude HUD, ccstatusline, and the context-recovery hook pattern (delivery-surface precedent and the shared-state design).
- Developer field notes on hook and statusline gotchas (Thomas Wiegold, claudefast, LaoZhang), and CLAUDE.md sizing practice (HumanLayer, Boris Cherny compounding-engineering notes).
- FastEmbed by Qdrant (local ONNX embedding runtime, BAAI/bge-small-en-v1.5 default).
- LongMemEval and RULER (eval methodology and benchmarks).
- DeepMind Gemini 2.5 technical report, via the Pokemon-agent distraction observation.
