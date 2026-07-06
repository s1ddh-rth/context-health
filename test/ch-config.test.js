'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const STATE = path.join(os.tmpdir(), 'ch-cli-state-' + process.pid + '.json');
const CFG = path.join(os.tmpdir(), 'ch-cli-cfg-' + process.pid + '.json');

function run(args) {
  const env = Object.assign({}, process.env, {
    CONTEXT_HEALTH_STATE_FILE: STATE,
    CONTEXT_HEALTH_CONFIG_FILE: CFG,
  });
  return execFileSync('node', [path.join(ROOT, 'bin', 'ch-config.js'), ...args], { env, encoding: 'utf8' });
}
function runHook(script, obj) {
  const env = Object.assign({}, process.env, { CONTEXT_HEALTH_STATE_FILE: STATE, CONTEXT_HEALTH_CONFIG_FILE: CFG });
  execFileSync('node', [path.join(ROOT, 'bin', 'hooks', script)], { input: JSON.stringify(obj), env, encoding: 'utf8' });
}
function readCfg() { return JSON.parse(fs.readFileSync(CFG, 'utf8')); }
function readState() { return JSON.parse(fs.readFileSync(STATE, 'utf8')); }

test.beforeEach(() => {
  for (const f of [STATE, CFG]) { try { fs.rmSync(f, { force: true }); } catch (_e) {} }
  runHook('session-start.js', { session_id: 's', source: 'startup' });
  runHook('user-prompt-submit.js', { session_id: 's', prompt: 'build a thing' });
});
test.after(() => { for (const f of [STATE, CFG]) { try { fs.rmSync(f, { force: true }); } catch (_e) {} } });

test('contradiction on writes enabled:true to the override', () => {
  run(['contradiction', 'on']);
  assert.equal(readCfg().detectors.contradiction.enabled, true);
});

test('contradiction off writes enabled:false', () => {
  run(['contradiction', 'off']);
  assert.equal(readCfg().detectors.contradiction.enabled, false);
});

test('toggling contradiction clears a stale computed verdict on the session', () => {
  // simulate the worker having written a red verdict earlier
  const { updateSession } = require('../bin/lib/state.js');
  const prevEnv = process.env.CONTEXT_HEALTH_STATE_FILE;
  process.env.CONTEXT_HEALTH_STATE_FILE = STATE;
  updateSession('s', (s) => { s.computed.contradiction = { severity: 'red', reason: 'x' }; return s; });
  process.env.CONTEXT_HEALTH_STATE_FILE = prevEnv;
  run(['contradiction', 'on']);
  assert.equal(readState().s.computed.contradiction, null);
});

test('threshold sets a nested detector value with type coercion', () => {
  run(['threshold', 'goalDrift', 'cosineSimilarityYellow', '0.62']);
  assert.equal(readCfg().detectors.goalDrift.cosineSimilarityYellow, 0.62);
});

test('mute sets session.muted true; mute off clears it', () => {
  run(['mute']);
  assert.equal(readState().s.muted, true);
  run(['mute', 'off']);
  assert.equal(readState().s.muted, false);
});

test('reset-goal clears goalText on the current session', () => {
  assert.equal(readState().s.goalText, 'build a thing');
  run(['reset-goal']);
  assert.equal(readState().s.goalText, null);
});

test('show prints a settings summary reflecting the calibrated drift default', () => {
  const out = run(['show']);
  assert.match(out, /goalDrift/);
  assert.match(out, /0\.55/); // calibrated yellow (evidence-verified)
});

test('unknown command prints usage, exit 0', () => {
  const out = run(['bogus']);
  assert.match(out, /Usage/);
});
