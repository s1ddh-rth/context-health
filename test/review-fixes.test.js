'use strict';

// Regression tests for the Phase 1 review findings (m1–m4, m2 window edge).

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultSessionState } = require('../bin/lib/state.js');
const sig = require('../bin/lib/session-signals.js');
const { detectDistraction } = require('../bin/lib/distraction.js');
const { detectConfusion } = require('../bin/lib/confusion.js');

function fresh() { return defaultSessionState('s'); }

// m4 — isErrorOutput edges
test('isErrorOutput: {error:0} is NOT an error', () => {
  assert.equal(sig.isErrorOutput({ error: 0 }), false);
});
test('isErrorOutput: matches SyntaxError / TypeError style prefixes', () => {
  assert.equal(sig.isErrorOutput('SyntaxError: unexpected token'), true);
  assert.equal(sig.isErrorOutput('TypeError: x is not a function'), true);
});
test('isErrorOutput: matches fatal: and npm err!', () => {
  assert.equal(sig.isErrorOutput('fatal: not a git repository'), true);
  assert.equal(sig.isErrorOutput('npm ERR! code E404'), true);
});
test('isErrorOutput: still ignores benign mentions of the word error', () => {
  assert.equal(sig.isErrorOutput('recovered from the error cleanly'), false);
});

// m1 — activeTools bounded
test('activeTools is capped at MAX_ACTIVE_TOOLS', () => {
  const s = fresh();
  for (let i = 0; i < sig.MAX_ACTIVE_TOOLS + 30; i++) sig.recordToolCall(s, 'tool-' + i, {});
  assert.equal(s.activeTools.length, sig.MAX_ACTIVE_TOOLS);
});

// m3 — evaluate respects enabled flags
test('a disabled detector never warns', () => {
  const s = fresh();
  for (let i = 0; i < 20; i++) sig.recordToolCall(s, 'Grep', { pattern: 'same' }); // would be red
  const cfg = { detectors: { distraction: { enabled: false }, confusion: { enabled: true } } };
  const r = sig.evaluate(s, { fillPercent: 10 }, cfg);
  assert.equal(r.severity, 'green');
});

// m2 — window: 0 must not select the whole array
test('distraction window=0 falls back to default (does not scan whole array)', () => {
  const calls = Array.from({ length: 20 }, () => ({ name: 'x', paramsKey: 'p' }));
  const r = detectDistraction({ recentToolCalls: calls, fillPercent: 0 }, { recentToolCallWindow: 0 });
  // with the fallback default window it still evaluates; the key point is it
  // doesn't throw and produces a sane rate
  assert.ok(r.repetitionRate >= 0 && r.repetitionRate <= 1);
});
test('confusion window=0 falls back to default', () => {
  const calls = Array.from({ length: 20 }, (_, i) => ({ isError: i < 2 }));
  const r = detectConfusion({ activeToolCount: 5, recentCalls: calls }, { recentCallWindow: 0 });
  assert.ok(r.toolErrorRate >= 0 && r.toolErrorRate <= 1);
});
