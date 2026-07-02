'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeToolCall, stableParamsKey } = require('../bin/lib/tool-signature.js');

test('identical calls produce an identical signature', () => {
  const a = normalizeToolCall('Grep', { pattern: 'foo', path: '/x' });
  const b = normalizeToolCall('Grep', { pattern: 'foo', path: '/x' });
  assert.equal(a.name, 'Grep');
  assert.equal(a.paramsKey, b.paramsKey);
});

test('key order does not matter', () => {
  const a = stableParamsKey({ pattern: 'foo', path: '/x' });
  const b = stableParamsKey({ path: '/x', pattern: 'foo' });
  assert.equal(a, b);
});

test('different params produce different signatures', () => {
  const a = normalizeToolCall('Grep', { pattern: 'foo' });
  const b = normalizeToolCall('Grep', { pattern: 'bar' });
  assert.notEqual(a.paramsKey, b.paramsKey);
});

test('whitespace-only string differences normalize to the same key', () => {
  const a = stableParamsKey({ q: '  foo  ' });
  const b = stableParamsKey({ q: 'foo' });
  assert.equal(a, b);
});

test('nested objects are handled deterministically', () => {
  const a = stableParamsKey({ a: { z: 1, y: 2 } });
  const b = stableParamsKey({ a: { y: 2, z: 1 } });
  assert.equal(a, b);
});

test('missing / non-object input never throws', () => {
  assert.doesNotThrow(() => normalizeToolCall(undefined, undefined));
  const r = normalizeToolCall(undefined, undefined);
  assert.equal(typeof r.paramsKey, 'string');
  assert.equal(r.name, '');
});

test('very large params are truncated to bound the key length', () => {
  const big = { blob: 'x'.repeat(100000) };
  const key = stableParamsKey(big);
  assert.ok(key.length <= 2100, `key length ${key.length} should be bounded`);
});

test('circular structures do not throw', () => {
  const o = { a: 1 };
  o.self = o;
  assert.doesNotThrow(() => stableParamsKey(o));
});
