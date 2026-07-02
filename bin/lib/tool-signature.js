'use strict';

/**
 * Turns a tool call into a stable signature so the distraction detector can
 * spot repeats. Two calls that mean the same thing must produce the same key:
 *   - object keys are sorted (order-independent)
 *   - strings are trimmed and inner whitespace collapsed
 *   - the key is length-bounded so a huge tool_input can't blow up the state file
 *   - circular / unserializable structures degrade gracefully instead of throwing
 *
 * Pure, no I/O.
 */

const MAX_KEY_LENGTH = 2048;

function normalizeString(s) {
  return s.replace(/\s+/g, ' ').trim();
}

// Deterministic, sorted-key serialization. Handles cycles by marking them.
function canonicalize(value, seen) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(normalizeString(value));
  if (t === 'number' || t === 'boolean') return String(value);
  if (t === 'undefined' || t === 'function') return 'null';
  if (t !== 'object') return JSON.stringify(String(value));

  if (seen.has(value)) return '"[circular]"';
  seen.add(value);

  let out;
  if (Array.isArray(value)) {
    out = '[' + value.map((v) => canonicalize(v, seen)).join(',') + ']';
  } else {
    const keys = Object.keys(value).sort();
    out = '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k], seen)).join(',') + '}';
  }
  seen.delete(value);
  return out;
}

function stableParamsKey(params) {
  let key;
  try {
    key = canonicalize(params, new Set());
  } catch (_e) {
    key = '';
  }
  if (key.length > MAX_KEY_LENGTH) key = key.slice(0, MAX_KEY_LENGTH);
  return key;
}

function normalizeToolCall(toolName, toolInput) {
  return {
    name: toolName != null ? String(toolName) : '',
    paramsKey: stableParamsKey(toolInput),
  };
}

module.exports = { normalizeToolCall, stableParamsKey, MAX_KEY_LENGTH };
