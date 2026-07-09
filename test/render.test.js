'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { render, colorize, COLORS } = require('../bin/lib/render.js');

function green() { return { severity: 'green', worst: null, fillPercent: 20 }; }

test('healthy render shows the fill percent when showWhenHealthy is on', () => {
  const out = render(green(), { showWhenHealthy: true, healthyLabel: 'ctx ok', color: false });
  assert.match(out, /ctx/i);
  assert.match(out, /20%/);
});

test('healthy render is empty when showWhenHealthy is off', () => {
  const out = render(green(), { showWhenHealthy: false, color: false });
  assert.equal(out, '');
});

test('healthy render with unknown fill falls back to the label, no NaN', () => {
  const out = render({ severity: 'green', worst: null, fillPercent: null }, { showWhenHealthy: true, healthyLabel: 'ctx ok', color: false });
  assert.match(out, /ctx ok/);
  assert.doesNotMatch(out, /NaN/);
});

test('yellow render names the worst condition and its reason', () => {
  const r = { severity: 'yellow', worst: { condition: 'confusion', reason: '31 tools active' }, fillPercent: 40 };
  const out = render(r, { color: false });
  assert.match(out, /confusion/i);
  assert.match(out, /31 tools/);
});

test('yellow/red render appends the remedy tip inline when worst carries an action', () => {
  const r = { severity: 'yellow', worst: { condition: 'confusion', reason: '31 tools active', action: 'disable unneeded tools' }, fillPercent: 40 };
  const out = render(r, { color: false });
  assert.match(out, /confusion/i);
  assert.match(out, /→/);
  assert.match(out, /disable unneeded tools/);
});

test('render omits the tip cleanly when no action is present', () => {
  const r = { severity: 'yellow', worst: { condition: 'confusion', reason: '31 tools' }, fillPercent: 40 };
  const out = render(r, { color: false });
  assert.doesNotMatch(out, /→/);
});

test('red render names the condition', () => {
  const r = { severity: 'red', worst: { condition: 'distraction', reason: 'context 90% full' }, fillPercent: 90 };
  const out = render(r, { color: false });
  assert.match(out, /distraction/i);
});

test('red output carries the red ANSI color when color is on', () => {
  const r = { severity: 'red', worst: { condition: 'distraction', reason: 'x' }, fillPercent: 90 };
  const out = render(r, { color: true });
  assert.ok(out.includes(COLORS.red), 'expected red ANSI code');
  assert.ok(out.includes(COLORS.reset), 'expected reset code');
});

test('render strips newlines and terminal escape sequences from an untrusted reason', () => {
  const evil = { severity: 'red', worst: { condition: 'contradiction', reason: 'a\n\x1b[31mFAKE\x1b[0m\x1b]0;title\x07 b' } };
  const out = render(evil, { color: false });
  assert.ok(!out.includes('\n'), 'must stay one line');
  assert.ok(!out.includes('\x1b'), 'must not contain ESC bytes');
  assert.match(out, /contradiction/i);
});

test('render never throws on a malformed result', () => {
  assert.doesNotThrow(() => render(undefined, {}));
  assert.doesNotThrow(() => render({ severity: 'red' }, {}));
  const out = render({ severity: 'red' }, { color: false });
  assert.ok(typeof out === 'string');
});

test('colorize is a no-op when color is disabled', () => {
  assert.equal(colorize('hi', 'red', false), 'hi');
});
