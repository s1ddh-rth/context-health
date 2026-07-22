# You can see how *full* your context is. You can't see when it's gone *bad*.

Building Context Health Detector for Claude Code — the idea, the research, the architecture, and an honest accounting of what works and what doesn't yet.

---

## The idea

Every AI coding tool shows you a context meter: a percentage, a token count, a little bar that fills up. It answers exactly one question — *how much room is left?* — and it answers it in a way that's subtly wrong (more on that later).

But "how full" is not the question that actually bites you in a long session. The question that bites you is *has the context gone bad?* Because context doesn't just fill — it **degrades**, and it degrades in distinct, recognizable ways:

- The model starts **repeating** past actions instead of reasoning fresh (the "Pokémon" failure mode — it keeps doing the thing that didn't work).
- It gets **confused** by too many tools or a rising rate of failed calls.
- It quietly **drifts** off the goal you started with — you asked for auth, and three hours later you're deep in a logging refactor nobody decided to do.
- It **contradicts** itself, carrying a bad fact forward through every compaction.

A token counter is blind to all of that. So the idea was a **plugin that watches a session live and flags *which* failure mode is happening** — a color-coded health signal in the statusline that stays silent until something is actually wrong. Local-first, zero API cost by default, fully open source.

The taxonomy came from Drew Breunig's writing on how long contexts fail, originally five modes. During research one thing collapsed: "clash" and "poisoning" turn out to be the same local computation (contradiction detection), so five became **four** — distraction, confusion, goal-drift, contradiction. Naming the failure modes precisely is half the product; the other half is detecting each one with a signal you can actually compute.

---

## The research

The detectors are only as good as the thresholds behind them, so the starting point was the literature on long-context degradation:

- **Context rot** (Chroma) — model reliability degrades as input grows, in *non-uniform*, task-dependent ways. Notably, it found Claude models have the *lowest* hallucination rates and tend to abstain when uncertain.
- **RULER** (Hsieh et al.) — "effective context" is often a fraction of the advertised window; roughly half the tested models hold up at 32K.
- **Tool overload** — a study showing a small quantized model failing at 46 tools but succeeding at 19, i.e. too many tool choices collapses selection accuracy.
- **Embedding-based drift** — cosine similarity between a stated goal and recent activity as a proxy for "are we still on task."

Here's the honest part, and it became the spine of the whole project: **most of that evidence is on small, non-Claude models, on tiny samples.** RULER predates Claude; the tool-overload number is a single anecdote on a quantized 8B on an edge device; the "compact at 50%, dumb zone at 60–70%" figures are practitioner folklore, not benchmarks. Taking those numbers and shipping them as production defaults for a 200K Claude model is an extrapolation — and pretending otherwise would be dishonest.

So the research didn't stop at "find the numbers." It included a later phase of **auditing our own numbers** — which turned out to be the most valuable research we did, and I'll come back to it.

---

## The architecture

The first real decision was *what shape* this is. It's a **plugin, not an MCP server** — it observes and renders; it doesn't want to be a tool the model calls. That maps cleanly onto three native Claude Code primitives wired through one shared file:

```
Hooks ──(raw signals)──▶  state.json  ◀──(reads)── Statusline
  │                          ▲
  └── per-turn events        │ (computed fields)
                             │
                    Warm worker (background)
                    keeps the embedding model loaded
```

- **Hooks** (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`) each drop a *raw* signal — a tool call, a prompt, an error flag — into a shared state file at `~/.claude/context-health-state.json`, keyed by `session_id`. They're observation-only and must be fast (a few milliseconds); anything non-trivial is marked `async` so it never blocks the session.
- **The statusline** is the only place with live context metrics. It reads the state file, evaluates the detectors over the accumulated signals, and renders one colored line. It's read-only on state, so it stays fast and defensive — a missing field renders fallback text, never a crash.
- **A warm worker** (a background "monitor") is where the heavy lifting lives. It keeps a small embedding model resident for the whole session so the per-turn hooks never load a model. It computes goal-drift out of band and writes the result back into the state file.

The division of labor is the load-bearing idea: **fast glue, heavy worker, one shared file, last-write-wins.** Only the worker writes computed fields; only hooks write raw signals.

The language split follows from that. Glue (hooks, statusline) is **Node** with native JSON — no `jq`, no dependencies, instant startup. Embeddings and drift math are **Python via `uv`**, using **FastEmbed** with `BAAI/bge-small-en-v1.5` (a ~67 MB quantized ONNX model) — no PyTorch, no CUDA, no Docker. The Python environment is created and managed automatically; the model downloads once and then the tool is fully offline.

One architectural detail worth calling out because it's the honest number: **corrected context fill.** The raw `used_percentage` is measured against the *full* window, but Claude Code reserves an autocompact buffer at the top you can't actually use. So the meter that matters is fill against the *usable* window — it should hit 100% exactly when autocompaction fires, not at the hard limit. That correction is the whole "beat a plain token counter" claim, and it's the first thing the statusline shows.

---

## How it was implemented

Each detector is a pure function reading config-driven thresholds (never hard-coded — they live in `settings.json` so they're tunable):

- **Distraction** — over the last N tool calls, a repetition rate (duplicate name+params ÷ total), OR-combined with the corrected fill. Either signal alone can warn.
- **Confusion** — active tool count against a threshold, plus the tool-error rate over a recent window. Worst signal wins.
- **Goal-drift** — the goal is captured at the first prompt and embedded once; each turn the worker embeds recent activity and measures cosine similarity to the goal. Rising distance is drift.
- **Contradiction** — opt-in and **off by default**. When enabled it runs an NLI-style check on the user's *own* API key or a local model. It is never a billed tier; it costs nothing until you turn it on.

The philosophy running through all of it is **precision over recall: a false alarm is worse than a miss.** A tool that cries wolf gets muted, and a muted tool detects nothing. So every band leans conservative, and the loudest detector (contradiction) is the one that's off by default.

Two implementation lessons were paid for the hard way:

**1. Portability is a runtime problem, not a code problem.** The plugin worked perfectly on the dev machine and then failed on a fresh Fedora laptop with `node: command not found` (exit 127) on every turn. The cause: Claude Code runs hooks in a *non-interactive* shell that doesn't source `nvm`/`fnm`, and the standalone Claude Code installer ships no `node` at all. The fix was to route all glue through small POSIX launchers that resolve the runtime from `PATH` and common install locations, and — crucially — **degrade silently** when it's genuinely absent instead of spamming errors. The design principle "optional features stay quiet" had to extend to "missing runtime stays quiet" too.

**2. A plugin can't register a global statusline.** Claude Code only honors a statusline in the *user's own* settings, and it won't expand plugin path variables there. So the tool ships a one-time setup command that wires the user's settings to a stable, update-proof copy of the renderer — additive, backed up, and refusing to overwrite an existing custom statusline. A fresh install also nudges once so it never looks silently broken.

---

## What else was taken into account — and how well it was executed

A few things beyond "make the detectors work" that shaped quality:

- **No paid tiering.** It's fully open source; the only optional cost (contradiction detection) runs on your own key or locally. There is no upsell.
- **Untrusted input discipline.** Transcript and tool output are treated as untrusted text, never as instructions; the renderer strips control/escape characters so nothing can inject into the statusline. The plugin writes only inside its own directory and the state file.
- **Cross-platform reality.** Windows + Git Bash is a first-class target, tested on the actual shell, with attention to path and line-ending gotchas.
- **An eval harness with labeled fixtures**, so the claim "beats a token counter" is measured (precision/recall on classified fixtures), not asserted.

But the execution decision I'm proudest of is **how the thresholds were vetted.** Rather than trust the initial research numbers, the detector math went through a multi-agent audit: three reviewers with distinct lenses (an embeddings specialist, a statistics/systems reviewer, an empirical-claims skeptic), then a **fact-checker** that verified every claim against the code *and* the primary sources, then an **adversarial tester** on the fixes. The fact-checker even caught the reviewers' own mistakes — one wrongly claimed a study excluded Claude; another over-stated a range — so only *verified* defects were acted on.

That audit found real, shipped bugs:

- The autocompact buffer was a **flat 33k regardless of window size**, which badly overstated usable space on 1M-context models (where autocompaction fires far earlier). Fixed to scale with the window.
- The corrected fill could render **"120%"** (no upper display clamp).
- Distraction could fire **red off three identical early calls** (no minimum-sample guard).
- Confusion could go **red on two routine transient tool errors** — exactly the "cries wolf" failure the philosophy exists to prevent. Retuned to require a minimum error *count* and a higher rate.
- The goal-drift *tests* were pinned to a **retired threshold** and asserted behavior the shipped code didn't produce.
- The spec and README **overstated** small-model findings as fact; they were reconciled with an honest methodology doc.

None of these were catastrophic. But finding them required building the machinery to be skeptical of your own work — and I'd argue that machinery is the most reusable thing here.

---

## The fallbacks — what doesn't work well yet, and how to make it better

Honesty is the brand, so here's the unflattering part.

**1. Goal-drift — the lead feature — rests on the weakest foundation.** It fires on an *absolute* cosine threshold, calibrated by resubstitution on 28 mostly cross-domain pairs ("build auth" vs. "sourdough recipe"). Two problems the research made unavoidable:
- Embedding spaces are **anisotropic** — every goal sits at its own baseline on a narrow cone, so a single global cutoff doesn't transfer between goals. (The model's own card says only the *relative order* of scores is meaningful, not the absolute value.)
- The activity vector **pools user prompts and tool-call strings into one embedding**, which dilutes intent — so *subtle in-domain* drift ("add JWT auth" → "refactor logging") is invisible, because both read as "software."

The fix, informed by two more deep-research passes, is a redesign to a **per-session relative signal**: compare the goal to individual user turns embedded *separately*, score the drop with a **robust modified z-score against the session's own baseline** (median/MAD, small-sample-safe), gate it with an anisotropy-immune **goal-keyword overlap** check, and require persistence before firing. It's shipping in **shadow mode first** — computed and logged alongside the current signal, without changing the statusline — so it can be calibrated on real sessions before it drives anything. (Research also confirmed the model choice: `bge-small` stays; the tempting alternatives are over the size budget or hurt exactly the code-domain discrimination we need.)

**2. Thresholds are still small-model/non-Claude priors.** The numbers are honest defaults, not Claude-calibrated truths. Making them better means an eval harness with **in-domain, subtle-drift session trajectories** (not just obvious topic jumps), scored with proper **leave-one-session-out** validation and a **false-alarm-rate-on-healthy-sessions** headline metric — and re-derived per model.

**3. The 1M-context story is approximate.** The autocompact reserve on 1M models isn't officially published; the scaled reserve is a principled improvement over a flat constant but still an estimate. It'll need real data (and it's fully tunable in the meantime).

**4. Some signals are cheaper than they are sound.** The repetition metric is a duplicate-fraction that conflates "one tight loop" with "healthy variety at the same rate"; a concentration/entropy measure would be better. These are known, logged, and deferred rather than hidden.

The through-line for all of it: **ship the honest version, instrument it, and let real usage — not confident-sounding priors — decide the thresholds.** That's slower than shipping a number and calling it validated. It's also the only version worth trusting.

---

*Context Health Detector is open source at [github.com/s1ddh-rth/context-health](https://github.com/s1ddh-rth/context-health).*
