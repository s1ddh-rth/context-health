"""Pure calibration helpers for goal-drift thresholds.

Given scored pairs [(label, similarity), ...] where label is 'on_goal' or
'drifted', these compute how separable the two classes are and sweep candidate
cosine thresholds to recommend a precision-first cut point.

A 'drifted' prediction fires when similarity < threshold. Precision here is the
share of fired alarms that were truly drifted — the number this product cares
about most (a false alarm is worse than a miss).
"""


def _mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def separation(scored):
    on = [s for label, s in scored if label == "on_goal"]
    dr = [s for label, s in scored if label == "drifted"]
    return {
        "on_goal_n": len(on),
        "drifted_n": len(dr),
        "on_goal_min": min(on) if on else None,
        "on_goal_mean": _mean(on),
        "drifted_max": max(dr) if dr else None,
        "drifted_mean": _mean(dr),
        # positive margin => the classes are linearly separable by a threshold
        "margin": (min(on) - max(dr)) if on and dr else None,
    }


def sweep_thresholds(scored, thresholds):
    results = []
    for t in thresholds:
        tp = fp = fn = tn = 0
        for label, sim in scored:
            pred_drift = sim < t
            if label == "drifted":
                if pred_drift:
                    tp += 1
                else:
                    fn += 1
            else:  # on_goal
                if pred_drift:
                    fp += 1
                else:
                    tn += 1
        precision = 1.0 if (tp + fp) == 0 else tp / (tp + fp)
        recall = 1.0 if (tp + fn) == 0 else tp / (tp + fn)
        results.append(
            {"threshold": round(t, 4), "precision": precision, "recall": recall,
             "tp": tp, "fp": fp, "fn": fn, "tn": tn}
        )
    return results


def _frange(lo, hi, step):
    vals = []
    x = lo
    # avoid float drift by counting steps
    n = int(round((hi - lo) / step))
    for i in range(n + 1):
        vals.append(round(lo + i * step, 4))
    return vals


def recommend_threshold(scored, precision_target=1.0, lo=0.30, hi=0.90, step=0.01):
    """Largest threshold whose precision >= precision_target (maximizes recall
    among the no-worse-than-target-precision cuts). Returns None if no threshold
    meets the target."""
    sweep = sweep_thresholds(scored, _frange(lo, hi, step))
    best = None
    for row in sweep:
        # Require at least one true positive: precision is vacuously 1.0 when
        # nothing is flagged, so a tp==0 row is not a real recommendation.
        if row["precision"] >= precision_target and row["tp"] > 0:
            if best is None or row["threshold"] > best["threshold"]:
                best = row
    return best
