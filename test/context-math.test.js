'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeContextFill, extractWindowSize } = require('../bin/lib/context-math.js');

const DEFAULTS = { autocompactBufferTokens: 33000, defaultWindowSize: 200000 };

test('computeContextFill: fill reaches ~100% exactly at the autocompact boundary', () => {
  // usable window = 200000 - 33000 = 167000 tokens.
  // used_percentage of the FULL window that equals 167000 tokens = 167000/200000 = 83.5%
  const r = computeContextFill({ context_window: { used_percentage: 83.5 } }, DEFAULTS);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.fillPercent - 100) < 0.01, `expected ~100, got ${r.fillPercent}`);
  assert.ok(Math.abs(r.freeUntilCompactPercent - 0) < 0.01);
});

test('computeContextFill: half-full usable window', () => {
  // half of usable (167000/2 = 83500 tokens) => used_percentage = 83500/200000 = 41.75%
  const r = computeContextFill({ context_window: { used_percentage: 41.75 } }, DEFAULTS);
  assert.ok(Math.abs(r.fillPercent - 50) < 0.01, `expected ~50, got ${r.fillPercent}`);
});

test('computeContextFill: empty context reports 0 fill', () => {
  const r = computeContextFill({ context_window: { used_percentage: 0 } }, DEFAULTS);
  assert.equal(r.fillPercent, 0);
  assert.equal(r.freeUntilCompactPercent, 100);
});

test('computeContextFill: over-usable (past autocompact) exceeds 100 and never goes negative on free', () => {
  const r = computeContextFill({ context_window: { used_percentage: 95 } }, DEFAULTS);
  assert.ok(r.fillPercent > 100, `expected >100, got ${r.fillPercent}`);
  assert.equal(r.freeUntilCompactPercent, 0);
});

test('computeContextFill: adjusted fill is always higher than the raw used_percentage', () => {
  // This is the whole point of the correction: the buffer shrinks the usable window,
  // so the true fill of what you can use is worse than the raw number implies.
  const raw = 60;
  const r = computeContextFill({ context_window: { used_percentage: raw } }, DEFAULTS);
  assert.ok(r.fillPercent > raw, `adjusted ${r.fillPercent} should exceed raw ${raw}`);
});

test('computeContextFill: missing used_percentage => ok:false, no crash', () => {
  const r = computeContextFill({}, DEFAULTS);
  assert.equal(r.ok, false);
});

test('computeContextFill: non-numeric used_percentage => ok:false', () => {
  const r = computeContextFill({ context_window: { used_percentage: 'nope' } }, DEFAULTS);
  assert.equal(r.ok, false);
});

test('computeContextFill: null input => ok:false, no throw', () => {
  const r = computeContextFill(null, DEFAULTS);
  assert.equal(r.ok, false);
});

test('extractWindowSize: prefers an explicit window field when present', () => {
  const size = extractWindowSize({ context_window: { max_tokens: 1000000 } }, DEFAULTS);
  assert.equal(size, 1000000);
});

test('extractWindowSize: falls back to default when absent', () => {
  const size = extractWindowSize({ context_window: {} }, DEFAULTS);
  assert.equal(size, 200000);
});

test('computeContextFill: uses explicit window size for the buffer proportion', () => {
  // With a 1,000,000 window the 33k buffer is proportionally tiny.
  const big = computeContextFill(
    { context_window: { used_percentage: 50, max_tokens: 1000000 } },
    DEFAULTS
  );
  // usable = 967000; usedTokens = 500000; fill = 500000/967000*100 ~= 51.7
  assert.ok(Math.abs(big.fillPercent - 51.71) < 0.2, `got ${big.fillPercent}`);
});
