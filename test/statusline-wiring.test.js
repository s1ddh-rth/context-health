'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const sw = require('../bin/lib/statusline-wiring.js');

const REPO_ROOT = path.join(__dirname, '..');
const HEALTHY_FIXTURE = fs.readFileSync(path.join(REPO_ROOT, 'fixtures', 'statusline-healthy.json'), 'utf8');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('materialize copies the standalone renderer structure and stamps the version', () => {
  const dataDir = path.join(tmp('ch-mat-'), 'data');
  const res = sw.materialize({ root: REPO_ROOT, dataDir });
  assert.equal(res.ok, true);
  assert.equal(res.changed, true);

  const cur = path.join(dataDir, 'current');
  // statusline/ + bin/ must be preserved as siblings, plus settings.json two dirs
  // up from bin/lib is what config.js resolves when CLAUDE_PLUGIN_ROOT is unset.
  assert.ok(fs.existsSync(path.join(cur, 'statusline', 'statusline.js')));
  assert.ok(fs.existsSync(path.join(cur, 'bin', 'lib', 'config.js')));
  assert.ok(fs.existsSync(path.join(cur, 'settings.json')));
  assert.ok(fs.existsSync(path.join(cur, 'version')));
});

test('materialize is idempotent — a second call does no work', () => {
  const dataDir = path.join(tmp('ch-mat2-'), 'data');
  const first = sw.materialize({ root: REPO_ROOT, dataDir });
  const second = sw.materialize({ root: REPO_ROOT, dataDir });
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(second.ok, true);
});

test('materialize returns a clean failure when no data dir is available', () => {
  const saved = process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;
  try {
    const res = sw.materialize({ root: REPO_ROOT });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'no-data-dir');
  } finally {
    if (saved !== undefined) process.env.CLAUDE_PLUGIN_DATA = saved;
  }
});

// The cross-platform smoke test: the materialized launcher must run as a bare
// `node <path>` with NO plugin env vars set (exactly how a user-settings
// statusLine runs it), resolve its own config, and print a colored line. This is
// what catches a broken sibling-structure copy or a bad require() path on Windows.
test('materialized launcher runs standalone (no plugin env) and renders', () => {
  const dataDir = path.join(tmp('ch-run-'), 'data');
  sw.materialize({ root: REPO_ROOT, dataDir });
  const launcher = path.join(dataDir, 'current', 'statusline', 'statusline.js');

  const env = Object.assign({}, process.env);
  delete env.CLAUDE_PLUGIN_ROOT;
  delete env.CLAUDE_PLUGIN_DATA;

  const out = execFileSync('node', [launcher], { input: HEALTHY_FIXTURE, env, encoding: 'utf8' });
  assert.match(out, /ctx/i);
  assert.doesNotMatch(out, /NaN/);
});

test('launcherPath and ourCommand are Windows/Git-Bash safe (forward slashes, quoted)', () => {
  const dataDir = path.join('C:', 'Users', 'John Doe', '.claude', 'plugins', 'data', 'context-health-context-health');
  const lp = sw.launcherPath(dataDir);
  assert.ok(!lp.includes('\\'), 'launcher path must not contain backslashes');
  assert.match(lp, /statusline\/statusline\.js$/);
  const cmd = sw.ourCommand(dataDir);
  assert.match(cmd, /^node "/); // double-quoted so a space in the path is safe
  assert.ok(!cmd.includes('\\'));
});

test('wireStatusline writes our statusLine and preserves other keys, with a backup', () => {
  const dir = tmp('ch-wire-');
  const settingsFile = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ theme: 'dark' }, null, 2));
  const dataDir = path.join(dir, 'data');
  process.env.CONTEXT_HEALTH_CC_SETTINGS = settingsFile;
  try {
    const res = sw.wireStatusline({ root: REPO_ROOT, dataDir });
    assert.equal(res.ok, true);
    assert.equal(res.changed, true);
    const written = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    assert.equal(written.theme, 'dark'); // untouched
    assert.equal(written.statusLine.command, sw.ourCommand(dataDir));
    assert.ok(fs.existsSync(settingsFile + '.context-health.bak'));
  } finally {
    delete process.env.CONTEXT_HEALTH_CC_SETTINGS;
  }
});

test('wireStatusline is idempotent on a settings file already wired to us', () => {
  const dir = tmp('ch-wire2-');
  const settingsFile = path.join(dir, 'settings.json');
  const dataDir = path.join(dir, 'data');
  process.env.CONTEXT_HEALTH_CC_SETTINGS = settingsFile;
  try {
    const first = sw.wireStatusline({ root: REPO_ROOT, dataDir });
    const second = sw.wireStatusline({ root: REPO_ROOT, dataDir });
    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.equal(second.ok, true);
  } finally {
    delete process.env.CONTEXT_HEALTH_CC_SETTINGS;
  }
});

test('wireStatusline refuses to clobber a foreign statusline', () => {
  const dir = tmp('ch-foreign-');
  const settingsFile = path.join(dir, 'settings.json');
  const foreign = { statusLine: { type: 'command', command: 'node ~/my-git-status.js' }, theme: 'light' };
  fs.writeFileSync(settingsFile, JSON.stringify(foreign, null, 2));
  const dataDir = path.join(dir, 'data');
  process.env.CONTEXT_HEALTH_CC_SETTINGS = settingsFile;
  try {
    const res = sw.wireStatusline({ root: REPO_ROOT, dataDir });
    assert.equal(res.ok, false);
    assert.equal(res.blocked, true);
    const after = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    assert.equal(after.statusLine.command, 'node ~/my-git-status.js'); // untouched
  } finally {
    delete process.env.CONTEXT_HEALTH_CC_SETTINGS;
  }
});

test('wireStatusline migrates our own old ${CLAUDE_PLUGIN_ROOT} instruction', () => {
  const dir = tmp('ch-migrate-');
  const settingsFile = path.join(dir, 'settings.json');
  const old = { statusLine: { type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/statusline/statusline.js"' } };
  fs.writeFileSync(settingsFile, JSON.stringify(old, null, 2));
  const dataDir = path.join(dir, 'data');
  process.env.CONTEXT_HEALTH_CC_SETTINGS = settingsFile;
  try {
    const res = sw.wireStatusline({ root: REPO_ROOT, dataDir });
    assert.equal(res.ok, true);
    assert.equal(res.changed, true);
    const after = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    assert.equal(after.statusLine.command, sw.ourCommand(dataDir));
  } finally {
    delete process.env.CONTEXT_HEALTH_CC_SETTINGS;
  }
});

test('wireStatusline refuses to edit a settings.json that is not valid JSON', () => {
  const dir = tmp('ch-badjson-');
  const settingsFile = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsFile, '{ this is not json ');
  const dataDir = path.join(dir, 'data');
  process.env.CONTEXT_HEALTH_CC_SETTINGS = settingsFile;
  try {
    const res = sw.wireStatusline({ root: REPO_ROOT, dataDir });
    assert.equal(res.ok, false);
    assert.match(res.message, /not valid JSON/i);
    // The user's file must be left exactly as it was.
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), '{ this is not json ');
  } finally {
    delete process.env.CONTEXT_HEALTH_CC_SETTINGS;
  }
});

test('firstRunNudge fires once when unwired, then stays silent', () => {
  const dir = tmp('ch-nudge-');
  const settingsFile = path.join(dir, 'settings.json'); // absent = unwired
  const dataDir = path.join(dir, 'data');
  process.env.CONTEXT_HEALTH_CC_SETTINGS = settingsFile;
  try {
    const first = sw.firstRunNudge({ dataDir });
    assert.ok(first && /setup-statusline/.test(first), 'first call should nudge');
    const second = sw.firstRunNudge({ dataDir });
    assert.equal(second, null, 'second call must be silent (flag recorded)');
    assert.ok(fs.existsSync(path.join(dataDir, '.setup-nudged')));
  } finally {
    delete process.env.CONTEXT_HEALTH_CC_SETTINGS;
  }
});

test('firstRunNudge stays silent once the statusline is wired', () => {
  const dir = tmp('ch-nudge2-');
  const settingsFile = path.join(dir, 'settings.json');
  const dataDir = path.join(dir, 'data');
  process.env.CONTEXT_HEALTH_CC_SETTINGS = settingsFile;
  try {
    sw.wireStatusline({ root: REPO_ROOT, dataDir });
    assert.equal(sw.isStatuslineWired(dataDir), true);
    assert.equal(sw.firstRunNudge({ dataDir }), null);
  } finally {
    delete process.env.CONTEXT_HEALTH_CC_SETTINGS;
  }
});

test('unwireStatusline removes our statusLine but leaves a foreign one', () => {
  const dir = tmp('ch-unwire-');
  const settingsFile = path.join(dir, 'settings.json');
  const dataDir = path.join(dir, 'data');
  process.env.CONTEXT_HEALTH_CC_SETTINGS = settingsFile;
  try {
    sw.wireStatusline({ root: REPO_ROOT, dataDir });
    const res = sw.unwireStatusline({ dataDir });
    assert.equal(res.changed, true);
    const after = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    assert.equal(after.statusLine, undefined);

    // Foreign line is not removed.
    fs.writeFileSync(settingsFile, JSON.stringify({ statusLine: { command: 'node ~/mine.js' } }, null, 2));
    const res2 = sw.unwireStatusline({ dataDir });
    assert.equal(res2.changed, false);
    const after2 = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    assert.equal(after2.statusLine.command, 'node ~/mine.js');
  } finally {
    delete process.env.CONTEXT_HEALTH_CC_SETTINGS;
  }
});
