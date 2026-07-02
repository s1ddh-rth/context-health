'use strict';

/**
 * Classification metrics for the eval harness.
 *
 * Each prediction is a pair {predicted, expected} where both are severities
 * ('green' | 'yellow' | 'red'). For precision/recall we binarize: an *alert* is
 * yellow or red, *healthy* is green. Because this product's cardinal rule is
 * precision over recall (a false alarm is worse than a miss), the headline score
 * is F-beta with beta < 1 (weights precision above recall) and we always report
 * the false-positive rate.
 *
 * Pure functions, no I/O.
 */

const LEVELS = ['green', 'yellow', 'red'];

function isAlert(sev) {
  return sev === 'yellow' || sev === 'red';
}

function binaryMetrics(pairs) {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const p of pairs || []) {
    const predAlert = isAlert(p.predicted);
    const expAlert = isAlert(p.expected);
    if (predAlert && expAlert) tp++;
    else if (predAlert && !expAlert) fp++;
    else if (!predAlert && !expAlert) tn++;
    else fn++;
  }
  // When there are no positive predictions, precision is vacuously perfect (no
  // false alarms). When there are no actual positives, recall is vacuously
  // perfect (nothing to miss).
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const falsePositiveRate = fp + tn === 0 ? 0 : fp / (fp + tn);
  const total = tp + fp + tn + fn;
  const accuracy = total === 0 ? 1 : (tp + tn) / total;
  return {
    tp, fp, tn, fn,
    precision,
    recall,
    f1: fBeta(precision, recall, 1),
    fBetaHalf: fBeta(precision, recall, 0.5),
    falsePositiveRate,
    accuracy,
    support: total,
  };
}

function fBeta(precision, recall, beta) {
  const b2 = beta * beta;
  const denom = b2 * precision + recall;
  if (denom === 0) return 0;
  return ((1 + b2) * precision * recall) / denom;
}

// 3x3 severity confusion matrix: matrix[expected][predicted] = count.
function confusionMatrix(pairs) {
  const matrix = {};
  for (const e of LEVELS) {
    matrix[e] = { green: 0, yellow: 0, red: 0 };
  }
  for (const p of pairs || []) {
    const e = LEVELS.includes(p.expected) ? p.expected : 'green';
    const pr = LEVELS.includes(p.predicted) ? p.predicted : 'green';
    matrix[e][pr]++;
  }
  return matrix;
}

function exactAccuracy(pairs) {
  const list = pairs || [];
  if (list.length === 0) return 1;
  let correct = 0;
  for (const p of list) if (p.predicted === p.expected) correct++;
  return correct / list.length;
}

module.exports = { binaryMetrics, fBeta, confusionMatrix, exactAccuracy, isAlert, LEVELS };
