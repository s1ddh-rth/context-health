'use strict';

/**
 * Config loader. Detector thresholds are provisional defaults (build-spec 5.6)
 * and must be tunable without editing plugin files. Resolution order, later
 * wins:
 *
 *   1. BUILT_IN_DEFAULTS (below) — guarantees the tool works even if every file
 *      is missing or corrupt.
 *   2. The plugin's own settings.json (${CLAUDE_PLUGIN_ROOT}/settings.json).
 *   3. A user override at ~/.claude/context-health-config.json — where the
 *      phase-3 slash commands write tuned values, so users never edit plugin JSON.
 *
 * Every read is defensive: a missing or corrupt file is skipped, never thrown.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Mirror of settings.json, embedded so detectors never depend on a file existing.
const BUILT_IN_DEFAULTS = {
  enabled: true,
  muted: false,
  context: {
    autocompactBufferTokens: 33000,
    defaultWindowSize: 200000,
  },
  detectors: {
    distraction: {
      enabled: true,
      recentToolCallWindow: 20,
      repetitionRateYellow: 0.30,
      repetitionRateRed: 0.50,
      contextFillYellow: 50,
      contextFillRed: 85,
    },
    confusion: {
      enabled: true,
      recentCallWindow: 10,
      activeToolYellow: 30,
      toolErrorRateYellow: 0.05,
      toolErrorRateRed: 0.10,
    },
    goalDrift: {
      enabled: true,
      rollingActivityTurns: 5,
      minTurnsBeforeFiring: 3,
      cosineSimilarityYellow: 0.70,
      cosineSimilarityRed: 0.50,
      weakAnchorMinTokens: 12,
      weakAnchorThresholdPenalty: 0.05,
    },
    // Merged clash+poisoning. Opt-in, OFF by default; when enabled it uses the
    // user's own API key or a local LLM (no paid tier — the project is
    // open-source). Lands in Phase 3.
    contradiction: {
      enabled: false,
      judge: 'byok',
      model: 'claude-haiku-4-5-20251001',
      rollingTurnWindow: 10,
      eventsYellow: 1,
      eventsRed: 2,
    },
  },
  statusline: {
    showWhenHealthy: true,
    healthyLabel: 'ctx ok',
  },
};

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, override) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  if (!isPlainObject(override)) return out;
  for (const key of Object.keys(override)) {
    const ov = override[key];
    if (isPlainObject(ov) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], ov);
    } else {
      out[key] = isPlainObject(ov) ? deepMerge({}, ov) : ov;
    }
  }
  return out;
}

function readJsonFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (_e) {
    return null;
  }
  const start = raw.indexOf('{');
  if (start === -1) return null;
  try {
    const parsed = JSON.parse(raw.slice(start));
    return isPlainObject(parsed) ? parsed : null;
  } catch (_e) {
    return null;
  }
}

function pluginSettingsPath() {
  const root = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..', '..');
  return path.join(root, 'settings.json');
}

function userOverridePath() {
  if (process.env.CONTEXT_HEALTH_CONFIG_FILE) return process.env.CONTEXT_HEALTH_CONFIG_FILE;
  return path.join(os.homedir(), '.claude', 'context-health-config.json');
}

function loadConfig() {
  // Start from a deep copy so we never mutate the defaults.
  let cfg = deepMerge({}, BUILT_IN_DEFAULTS);

  const pluginSettings = readJsonFile(pluginSettingsPath());
  if (pluginSettings) cfg = deepMerge(cfg, pluginSettings);

  const userOverride = readJsonFile(userOverridePath());
  if (userOverride) cfg = deepMerge(cfg, userOverride);

  return cfg;
}

module.exports = { loadConfig, deepMerge, BUILT_IN_DEFAULTS };
