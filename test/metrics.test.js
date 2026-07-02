'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { binaryMetrics, fBeta, confusionMatrix, exactAccuracy } = require('../eval/lib/metrics.js');

test('binaryMetrics: perfect predictions', () => {
  const m = binaryMetrics([
    { predicted: 'red', expected: 'red' },
    { predicted: 'green', expected: 'green' },
    { predicted: 'yellow', expected: 'yellow' },
  ]);
  assert.equal(m.precision, 1);
  assert.equal(m.recall, 1);
  assert.equal(m.falsePositiveRate, 0);
  assert.equal(m.accuracy, 1);
});

test('binaryMetrics: a false alarm lowers precision and raises FPR', () => {
  // predicted alert on a healthy case
  const m = binaryMetrics([
    { predicted: 'yellow', expected: 'green' }, // fp
    { predicted: 'green', expected: 'green' }, // tn
    { predicted: 'red', expected: 'red' }, // tp
  ]);
  assert.equal(m.tp, 1);
  assert.equal(m.fp, 1);
  assert.equal(m.precision, 0.5);
  assert.equal(m.recall, 1);
  assert.ok(m.falsePositiveRate > 0);
});

test('binaryMetrics: a miss lowers recall but keeps precision', () => {
  const m = binaryMetrics([
    { predicted: 'green', expected: 'red' }, // fn (missed)
    { predicted: 'red', expected: 'red' }, // tp
  ]);
  assert.equal(m.precision, 1);
  assert.equal(m.recall, 0.5);
});

test('binaryMetrics: no predictions => vacuous precision 1, no false alarms', () => {
  const m = binaryMetrics([
    { predicted: 'green', expected: 'green' },
    { predicted: 'green', expected: 'green' },
  ]);
  assert.equal(m.precision, 1);
  assert.equal(m.falsePositiveRate, 0);
});

test('fBeta with beta<1 weights precision above recall', () => {
  // high precision, low recall
  const a = fBeta(1.0, 0.5, 0.5);
  // low precision, high recall
  const b = fBeta(0.5, 1.0, 0.5);
  assert.ok(a > b, 'precision-heavy should score higher under beta=0.5');
});

test('fBeta: zero precision and recall => 0', () => {
  assert.equal(fBeta(0, 0, 0.5), 0);
});

test('confusionMatrix counts expected x predicted', () => {
  const cm = confusionMatrix([
    { expected: 'green', predicted: 'yellow' },
    { expected: 'green', predicted: 'green' },
    { expected: 'red', predicted: 'red' },
  ]);
  assert.equal(cm.green.yellow, 1);
  assert.equal(cm.green.green, 1);
  assert.equal(cm.red.red, 1);
});

test('exactAccuracy is stricter than binary accuracy (level-sensitive)', () => {
  // predicted yellow, expected red: both are "alert" (binary correct) but not exact
  const pairs = [{ predicted: 'yellow', expected: 'red' }];
  assert.equal(exactAccuracy(pairs), 0);
  assert.equal(binaryMetrics(pairs).accuracy, 1); // both count as alert
});

test('empty input is handled', () => {
  const m = binaryMetrics([]);
  assert.equal(m.support, 0);
  assert.equal(exactAccuracy([]), 1);
});
