'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rollup, SEVERITY_ORDER } = require('../bin/lib/severity.js');

test('rollup: all green => green, no worst condition', () => {
  const r = rollup([
    { condition: 'distraction', severity: 'green' },
    { condition: 'confusion', severity: 'green' },
  ]);
  assert.equal(r.severity, 'green');
  assert.equal(r.worst, null);
});

test('rollup: any yellow => yellow', () => {
  const r = rollup([
    { condition: 'distraction', severity: 'green' },
    { condition: 'confusion', severity: 'yellow', reason: '31 tools active' },
  ]);
  assert.equal(r.severity, 'yellow');
  assert.equal(r.worst.condition, 'confusion');
});

test('rollup: any red beats yellow', () => {
  const r = rollup([
    { condition: 'distraction', severity: 'red', reason: 'actions repeating 60%' },
    { condition: 'confusion', severity: 'yellow' },
  ]);
  assert.equal(r.severity, 'red');
  assert.equal(r.worst.condition, 'distraction');
});

test('rollup: worst pick is stable — first-listed wins on a tie', () => {
  const r = rollup([
    { condition: 'distraction', severity: 'red', reason: 'a' },
    { condition: 'contradiction', severity: 'red', reason: 'b' },
  ]);
  assert.equal(r.worst.condition, 'distraction');
});

test('rollup: red alert carries a suggested action', () => {
  const r = rollup([{ condition: 'distraction', severity: 'red', reason: 'context 90% full' }]);
  assert.ok(r.alert);
  assert.match(r.alert, /distraction/i);
  assert.ok(r.alert.length > 0);
});

test('rollup: yellow produces no interrupt alert', () => {
  const r = rollup([{ condition: 'confusion', severity: 'yellow', reason: '31 tools' }]);
  assert.equal(r.alert, null);
});

test('rollup: empty list => green', () => {
  const r = rollup([]);
  assert.equal(r.severity, 'green');
  assert.equal(r.worst, null);
});

test('rollup: ignores unknown/garbage severities safely', () => {
  const r = rollup([
    { condition: 'x', severity: 'banana' },
    { condition: 'confusion', severity: 'yellow' },
  ]);
  assert.equal(r.severity, 'yellow');
});

test('rollup: undefined input => green, no throw', () => {
  const r = rollup(undefined);
  assert.equal(r.severity, 'green');
});

test('SEVERITY_ORDER ranks red > yellow > green', () => {
  assert.ok(SEVERITY_ORDER.red > SEVERITY_ORDER.yellow);
  assert.ok(SEVERITY_ORDER.yellow > SEVERITY_ORDER.green);
});
