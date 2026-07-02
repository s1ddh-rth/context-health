'use strict';

/**
 * Integration test: drives the actual hook + statusline entry scripts as child
 * processes with mock JSON on stdin (exactly how Claude Code invokes them),
 * against a throwaway state file. This is the "test before wiring" guarantee.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const STATE = path.join(os.tmpdir(), 'ch-integ-' + process.pid + '.json');

function run(scriptRelPath, stdinObj) {
  const env = Object.assign({}, process.env, { CONTEXT_HEALTH_STATE_FILE: STATE });
  return execFileSync('node', [path.join(ROOT, scriptRelPath)], {
    input: JSON.stringify(stdinObj),
    env,
    encoding: 'utf8',
  });
}

test.beforeEach(() => { try { fs.rmSync(STATE, { force: true }); } catch (_e) {} });
test.after(() => { try { fs.rmSync(STATE, { force: true }); } catch (_e) {} });

function readState() {
  return JSON.parse(fs.readFileSync(STATE, 'utf8'));
}

test('a full turn accumulates signals in the state file', () => {
  run('bin/hooks/session-start.js', { session_id: 's1', source: 'startup' });
  run('bin/hooks/user-prompt-submit.js', { session_id: 's1', prompt: 'build a CSV parser' });
  run('bin/hooks/pre-tool-use.js', { session_id: 's1', tool_name: 'Grep', tool_input: { pattern: 'x' } });
  run('bin/hooks/post-tool-use.js', { session_id: 's1', tool_name: 'Grep', tool_output: { stdout: 'ok' } });

  const s = readState().s1;
  assert.equal(s.turnCount, 1);
  assert.equal(s.goalText, 'build a CSV parser');
  assert.equal(s.recentToolCalls.length, 1);
  assert.equal(s.recentCalls.length, 1);
  assert.equal(s.recentCalls[0].isError, false);
  assert.deepEqual(s.activeTools, ['Grep']);
});

test('hooks print nothing to stdout', () => {
  const out1 = run('bin/hooks/session-start.js', { session_id: 's1', source: 'startup' });
  const out2 = run('bin/hooks/pre-tool-use.js', { session_id: 's1', tool_name: 'Read', tool_input: {} });
  assert.equal(out1, '');
  assert.equal(out2, '');
});

test('statusline renders a green line with corrected fill for a clean session', () => {
  run('bin/hooks/session-start.js', { session_id: 's1', source: 'startup' });
  const line = run('statusline/statusline.js', {
    session_id: 's1',
    context_window: { used_percentage: 20, context_window_size: 200000 },
  });
  // 20% of 200k = 40k tokens over a 167k usable window ~= 24%
  assert.match(line, /24%/);
  assert.ok(line.includes('[32m'), 'expected green ANSI');
});

test('statusline goes red when context fill is deep in the danger zone', () => {
  run('bin/hooks/session-start.js', { session_id: 's1', source: 'startup' });
  const line = run('statusline/statusline.js', {
    session_id: 's1',
    context_window: { used_percentage: 90, context_window_size: 200000 },
  });
  assert.match(line, /distraction/i);
  assert.ok(line.includes('[31m'), 'expected red ANSI');
});

test('repeated identical tool calls drive the statusline to red distraction', () => {
  run('bin/hooks/session-start.js', { session_id: 's1', source: 'startup' });
  for (let i = 0; i < 20; i++) {
    run('bin/hooks/pre-tool-use.js', { session_id: 's1', tool_name: 'Grep', tool_input: { pattern: 'same' } });
  }
  const line = run('statusline/statusline.js', {
    session_id: 's1',
    context_window: { used_percentage: 10, context_window_size: 200000 },
  });
  assert.match(line, /distraction/i);
});

test('stop hook exits 0 and writes nothing extra when stop_hook_active is true', () => {
  run('bin/hooks/session-start.js', { session_id: 's1', source: 'startup' });
  const before = readState().s1.updatedAt;
  const out = run('bin/hooks/stop.js', { session_id: 's1', stop_hook_active: true });
  assert.equal(out, '');
  // guard bailed early -> no touch
  assert.equal(readState().s1.updatedAt, before);
});

test('statusline never crashes on empty stdin', () => {
  const out = execFileSync('node', [path.join(ROOT, 'statusline/statusline.js')], {
    input: '',
    env: Object.assign({}, process.env, { CONTEXT_HEALTH_STATE_FILE: STATE }),
    encoding: 'utf8',
  });
  assert.equal(typeof out, 'string');
});
