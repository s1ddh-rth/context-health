# Methodology — what each variable is, how it's computed, and why

This document is the reference for **how the detectors work and why the numbers are
what they are**. Every threshold here is a tunable default in
[`settings.json`](../settings.json), not a hard-coded truth — where the science is
genuinely uncertain, this doc says so rather than inventing precision.

Two principles run through everything:

- **Precision over recall.** A false alarm is worse than a miss; a detector that
  cries wolf gets switched off. Thresholds are set to minimise false positives.
- **Evidence, not vibes.** Claims about thresholds and mechanisms are backed by the
  [sources](#sources) at the bottom. All source URLs were checked and resolve.

The taxonomy of failure modes follows Drew Breunig's *How Long Contexts Fail* [1],
with goal-drift added from the agent-drift literature [9]. The original *clash* and
*poisoning* modes are merged into one **contradiction** detector — research showed
they collapse to the same local computation (detecting a contradiction between two
items in context).

---

## The six variables at a glance

| Variable | What it measures | How | Cost |
|---|---|---|---|
| Context fill % | how full the *usable* window is | statusline JSON, buffer-adjusted | free |
| Repetition rate | how often recent tool calls repeat | signature dedup over a window | free |
| Active tool count | tools live vs the confusion threshold | distinct tools seen | free |
| Tool-error rate | failed tool calls over a window | error flags | free |
| Drift distance | semantic distance of activity from the goal | local embedding + cosine | free |
| Contradiction count | conflicting facts in context | opt-in LLM judge | opt-in, BYO key/local |

---

## 1. Context fill (corrected)

**What.** How full the context window is — but measured against the window you can
actually *use*, not the hard limit.

**How.** Claude Code reserves an **autocompact buffer** near the top of the window;
when used tokens reach `windowSize − reserve`, auto-compaction fires. The statusline
reports `used_percentage` against the *full* window [10], so we rebase against the
*usable* window:

```
reserve     = max(autocompactBufferTokens, windowSize × autocompactReserveFraction)
usedTokens  = (used_percentage / 100) × windowSize
fillPercent = usedTokens / (windowSize − reserve) × 100
```

The reserve **scales with the window** instead of being a flat constant. The default
`autocompactReserveFraction` is `0.165` (= 33,000 / 200,000), so on a 200K model the
reserve is exactly ~33,000 tokens and `fillPercent` reaches **100% at the
auto-compaction boundary** (and is always higher than the raw `used_percentage` — the
honest read). On larger windows the proportional reserve avoids a flat 33k badly
overstating usable space.

**Why the buffer, and its limits.** The ~33k figure is community-observed for 200K
models (it was ~45k before early 2026 and changed silently, so it's a version-pinned
constant to re-verify per release). It is **not** officially published, and on
1M-context Opus the real reserve is far larger — auto-compaction has been observed to
fire near ~400K used (~40% of the window; see claude-code issue #43989), so the default
16.5% proportional reserve is a genuine improvement over a flat 33k but still
**understates** the 1M reserve. Raise `autocompactReserveFraction` for such models.
Also, `used_percentage` counts input tokens only (it excludes the current turn's
output) [10], so fill is a close but slightly optimistic proxy.

**Bands:** yellow **50%**, red **85%** (of the usable window). Yellow at ~50% aligns
with RULER's finding that effective context is roughly half the advertised size [3]
and NoLiMa's degradation by ~32k tokens on semantic tasks [4]. Red at 85% is
**provisional and deliberately conservative for Claude**: the research shows
performance degrades *non-uniformly* as input grows — often well before the window
is full, and earliest on the smaller models those studies stress most — while
Claude's long-context models degrade more slowly [5]. (The "40–70%" range
sometimes quoted is a loose cross-study generalization, not a single benchmarked
figure.) Precision-first means we'd rather miss than false-alarm a healthy session. Calibrate against Claude-specific data in
the eval harness before lowering it.

> The often-repeated "60–70% dumb zone" and "compact at 50%" figures are
> **practitioner heuristics, not benchmarked for Claude 200K** — we don't treat them
> as evidence.

---

## 2. Distraction

**What.** The context grew long and the agent is repeating past actions instead of
reasoning fresh (the "Pokémon failure mode" — a Gemini agent began repeating actions
past ~100k tokens [1]).

**How.** Two OR-combined signals:

1. **Repetition rate** over the last 20 tool calls: `rate = duplicates / total`,
   where a call is a duplicate if an identical *(tool name + normalized params)*
   signature already appeared in the window. Exact-signature dedup over a bounded
   window is the standard cheap loop-detection approach; it deliberately misses
   loops longer than the window and semantic near-duplicates (acceptable for a
   free, no-model tier).
2. **Context fill** (§1).

Either alone can warn — the worse severity wins.

**Bands:** repetition yellow **>0.30**, red **>0.50**; fill yellow **>50**, red
**>85**. Distraction onset is model-specific and dated (Llama 3.1 405B degrades from
~32k tokens [7]; the Gemini figure is ~100k [1]) — using fill-% rather than a raw
token count abstracts over that.

---

## 3. Confusion

**What.** Too many tools, or a rising rate of failed calls, pulling the model toward
wrong choices.

**How.** Two signals:

1. **Active tool count** — distinct tools seen this session. Yellow only.
2. **Tool-error rate** over the last **20** calls — errored calls / total. (The
   window is 20, not 10: with a 10-call window the smallest non-zero rate is 0.10,
   which made a single error trip the 0.05 threshold — a quantization artefact.)

**Bands:** active tools yellow **>30**; error rate yellow **>0.05**, red **>0.10**.
The 30-tool figure is a **conservative small-model floor**. The strongest cited
result — a quantized Llama-3.1-8B failing at 46 tools but succeeding at 19 — is from
*edge-device* models [8] and is **not** representative of Claude-class models; tool
selection degrades continuously and is model-dependent [6], and strong models
tolerate far more (often 50–100+). So 30 will only warn on heavy tool setups; per-
model calibration is deferred to the eval harness. Curating the tool set is the
evidence-backed fix — RAG-MCP raised tool-selection accuracy from 13.6% to 43.1%
via retrieval-based selection [6].

---

## 4. Goal-drift (the lead feature)

**What.** The session started aimed at X and is now doing Y, without anyone deciding
to change course. An early preprint on "agent drift" reports that unchecked
semantic drift — progressive deviation from the original intent — measurably
degrades task success over long multi-agent runs [9] (single-author, not yet
peer-reviewed; treat as motivating evidence, not a settled result).

**How.** At the first prompt, the goal is captured and embedded once with a local
**FastEmbed / BAAI bge-small-en-v1.5** model (384-dim, ONNX, no GPU). Each turn a
warm background worker embeds a **rolling activity window** (recent prompts + recent
tool signatures, *excluding the goal-defining prompt* so the goal isn't compared to
itself) and computes cosine similarity to the goal vector:

```
similarity = (a · b) / (|a| · |b|)          # standard cosine, range [-1, 1]
```

Rising distance (falling similarity) over turns is the drift signal. It only fires
after ≥3 turns (so early exploration doesn't trip it). A **weak anchor** — a goal
under ~12 words — lowers the thresholds slightly, making drift *harder* to fire, to
cut false alarms on thin goals.

We use `embed()` for **both** sides (symmetric similarity), not the query-instruction
prefix — that prefix is only for *asymmetric* query→document retrieval, and bge v1.5
is explicitly documented to work without it [2].

**Bands:** yellow **<0.55**, red **<0.50**. These look low because **bge-small's
similarity scores cluster in [0.6, 1.0] by design** — its own model card states "a
similarity score greater than 0.5 does not indicate that the two sentences are
similar," and that *relative* order matters more than absolute value [2]. So the
thresholds are calibrated to *this model's* distribution, not a generic 0–1 scale:

- On our labeled corpus, on-goal pairs bottomed out at cosine **0.559** and drifted
  pairs averaged **0.450**.
- Yellow **0.55** sits just under the on-goal floor → **0 false alarms, 93% recall**.
- Red **0.50** catches clearly-drifted pairs at the same 0 false alarms (0.45 was
  too far below the distribution to fire usefully).

> The calibration corpus is small (~30 pairs) and uses obvious topic changes.
> Real-world drift is subtler and scores higher, so these are *better-grounded
> defaults, not a final answer* — grow `eval/drift-pairs.json` and re-run
> `worker/eval_drift.py` to refine. Run the calibrator to see the live distribution.

---

## 5. Contradiction (opt-in, off by default)

**What.** The merged clash+poisoning mode: a later statement negates an earlier
constraint, or a claim conflicts with an earlier grounded fact. Once a bad fact is in
context, the model tends to reuse it and the error compounds [1][11].

**How.** This can't be done precisely with local marker heuristics (too false-alarm
prone), so it's **opt-in and off by default**. When enabled, a throttled LLM judge
inspects the recent statements and returns a structured verdict. The judge runs on
**your own** Claude API key (resolved by the official SDK from your existing
credentials) or a **local** model — never billed by this plugin. Unparseable or
low-confidence verdicts degrade to green (no alarm).

**Why an LLM.** Contradiction detection is natural-language inference; a small local
heuristic can't separate a real contradiction from normal refinement, and the
product rule is precision-first. This is the one detector that spends tokens, so it's
knowingly opt-in.

---

## Severity roll-up & remediation

The statusline shows the single **worst** condition: red if any detector is red,
yellow if any is yellow, else green. On a red event it emits one line naming the
condition and an **evidence-based remedy**:

| Condition | Remedy (shown in the alert) | Why — evidence |
|---|---|---|
| Distraction | *compact now, or start fresh and reload the essentials* | Compaction is Anthropic's "first lever" for a bloated context; sub-agents return condensed summaries [12]. |
| Confusion | *disable unneeded tools — fewer choices sharpen selection* | Curating/ retrieving the tool set restores selection accuracy [6]. |
| Goal-drift | *restate your goal (keep it in a durable note) and re-anchor* | Externalising the goal and re-anchoring counters early-instruction fade [9][12]. |
| Contradiction | *start fresh; don't compact the bad fact forward* | A bad fact propagates; a summary that preserves it carries the error into the new window [1][11]. |

---

## Calibration & evals

- **Structural detectors** (distraction, confusion) are scored deterministically by
  `eval/run-eval.js` against a labeled fixture corpus, reporting per-detector
  precision / recall / F0.5 / false-positive-rate. `--check` fails on any mismatch.
- **Goal-drift** is calibrated by `worker/eval_drift.py`, which embeds labeled
  on-goal/drifted pairs with the real model and recommends a precision-first
  threshold. Thresholds in this doc came from that harness.
- All thresholds are provisional until calibrated on a larger, more realistic corpus
  — the eval harness is the arbiter, not this document.

---

## Sources

All URLs verified to resolve as of July 2026.

1. Drew Breunig, *How Long Contexts Fail* — https://www.dbreunig.com/2025/06/22/how-contexts-fail-and-how-to-fix-them.html
2. BAAI/bge-small-en-v1.5 model card — https://huggingface.co/BAAI/bge-small-en-v1.5
3. Hsieh et al., *RULER: What's the Real Context Size of Your Long-Context Language Models?* — https://arxiv.org/abs/2404.06654
4. Modarressi et al., *NoLiMa: Long-Context Evaluation Beyond Literal Matching* (ICML 2025) — https://arxiv.org/abs/2502.05167
5. Chroma, *Context Rot* — https://www.trychroma.com/research/context-rot
6. Gan & Sun, *RAG-MCP: Mitigating Prompt Bloat in LLM Tool Selection via RAG* — https://arxiv.org/abs/2505.03275
7. Leng et al. (Databricks), *Long Context RAG Performance of Large Language Models* — https://arxiv.org/abs/2411.03538
8. Paramanayakam et al., *Less is More: Optimizing Function Calling for LLM Execution on Edge Devices* (DATE 2025) — https://arxiv.org/abs/2411.15399
9. Rath, *Agent Drift: Quantifying Behavioral Degradation in Multi-Agent LLM Systems Over Extended Interactions* — https://arxiv.org/abs/2601.04170 *(early single-author preprint, Jan 2026; not peer-reviewed)*
10. Claude Code — Status line reference (context window fields) — https://code.claude.com/docs/en/statusline
11. Elasticsearch Labs, *How to defend your RAG system from context poisoning* — https://www.elastic.co/search-labs/blog/context-poisoning-llm
12. Anthropic, *Effective context engineering for AI agents* — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
