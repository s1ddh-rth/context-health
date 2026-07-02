'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseJsonLoose } = require('../bin/lib/io.js');

test('parseJsonLoose parses a clean object', () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
});

test('parseJsonLoose skips leading shell-rc junk before the object', () => {
  assert.deepEqual(parseJsonLoose('welcome to bash\n{"a":1}'), { a: 1 });
});

test('parseJsonLoose returns {} on empty / non-json / non-string', () => {
  assert.deepEqual(parseJsonLoose(''), {});
  assert.deepEqual(parseJsonLoose('nope'), {});
  assert.deepEqual(parseJsonLoose(undefined), {});
  assert.deepEqual(parseJsonLoose(null), {});
});

test('parseJsonLoose returns {} on a JSON array (we want an object)', () => {
  // arrays start with '[', no '{' at top level unless nested — treat as empty
  assert.deepEqual(parseJsonLoose('[1,2,3]'), {});
});
