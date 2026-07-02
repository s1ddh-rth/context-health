'use strict';

/**
 * Proves the cross-process lock in updateSession prevents lost updates. Spawns
 * many concurrent Node processes that each increment the same session's counter;
 * without the lock, interleaved read-modify-write would lose most increments.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const execFileP = promisify(execFile);
const ROOT = path.join(__dirname, '..');
const STATE = path.join(os.tmpdir(), 'ch-conc-' + process.pid + '.json');

const CHILD = `
const s = require(${JSON.stringify(path.join(ROOT, 'bin/lib/state.js'))});
s.updateSession('shared', (x) => { x.turnCount = (x.turnCount || 0) + 1; return x; });
`;

test.beforeEach(() => { try { fs.rmSync(STATE, { force: true }); } catch (_e) {} });
test.after(() => {
  try { fs.rmSync(STATE, { force: true }); } catch (_e) {}
  try { fs.rmdirSync(STATE + '.lock'); } catch (_e) {}
});

test('concurrent writers to the same session do not lose updates', async () => {
  const N = 15;
  const env = Object.assign({}, process.env, { CONTEXT_HEALTH_STATE_FILE: STATE });
  const runs = [];
  for (let i = 0; i < N; i++) {
    runs.push(execFileP('node', ['-e', CHILD], { env }));
  }
  await Promise.all(runs);

  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  assert.equal(state.shared.turnCount, N, `expected all ${N} increments, got ${state.shared.turnCount}`);
});

test('concurrent writers to different sessions all survive', async () => {
  const N = 15;
  const env = Object.assign({}, process.env, { CONTEXT_HEALTH_STATE_FILE: STATE });
  const child = (id) => `
    const s = require(${JSON.stringify(path.join(ROOT, 'bin/lib/state.js'))});
    s.updateSession(${JSON.stringify('sess-' + id)}, (x) => { x.turnCount = 1; return x; });
  `;
  const runs = [];
  for (let i = 0; i < N; i++) runs.push(execFileP('node', ['-e', child(i)], { env }));
  await Promise.all(runs);

  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const present = Object.keys(state).filter((k) => k.startsWith('sess-'));
  assert.equal(present.length, N, `expected ${N} sessions, got ${present.length}`);
});
