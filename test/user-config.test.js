'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = path.join(os.tmpdir(), 'ch-usercfg-' + process.pid + '.json');
process.env.CONTEXT_HEALTH_CONFIG_FILE = TMP;

const uc = require('../bin/lib/user-config.js');

test.beforeEach(() => { try { fs.rmSync(TMP, { force: true }); } catch (_e) {} });
test.after(() => { try { fs.rmSync(TMP, { force: true }); } catch (_e) {} });

test('read on missing file => {}', () => {
  assert.deepEqual(uc.readUserConfig(), {});
});

test('write then read round-trips', () => {
  uc.writeUserConfig({ a: 1 });
  assert.deepEqual(uc.readUserConfig(), { a: 1 });
});

test('setDeep creates nested paths', () => {
  const o = {};
  uc.setDeep(o, 'detectors.goalDrift.cosineSimilarityYellow', 0.6);
  assert.equal(o.detectors.goalDrift.cosineSimilarityYellow, 0.6);
});

test('setDeep preserves siblings', () => {
  const o = { detectors: { goalDrift: { a: 1 } } };
  uc.setDeep(o, 'detectors.goalDrift.b', 2);
  assert.equal(o.detectors.goalDrift.a, 1);
  assert.equal(o.detectors.goalDrift.b, 2);
});

test('setDeep refuses prototype-pollution paths', () => {
  const o = {};
  uc.setDeep(o, '__proto__.polluted', 'x');
  uc.setDeep(o, 'constructor.prototype.polluted', 'x');
  assert.equal({}.polluted, undefined, 'Object.prototype must not be polluted');
  assert.equal(o.polluted, undefined);
});

test('coerceValue parses booleans and numbers', () => {
  assert.equal(uc.coerceValue('true'), true);
  assert.equal(uc.coerceValue('false'), false);
  assert.equal(uc.coerceValue('0.6'), 0.6);
  assert.equal(uc.coerceValue('30'), 30);
  assert.equal(uc.coerceValue('nord'), 'nord');
});

test('corrupt file reads as {} (no throw)', () => {
  fs.writeFileSync(TMP, 'garbage');
  assert.deepEqual(uc.readUserConfig(), {});
});

test('the override actually wins in the main config loader', () => {
  // write an override, then load the full config and confirm it applied
  uc.writeUserConfig({ detectors: { goalDrift: { cosineSimilarityYellow: 0.42 } } });
  delete require.cache[require.resolve('../bin/lib/config.js')];
  const { loadConfig } = require('../bin/lib/config.js');
  const cfg = loadConfig();
  assert.equal(cfg.detectors.goalDrift.cosineSimilarityYellow, 0.42);
});
