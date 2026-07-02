'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSession } = require('../eval/lib/build-session.js');
const { runCorpus, mismatches } = require('../eval/lib/runner.js');
const { loadConfig } = require('../bin/lib/config.js');

const CONFIG = loadConfig();

// --- build-session ---

test('buildSession: repeated identical calls create repetition', () => {
  const s = buildSession({ toolCalls: [{ name: 'Grep', input: { p: 'x' }, repeat: 20 }] });
  assert.equal(s.recentToolCalls.length, 20);
  assert.equal(s.activeTools.length, 1);
});

test('buildSession: distinctTools adds that many distinct tools', () => {
  const s = buildSession({ distinctTools: 31 });
  assert.equal(s.activeTools.length, 31);
});

test('buildSession: toolResults set error flags', () => {
  const s = buildSession({ toolResults: [{ error: true, repeat: 3 }, { error: false, repeat: 7 }] });
  assert.equal(s.recentCalls.filter((c) => c.isError).length, 3);
});

test('buildSession: computed drift is attached', () => {
  const s = buildSession({ computed: { goalDrift: { severity: 'red' } } });
  assert.equal(s.computed.goalDrift.severity, 'red');
});

// --- the labeled corpus must classify perfectly (regression + precision guard) ---

const corpus = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'eval', 'corpus', 'structural.json'), 'utf8')
);

test('every labeled fixture is predicted exactly right', () => {
  const { metrics, pairs } = runCorpus(corpus, CONFIG);
  const wrong = mismatches(pairs);
  assert.deepEqual(wrong, [], 'mismatches: ' + JSON.stringify(wrong, null, 2));
  // and precision must be perfect on the labeled set (no false alarms)
  for (const det of Object.keys(metrics)) {
    assert.equal(metrics[det].precision, 1, `${det} precision`);
    assert.equal(metrics[det].exact, 1, `${det} exact accuracy`);
  }
});

test('runCorpus reports per-detector support', () => {
  const { metrics } = runCorpus(corpus, CONFIG);
  assert.ok(metrics.distraction.n >= 5);
  assert.ok(metrics.confusion.n >= 5);
  assert.ok(metrics.overall.n >= 10);
  // goalDrift is deliberately not a standalone metric (injected, not detected here)
  assert.equal(metrics.goalDrift, undefined);
});
