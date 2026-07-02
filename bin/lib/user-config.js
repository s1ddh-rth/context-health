'use strict';

/**
 * Read/write the user override config at ~/.claude/context-health-config.json —
 * the file the slash-command skills edit so users never touch plugin JSON. The
 * main config loader (config.js) overlays this file last, so anything written
 * here wins.
 *
 * Defensive throughout: a missing/corrupt file reads as {}, and writes are
 * atomic (temp + rename).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function getUserConfigPath() {
  if (process.env.CONTEXT_HEALTH_CONFIG_FILE) return process.env.CONTEXT_HEALTH_CONFIG_FILE;
  return path.join(os.homedir(), '.claude', 'context-health-config.json');
}

function readUserConfig() {
  let raw;
  try {
    raw = fs.readFileSync(getUserConfigPath(), 'utf8');
  } catch (_e) {
    return {};
  }
  const start = raw.indexOf('{');
  if (start === -1) return {};
  try {
    const parsed = JSON.parse(raw.slice(start));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_e) {
    return {};
  }
}

function writeUserConfig(obj) {
  const file = getUserConfigPath();
  const dir = path.dirname(file);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_e) {}
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Set a nested value by dotted path, creating intermediate objects.
function setDeep(obj, dottedPath, value) {
  const keys = String(dottedPath).split('.').filter(Boolean);
  if (!keys.length) return obj;
  // Refuse prototype-pollution paths outright.
  if (keys.some((k) => UNSAFE_KEYS.has(k))) return obj;
  let node = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!node[k] || typeof node[k] !== 'object' || Array.isArray(node[k])) node[k] = {};
    node = node[k];
  }
  node[keys[keys.length - 1]] = value;
  return obj;
}

// Coerce a CLI string into boolean / number / string.
function coerceValue(str) {
  if (typeof str !== 'string') return str;
  const t = str.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t !== '' && !Number.isNaN(Number(t))) return Number(t);
  return str;
}

module.exports = { getUserConfigPath, readUserConfig, writeUserConfig, setDeep, coerceValue };
