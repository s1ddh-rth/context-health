'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultSessionState } = require('../bin/lib/state.js');
const sig = require('../bin/lib/session-signals.js');

const CONFIG = {
  detectors: {
    distraction: { recentToolCallWindow: 20, repetitionRateYellow: 0.30, repetitionRateRed: 0.50, contextFillYellow: 50, contextFillRed: 85 },
    confusion: { recentCallWindow: 10, activeToolYellow: 30, toolErrorRateYellow: 0.05, toolErrorRateRed: 0.10 },
  },
};

function fresh() { return defaultSessionState('s'); }

test('recordToolCall appends a signature and tracks the active tool', () => {
  const s = fresh();
  sig.recordToolCall(s, 'Grep', { pattern: 'x' });
  assert.equal(s.recentToolCalls.length, 1);
  assert.equal(s.recentToolCalls[0].name, 'Grep');
  assert.ok(s.activeTools.includes('Grep'));
});

test('recordToolCall keeps activeTools distinct', () => {
  const s = fresh();
  sig.recordToolCall(s, 'Grep', { pattern: 'x' });
  sig.recordToolCall(s, 'Grep', { pattern: 'y' });
  assert.equal(s.activeTools.filter((t) => t === 'Grep').length, 1);
});

test('recentToolCalls is bounded', () => {
  const s = fresh();
  for (let i = 0; i < sig.MAX_RECENT_TOOL_CALLS + 25; i++) sig.recordToolCall(s, 'T', { i });
  assert.equal(s.recentToolCalls.length, sig.MAX_RECENT_TOOL_CALLS);
});

test('recordToolResult records error flag and bounds the list', () => {
  const s = fresh();
  sig.recordToolResult(s, 'Bash', { is_error: true });
  assert.equal(s.recentCalls.length, 1);
  assert.equal(s.recentCalls[0].isError, true);
});

test('isErrorOutput: strong error signals only (precision over recall)', () => {
  assert.equal(sig.isErrorOutput({ is_error: true }), true);
  assert.equal(sig.isErrorOutput({ error: 'boom' }), true);
  assert.equal(sig.isErrorOutput('Error: command not found'), true);
  // benign outputs that merely mention the word should NOT trip it
  assert.equal(sig.isErrorOutput('handled the error gracefully'), false);
  assert.equal(sig.isErrorOutput({ stdout: 'ok' }), false);
  assert.equal(sig.isErrorOutput(''), false);
  assert.equal(sig.isErrorOutput(undefined), false);
});

test('recordPrompt increments the turn counter and captures the goal on first turn', () => {
  const s = fresh();
  sig.recordPrompt(s, 'build a parser for CSV files');
  assert.equal(s.turnCount, 1);
  assert.equal(s.goalText, 'build a parser for CSV files');
  sig.recordPrompt(s, 'now add tests');
  assert.equal(s.turnCount, 2);
  // goal is captured once and not overwritten
  assert.equal(s.goalText, 'build a parser for CSV files');
});

test('prompts list is bounded', () => {
  const s = fresh();
  for (let i = 0; i < sig.MAX_PROMPTS + 8; i++) sig.recordPrompt(s, 'p' + i);
  assert.equal(s.prompts.length, sig.MAX_PROMPTS);
});

test('evaluate: healthy session rolls up to green', () => {
  const s = fresh();
  sig.recordToolCall(s, 'Read', { file: 'a' });
  sig.recordToolResult(s, 'Read', { stdout: 'ok' });
  const r = sig.evaluate(s, { fillPercent: 20 }, CONFIG);
  assert.equal(r.severity, 'green');
});

test('evaluate: repeated identical calls roll up to red distraction', () => {
  const s = fresh();
  for (let i = 0; i < 20; i++) sig.recordToolCall(s, 'Grep', { pattern: 'same' });
  const r = sig.evaluate(s, { fillPercent: 10 }, CONFIG);
  assert.equal(r.severity, 'red');
  assert.equal(r.worst.condition, 'distraction');
});

test('evaluate: high context fill alone rolls up to red', () => {
  const s = fresh();
  const r = sig.evaluate(s, { fillPercent: 92 }, CONFIG);
  assert.equal(r.severity, 'red');
  assert.ok(r.alert);
});

test('evaluate: unknown fill (statusline field missing) still evaluates tool signals', () => {
  const s = fresh();
  for (let i = 0; i < 20; i++) sig.recordToolCall(s, 'Grep', { pattern: 'same' });
  const r = sig.evaluate(s, { fillPercent: null }, CONFIG);
  assert.equal(r.severity, 'red');
});
