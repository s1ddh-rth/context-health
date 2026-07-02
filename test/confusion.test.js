'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectConfusion } = require('../bin/lib/confusion.js');

const CONFIG = {
  recentCallWindow: 10,
  activeToolYellow: 30,
  toolErrorRateYellow: 0.05,
  toolErrorRateRed: 0.10,
};

function calls(nErrors, nTotal) {
  const arr = [];
  for (let i = 0; i < nTotal; i++) arr.push({ isError: i < nErrors });
  return arr;
}

test('confusion: few tools, no errors => green', () => {
  const r = detectConfusion({ activeToolCount: 12, recentCalls: calls(0, 10) }, CONFIG);
  assert.equal(r.severity, 'green');
  assert.equal(r.toolErrorRate, 0);
});

test('confusion: over the 30-tool threshold => yellow', () => {
  const r = detectConfusion({ activeToolCount: 31, recentCalls: calls(0, 10) }, CONFIG);
  assert.equal(r.severity, 'yellow');
  assert.match(r.reason, /tool/i);
});

test('confusion: exactly 30 tools is not yet yellow', () => {
  const r = detectConfusion({ activeToolCount: 30, recentCalls: calls(0, 10) }, CONFIG);
  assert.equal(r.severity, 'green');
});

test('confusion: error rate above yellow threshold => yellow', () => {
  // 1 error in 10 = 0.10 -> above 0.05 (yellow) but not above 0.10 (red is strictly >)
  const r = detectConfusion({ activeToolCount: 5, recentCalls: calls(1, 10) }, CONFIG);
  assert.equal(r.toolErrorRate, 0.1);
  assert.equal(r.severity, 'yellow');
});

test('confusion: error rate above red threshold => red', () => {
  // 2 errors in 10 = 0.20 -> above 0.10
  const r = detectConfusion({ activeToolCount: 5, recentCalls: calls(2, 10) }, CONFIG);
  assert.equal(r.severity, 'red');
});

test('confusion: only the last window of calls counts toward error rate', () => {
  // 20 calls, first 10 all errors, last 10 all clean -> window sees 0 errors
  const arr = [...calls(10, 10), ...calls(0, 10)];
  const r = detectConfusion({ activeToolCount: 5, recentCalls: arr }, CONFIG);
  assert.equal(r.toolErrorRate, 0);
  assert.equal(r.severity, 'green');
});

test('confusion: high tools + high errors => red (worst wins)', () => {
  const r = detectConfusion({ activeToolCount: 40, recentCalls: calls(2, 10) }, CONFIG);
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
