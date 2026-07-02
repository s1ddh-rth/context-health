'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectDistraction } = require('../bin/lib/distraction.js');

const CONFIG = {
  recentToolCallWindow: 20,
  repetitionRateYellow: 0.30,
  repetitionRateRed: 0.50,
  contextFillYellow: 50,
  contextFillRed: 85,
};

// helper: n identical calls
function repeat(sig, n) {
  return Array.from({ length: n }, () => ({ name: sig, paramsKey: 'p' }));
}
// helper: n all-distinct calls
function distinct(n) {
  return Array.from({ length: n }, (_, i) => ({ name: 't' + i, paramsKey: 'p' + i }));
}

test('distraction: all-distinct calls with low fill => green', () => {
  const r = detectDistraction({ recentToolCalls: distinct(10), fillPercent: 20 }, CONFIG);
  assert.equal(r.severity, 'green');
  assert.equal(r.repetitionRate, 0);
});

test('distraction: high repetition alone => red even with low fill', () => {
  const r = detectDistraction({ recentToolCalls: repeat('grep', 20), fillPercent: 10 }, CONFIG);
  assert.equal(r.severity, 'red');
  assert.ok(r.repetitionRate > 0.5);
});

test('distraction: moderate repetition => yellow', () => {
  // 10 calls: 4 distinct + 6 copies of one signature => unique=5, dup=5, rate=0.5
  // rate 0.5 is > 0.30 (yellow) but not > 0.50 (red)
  const calls = [...distinct(4), ...repeat('x', 6)];
  const r = detectDistraction({ recentToolCalls: calls, fillPercent: 10 }, CONFIG);
  assert.equal(r.repetitionRate, 0.5);
  assert.equal(r.severity, 'yellow');
});

test('distraction: high context fill alone => red even with no repetition', () => {
  const r = detectDistraction({ recentToolCalls: distinct(5), fillPercent: 90 }, CONFIG);
  assert.equal(r.severity, 'red');
});

test('distraction: mid context fill alone => yellow', () => {
  const r = detectDistraction({ recentToolCalls: distinct(5), fillPercent: 60 }, CONFIG);
  assert.equal(r.severity, 'yellow');
});

test('distraction: OR-combine takes the worse of the two signals', () => {
  // yellow-level repetition + red-level fill => red
  const calls = [...distinct(4), ...repeat('x', 6)]; // rate 0.5 yellow
  const r = detectDistraction({ recentToolCalls: calls, fillPercent: 90 }, CONFIG);
  assert.equal(r.severity, 'red');
});

test('distraction: only the most recent window is considered', () => {
  // 30 identical then window=20 => still all identical in window => red
  const r = detectDistraction({ recentToolCalls: repeat('x', 30), fillPercent: 0 }, CONFIG);
  assert.equal(r.severity, 'red');
});

test('distraction: empty calls + unknown fill => green, no crash', () => {
  const r = detectDistraction({ recentToolCalls: [], fillPercent: null }, CONFIG);
  assert.equal(r.severity, 'green');
  assert.equal(r.repetitionRate, 0);
});

test('distraction: missing input object => green, no throw', () => {
  const r = detectDistraction(undefined, CONFIG);
  assert.equal(r.severity, 'green');
});

test('distraction: reason names the dominant signal', () => {
  const r = detectDistraction({ recentToolCalls: repeat('grep', 20), fillPercent: 10 }, CONFIG);
  assert.match(r.reason, /repeat/i);
});
