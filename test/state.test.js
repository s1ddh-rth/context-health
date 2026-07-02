'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Point the state file at a throwaway location BEFORE requiring the module.
const TMP = path.join(os.tmpdir(), 'ch-state-test-' + process.pid + '.json');
process.env.CONTEXT_HEALTH_STATE_FILE = TMP;

const state = require('../bin/lib/state.js');

test.beforeEach(() => {
  try { fs.rmSync(TMP, { force: true }); } catch (_e) {}
});
test.after(() => {
  try { fs.rmSync(TMP, { force: true }); } catch (_e) {}
});

test('getStatePath honors the env override', () => {
  assert.equal(state.getStatePath(), TMP);
});

test('loadState on a missing file returns an empty object', () => {
  assert.deepEqual(state.loadState(), {});
});

test('readSession on unknown id returns a fresh default shape', () => {
  const s = state.readSession('sess-1');
  assert.equal(s.sessionId, 'sess-1');
  assert.equal(s.turnCount, 0);
  assert.ok(Array.isArray(s.recentToolCalls));
  assert.ok(Array.isArray(s.recentCalls));
  assert.ok(Array.isArray(s.activeTools));
});

test('updateSession persists and readSession reads it back', () => {
  state.updateSession('sess-1', (s) => {
    s.turnCount = 3;
    s.goalText = 'build the thing';
    return s;
  });
  const s = state.readSession('sess-1');
  assert.equal(s.turnCount, 3);
  assert.equal(s.goalText, 'build the thing');
});

test('sessions are independent by id', () => {
  state.updateSession('a', (s) => { s.turnCount = 1; return s; });
  state.updateSession('b', (s) => { s.turnCount = 9; return s; });
  assert.equal(state.readSession('a').turnCount, 1);
  assert.equal(state.readSession('b').turnCount, 9);
});

test('corrupt state file does not throw; treated as empty', () => {
  fs.writeFileSync(TMP, '{ this is not json ');
  assert.deepEqual(state.loadState(), {});
  // and we can still write over it
  state.updateSession('x', (s) => { s.turnCount = 2; return s; });
  assert.equal(state.readSession('x').turnCount, 2);
});

test('updateSession stamps updatedAt', () => {
  const before = Date.now();
  const s = state.updateSession('t', (x) => x);
  assert.ok(s.updatedAt >= before);
});

test('writes are atomic — no leftover temp file remains', () => {
  state.updateSession('t', (s) => { s.turnCount = 1; return s; });
  const dir = path.dirname(TMP);
  const leftovers = fs.readdirSync(dir).filter((f) => f.startsWith(path.basename(TMP)) && f.endsWith('.tmp'));
  assert.equal(leftovers.length, 0);
});

test('old sessions are pruned when the cap is exceeded', () => {
  for (let i = 0; i < state.MAX_SESSIONS + 5; i++) {
    state.updateSession('sess-' + i, (s) => { s.turnCount = i; return s; });
  }
  const all = state.loadState();
  assert.ok(Object.keys(all).length <= state.MAX_SESSIONS, `kept ${Object.keys(all).length}`);
  // the most recent session must survive
  assert.ok(all['sess-' + (state.MAX_SESSIONS + 4)]);
});
