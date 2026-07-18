'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectConfusion } = require('../bin/lib/confusion.js');

// Mirrors the shipped settings.json confusion block: precision-first error band —
// needs >= minErrorsToFire errors AND rate > threshold before firing.
const CONFIG = {
  recentCallWindow: 20,
  activeToolYellow: 30,
  minErrorsToFire: 3,
  toolErrorRateYellow: 0.10,
  toolErrorRateRed: 0.20,
};

function calls(nErrors, nTotal) {
  const arr = [];
  for (let i = 0; i < nTotal; i++) arr.push({ isError: i < nErrors });
  return arr;
}

test('confusion: few tools, no errors => green', () => {
  const r = detectConfusion({ activeToolCount: 12, recentCalls: calls(0, 20) }, CONFIG);
  assert.equal(r.severity, 'green');
  assert.equal(r.toolErrorRate, 0);
});

test('confusion: over the 30-tool threshold => yellow', () => {
  const r = detectConfusion({ activeToolCount: 31, recentCalls: calls(0, 20) }, CONFIG);
  assert.equal(r.severity, 'yellow');
  assert.match(r.reason, /tool/i);
});

test('confusion: exactly 30 tools is not yet yellow', () => {
  const r = detectConfusion({ activeToolCount: 30, recentCalls: calls(0, 20) }, CONFIG);
  assert.equal(r.severity, 'green');
});

test('confusion: two transient errors stay GREEN (precision-first, the retune)', () => {
  // 2 errors in 20 = 0.10 rate, but below minErrorsToFire(3) => must not fire.
  // This is the whole point of the fix: routine transient failures don't go red.
  const r = detectConfusion({ activeToolCount: 5, recentCalls: calls(2, 20) }, CONFIG);
  assert.equal(r.toolErrorRate, 0.1);
  assert.equal(r.severity, 'green');
});

test('confusion: three errors => yellow (min count met, rate > 0.10)', () => {
  // 3 errors in 20 = 0.15 > 0.10 (yellow) but not > 0.20 (red)
  const r = detectConfusion({ activeToolCount: 5, recentCalls: calls(3, 20) }, CONFIG);
  assert.ok(Math.abs(r.toolErrorRate - 0.15) < 1e-9);
  assert.equal(r.severity, 'yellow');
});

test('confusion: four errors (rate 0.20 exactly) is still yellow, not red', () => {
  const r = detectConfusion({ activeToolCount: 5, recentCalls: calls(4, 20) }, CONFIG);
  assert.ok(Math.abs(r.toolErrorRate - 0.20) < 1e-9);
  assert.equal(r.severity, 'yellow');
});

test('confusion: five errors => red (rate 0.25 > 0.20)', () => {
  const r = detectConfusion({ activeToolCount: 5, recentCalls: calls(5, 20) }, CONFIG);
  assert.ok(Math.abs(r.toolErrorRate - 0.25) < 1e-9);
  assert.equal(r.severity, 'red');
});

test('confusion: only the last window of calls counts toward error rate', () => {
  // 40 calls, first 20 all errors, last 20 all clean -> window sees 0 errors
  const arr = [...calls(20, 20), ...calls(0, 20)];
  const r = detectConfusion({ activeToolCount: 5, recentCalls: arr }, CONFIG);
  assert.equal(r.toolErrorRate, 0);
  assert.equal(r.severity, 'green');
});

test('confusion: high tools + many errors => red (worst wins)', () => {
  const r = detectConfusion({ activeToolCount: 40, recentCalls: calls(5, 20) }, CONFIG);
  assert.equal(r.severity, 'red');
});

test('confusion: no calls yet => error rate 0, green', () => {
  const r = detectConfusion({ activeToolCount: 3, recentCalls: [] }, CONFIG);
  assert.equal(r.toolErrorRate, 0);
  assert.equal(r.severity, 'green');
});

test('confusion: missing input => green, no throw', () => {
  const r = detectConfusion(undefined, CONFIG);
  assert.equal(r.severity, 'green');
});
