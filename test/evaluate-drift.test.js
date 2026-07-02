'use strict';

// Verifies the Node side surfaces the worker-computed goalDrift (and holds back
// the opt-in contradiction detector) correctly.

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultSessionState } = require('../bin/lib/state.js');
const { evaluate } = require('../bin/lib/session-signals.js');
const { render } = require('../bin/lib/render.js');

const CONFIG = {
  detectors: {
    distraction: { recentToolCallWindow: 20, repetitionRateYellow: 0.30, repetitionRateRed: 0.50, contextFillYellow: 50, contextFillRed: 85 },
    confusion: { recentCallWindow: 10, activeToolYellow: 30, toolErrorRateYellow: 0.05, toolErrorRateRed: 0.10 },
    goalDrift: { enabled: true },
    contradiction: { enabled: false },
  },
};

function withDrift(sev, reason) {
  const s = defaultSessionState('s');
  s.computed.goalDrift = { severity: sev, reason, similarity: 0.4 };
  return s;
}

test('worker-computed red drift rolls up to red', () => {
  const r = evaluate(withDrift('red', 'drifting from goal (40% similar)'), { fillPercent: 10 }, CONFIG);
  assert.equal(r.severity, 'red');
  assert.equal(r.worst.condition, 'goalDrift');
});

test('yellow drift rolls up to yellow', () => {
  const r = evaluate(withDrift('yellow', 'drifting from goal (63% similar)'), { fillPercent: 10 }, CONFIG);
  assert.equal(r.severity, 'yellow');
  assert.equal(r.worst.condition, 'goalDrift');
});

test('green drift contributes nothing', () => {
  const r = evaluate(withDrift('green', 'on goal'), { fillPercent: 10 }, CONFIG);
  assert.equal(r.severity, 'green');
});

test('no computed drift yet => drift is simply absent (not an error)', () => {
  const s = defaultSessionState('s'); // computed.goalDrift is null
  const r = evaluate(s, { fillPercent: 10 }, CONFIG);
  assert.equal(r.severity, 'green');
});

test('goalDrift is suppressed when the detector is disabled in config', () => {
  const cfg = Object.assign({}, CONFIG, {
    detectors: Object.assign({}, CONFIG.detectors, { goalDrift: { enabled: false } }),
  });
  const r = evaluate(withDrift('red', 'x'), { fillPercent: 10 }, cfg);
  assert.equal(r.severity, 'green');
});

test('opt-in contradiction is not surfaced while disabled even if computed', () => {
  const s = defaultSessionState('s');
  s.computed.contradiction = { severity: 'red', reason: 'conflict' };
  const r = evaluate(s, { fillPercent: 10 }, CONFIG);
  assert.equal(r.severity, 'green');
});

test('render shows a friendly "goal drift" label, not the camelCase key', () => {
  const r = evaluate(withDrift('red', 'drifting from goal (40% similar)'), { fillPercent: 10 }, CONFIG);
  const line = render(r, { color: false });
  assert.match(line, /goal drift/);
  assert.doesNotMatch(line, /goalDrift/);
});
