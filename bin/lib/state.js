'use strict';

/**
 * Shared-state file I/O — the contract between hooks, statusline, and (phase 2)
 * the warm worker. One JSON file at ~/.claude/context-health-state.json, keyed
 * by session_id. Last write wins.
 *
 * Rules baked in here:
 *   - Never throw on a missing or corrupt file. A broken state file must degrade
 *     to defaults, never crash a hook or the statusline.
 *   - Writes are atomic (temp file + rename) so a reader never sees a torn file.
 *   - Bounded growth: recent-signal arrays are capped by the caller via helpers;
 *     the session map itself is pruned to MAX_SESSIONS by recency.
 *
 * The path is resolved lazily from CONTEXT_HEALTH_STATE_FILE (tests) or the home
 * directory, so tests can redirect it.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_SESSIONS = 20;

function getStatePath() {
  if (process.env.CONTEXT_HEALTH_STATE_FILE) return process.env.CONTEXT_HEALTH_STATE_FILE;
  return path.join(os.homedir(), '.claude', 'context-health-state.json');
}

function defaultSessionState(sessionId) {
  return {
    sessionId: sessionId || null,
    createdAt: null,
    updatedAt: null,
    turnCount: 0,
    goalText: null,
    goalAnchorWeak: false,
    muted: false,
    recentToolCalls: [], // { name, paramsKey }
    recentCalls: [], // { name, isError }
    activeTools: [], // distinct tool names seen this session
    prompts: [], // recent user prompts (bounded) — feeds phase-2 drift window
    computed: {
      // written only by the phase-2 worker
      goalDrift: null,
      clash: null,
      poisoning: null,
    },
  };
}

function loadState() {
  const file = getStatePath();
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (_e) {
    return {}; // missing file
  }
  // Strip any leading junk a rogue shell-rc echo might prepend before the JSON.
  const start = raw.indexOf('{');
  if (start === -1) return {};
  try {
    const parsed = JSON.parse(raw.slice(start));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_e) {
    return {}; // corrupt
  }
}

function saveState(obj) {
  const file = getStatePath();
  const dir = path.dirname(file);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_e) {
    /* ignore */
  }
  // Unique temp name per writer to avoid two processes colliding on the temp.
  const tmp = file + '.' + process.pid + '.' + (globalThis.performance ? Math.floor(performance.now()) : 0) + '.tmp';
  const json = JSON.stringify(obj);
  try {
    fs.writeFileSync(tmp, json, 'utf8');
    fs.renameSync(tmp, file); // atomic replace (MoveFileEx on Windows replaces existing)
  } catch (_e) {
    try { fs.rmSync(tmp, { force: true }); } catch (_e2) {}
  }
}

// --- cross-process lock ---
// updateSession does a read-modify-write of the WHOLE session map. Once hooks
// run async (and once the phase-2 worker writes concurrently), two writers can
// interleave and the later rename would clobber the other's changes — even for a
// different session. A short-lived lock serializes the RMW so every update is
// preserved ("last write wins" then means per-turn ordering, not lost data).
//
// The lock is a directory (mkdir is atomic and exclusive across processes). If a
// holder crashes, the lock goes stale and is stolen after LOCK_STALE_MS.

const LOCK_RETRIES = 60;
const LOCK_WAIT_MS = 8;
const LOCK_STALE_MS = 2500;

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (_e) {
    // SharedArrayBuffer unavailable: busy-wait as a last resort.
    const end = Date.now() + ms;
    while (Date.now() < end) { /* spin */ }
  }
}

function acquireLock(lockDir) {
  for (let i = 0; i < LOCK_RETRIES; i++) {
    try {
      fs.mkdirSync(lockDir);
      return true;
    } catch (_e) {
      // Held by someone else — check whether it's stale, then wait and retry.
      try {
        const st = fs.statSync(lockDir);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          try { fs.rmdirSync(lockDir); } catch (_e2) {}
          continue;
        }
      } catch (_e3) {
        // lock vanished between mkdir and stat — retry immediately
        continue;
      }
      sleepSync(LOCK_WAIT_MS);
    }
  }
  return false; // proceed best-effort rather than dropping the signal
}

function releaseLock(lockDir) {
  try { fs.rmdirSync(lockDir); } catch (_e) {}
}

function pruneSessions(all) {
  const ids = Object.keys(all);
  if (ids.length <= MAX_SESSIONS) return all;
  // Keep the MAX_SESSIONS most recently updated.
  ids.sort((a, b) => (all[b] && all[b].updatedAt || 0) - (all[a] && all[a].updatedAt || 0));
  const keep = new Set(ids.slice(0, MAX_SESSIONS));
  const pruned = {};
  for (const id of ids) if (keep.has(id)) pruned[id] = all[id];
  return pruned;
}

function readSession(sessionId) {
  const all = loadState();
  const existing = all && all[sessionId];
  if (existing && typeof existing === 'object') {
    // Merge onto defaults so an older/partial record still has every field.
    return Object.assign(defaultSessionState(sessionId), existing);
  }
  return defaultSessionState(sessionId);
}

/**
 * Read-modify-write a single session atomically. `mutator(sessionState)` should
 * mutate and return the session state. Returns the persisted session state.
 */
function updateSession(sessionId, mutator) {
  const lockDir = getStatePath() + '.lock';
  const locked = acquireLock(lockDir);
  try {
    const all = loadState();
    const current = all[sessionId] && typeof all[sessionId] === 'object'
      ? Object.assign(defaultSessionState(sessionId), all[sessionId])
      : defaultSessionState(sessionId);

    if (current.createdAt == null) current.createdAt = Date.now();

    let next = current;
    try {
      const result = mutator(current);
      if (result && typeof result === 'object') next = result;
    } catch (_e) {
      next = current; // a bad mutator must not corrupt state
    }

    next.sessionId = sessionId;
    next.updatedAt = Date.now();

    all[sessionId] = next;
    saveState(pruneSessions(all));
    return next;
  } finally {
    if (locked) releaseLock(lockDir);
  }
}

module.exports = {
  getStatePath,
  defaultSessionState,
  loadState,
  saveState,
  readSession,
  updateSession,
  MAX_SESSIONS,
};
