#!/usr/bin/env python
"""Goal-drift threshold calibration (uses the local embedding model).

Scores the labeled on_goal/drifted pairs in eval/drift-pairs.json with the real
FastEmbed model, reports how separable the classes are, sweeps candidate cosine
thresholds, and recommends a precision-first cut point. This is what turns the
provisional 0.70 / 0.50 defaults (build-spec 5.6) into measured numbers.

    uv run --directory worker python eval_drift.py

Zero API cost — the model is local. It only reads the labeled set; it changes no
config. Apply any recommendation by editing settings.json or the user override.
"""

import json
import os
import sys

from context_health_worker.calibration import (
    recommend_threshold,
    separation,
    sweep_thresholds,
)
from context_health_worker.drift import cosine_similarity
from context_health_worker.embedder import Embedder


def _pairs_path():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(here, "..", "eval", "drift-pairs.json")


def main():
    with open(_pairs_path(), "r", encoding="utf-8") as f:
        pairs = json.load(f)

    emb = Embedder()
    if not emb.available:
        print("Embedding model unavailable (fastembed not installed or offline). "
              "Cannot calibrate.", file=sys.stderr)
        return 1

    scored = []
    for p in pairs:
        gv = emb.embed(p["goal"])
        av = emb.embed(p["activity"])
        sim = cosine_similarity(gv, av)
        scored.append((p["label"], sim))

    sep = separation(scored)
    print("\nGoal-drift calibration")
    print("=" * 40)
    print(f"pairs: {sep['on_goal_n']} on-goal, {sep['drifted_n']} drifted")
    print(f"on-goal cosine : min {sep['on_goal_min']:.3f}  mean {sep['on_goal_mean']:.3f}")
    print(f"drifted cosine : max {sep['drifted_max']:.3f}  mean {sep['drifted_mean']:.3f}")
    margin = sep["margin"]
    print(f"separation margin (on_goal_min - drifted_max): {margin:+.3f}"
          + ("  (linearly separable)" if margin and margin > 0 else "  (classes overlap)"))

    print("\nthreshold sweep (predict 'drifted' when cosine < threshold):")
    print("  thresh  precision  recall   fp  fn")
    for row in sweep_thresholds(scored, [0.50, 0.55, 0.60, 0.65, 0.70, 0.75]):
        print(f"   {row['threshold']:.2f}     {row['precision']*100:5.1f}%   "
              f"{row['recall']*100:5.1f}%   {row['fp']:2d}  {row['fn']:2d}")

    rec = recommend_threshold(scored, precision_target=1.0)
    print("\ncurrent config defaults come from settings.json")
    if rec:
        print(f"precision-first recommendation (zero false alarms): "
              f"threshold ~= {rec['threshold']:.2f} "
              f"(recall {rec['recall']*100:.0f}%)")
        print("  -> use this as the yellow cut; set red a bit lower for the "
              "high-confidence band.")
    else:
        print("no zero-false-alarm threshold found; classes overlap on this set.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
