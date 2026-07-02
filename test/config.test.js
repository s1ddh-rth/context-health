'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-cfg-root-'));
const OVERRIDE = path.join(os.tmpdir(), 'ch-cfg-override-' + process.pid + '.json');

process.env.CLAUDE_PLUGIN_ROOT = ROOT;
process.env.CONTEXT_HEALTH_CONFIG_FILE = OVERRIDE;

const { loadConfig, BUILT_IN_DEFAULTS } = require('../bin/lib/config.js');

function clearFiles() {
  try { fs.rmSync(path.join(ROOT, 'settings.json'), { force: true }); } catch (_e) {}
  try { fs.rmSync(OVERRIDE, { force: true }); } catch (_e) {}
}
test.beforeEach(clearFiles);
test.after(() => { clearFiles(); try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_e) {} });

test('loadConfig falls back to built-in defaults with no files present', () => {
  const cfg = loadConfig();
  assert.equal(cfg.context.autocompactBufferTokens, 33000);
  assert.equal(cfg.detectors.distraction.repetitionRateYellow, 0.30);
});

test('loadConfig reads the plugin settings.json', () => {
  fs.writeFileSync(path.join(ROOT, 'settings.json'), JSON.stringify({
    detectors: { distraction: { repetitionRateYellow: 0.99 } },
  }));
  const cfg = loadConfig();
  assert.equal(cfg.detectors.distraction.repetitionRateYellow, 0.99);
  // untouched keys still come from defaults
  assert.equal(cfg.detectors.distraction.repetitionRateRed, 0.50);
});

test('user override file deep-merges over plugin settings', () => {
  fs.writeFileSync(path.join(ROOT, 'settings.json'), JSON.stringify({
    detectors: { confusion: { activeToolYellow: 30 } },
  }));
  fs.writeFileSync(OVERRIDE, JSON.stringify({
    detectors: { confusion: { activeToolYellow: 45 } },
  }));
  const cfg = loadConfig();
  assert.equal(cfg.detectors.confusion.activeToolYellow, 45);
});

test('corrupt settings.json is ignored, defaults survive', () => {
  fs.writeFileSync(path.join(ROOT, 'settings.json'), 'not json at all');
  const cfg = loadConfig();
  assert.equal(cfg.detectors.distraction.repetitionRateYellow, 0.30);
});

test('BUILT_IN_DEFAULTS is self-contained (has every detector block)', () => {
  assert.ok(BUILT_IN_DEFAULTS.detectors.distraction);
  assert.ok(BUILT_IN_DEFAULTS.detectors.confusion);
  assert.ok(BUILT_IN_DEFAULTS.context);
});

test('merging never mutates BUILT_IN_DEFAULTS', () => {
  fs.writeFileSync(OVERRIDE, JSON.stringify({ detectors: { distraction: { repetitionRateYellow: 0.01 } } }));
  loadConfig();
  assert.equal(BUILT_IN_DEFAULTS.detectors.distraction.repetitionRateYellow, 0.30);
});
