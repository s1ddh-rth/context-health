#!/usr/bin/env node
'use strict';

/**
 * Config CLI for the slash-command skills. Writes to the user override config
 * (~/.claude/context-health-config.json) and the session state — so users tune
 * the tool in plain language and never edit plugin JSON.
 *
 * Usage:
 *   ch-config.js contradiction on|off
 *   ch-config.js set <dotted.path> <value>
 *   ch-config.js threshold <detector> <key> <value>
 *   ch-config.js reset-goal
 *   ch-config.js mute | unmute
 *   ch-config.js show
 *
 * Prints one clear human-readable line (the skill injects this output). Never
 * throws to the caller.
 */

const uc = require('./lib/user-config.js');
const { loadConfig } = require('./lib/config.js');
const { loadState, updateSession } = require('./lib/state.js');

function mostRecentSessionId() {
  const all = loadState();
  let best = null;
  let bestTs = -1;
  for (const id of Object.keys(all)) {
    const ts = (all[id] && all[id].updatedAt) || 0;
    if (ts > bestTs) { bestTs = ts; best = id; }
  }
  return best;
}

function setOverride(dottedPath, value) {
  const cfg = uc.readUserConfig();
  uc.setDeep(cfg, dottedPath, value);
  uc.writeUserConfig(cfg);
}

function cmdContradiction(arg, backend, model) {
  const on = arg === 'on' || arg === 'true' || arg === 'enable';
  const off = arg === 'off' || arg === 'false' || arg === 'disable';
  if (!on && !off) return 'Usage: contradiction on|off [byok|local] [model]';
  setOverride('detectors.contradiction.enabled', on);

  // Optional backend: `local` (OpenAI-compatible endpoint, e.g. Ollama — no key,
  // no cost) or `byok` (the user's own Claude key). An optional model name follows.
  let backendNote = '';
  if (on && backend != null) {
    const b = String(backend).toLowerCase();
    if (b !== 'local' && b !== 'byok') return 'Usage: contradiction on|off [byok|local] [model]';
    setOverride('detectors.contradiction.judge', b);
    if (model != null && String(model).trim()) setOverride('detectors.contradiction.model', String(model));
    backendNote = b === 'local'
      ? ` Judge: LOCAL (${model || 'llama3.1'}) via an OpenAI-compatible endpoint at localhost:11434 — start it first (e.g. \`ollama serve\` + \`ollama pull ${model || 'llama3.1'}\`). No key, no cost.`
      : ' Judge: BYOK (your own Claude API key). Install the extra once: `cd worker && uv sync --extra contradiction`.';
  }

  // Clear any stale computed verdict on the current session so a previously
  // written red doesn't flash the instant the detector is (re)enabled, before
  // the worker's next throttled recheck.
  const id = mostRecentSessionId();
  if (id) updateSession(id, (s) => { if (s.computed) s.computed.contradiction = null; return s; });
  return on
    ? 'Contradiction detector ENABLED (opt-in). It uses your OWN Claude API key or a local model — this plugin never bills you.' +
      (backendNote || ' Default judge is BYOK; add `local <model>` to use a local model instead.') +
      ' Applies on the next config read.'
    : 'Contradiction detector disabled.';
}

function cmdSet(pathArg, valueArg) {
  if (!pathArg || valueArg === undefined) return 'Usage: set <dotted.path> <value>';
  const value = uc.coerceValue(valueArg);
  setOverride(pathArg, value);
  return `Set ${pathArg} = ${JSON.stringify(value)} (saved to your user override).`;
}

function cmdThreshold(detector, key, valueArg) {
  if (!detector || !key || valueArg === undefined) {
    return 'Usage: threshold <detector> <key> <value>  (e.g. threshold goalDrift cosineSimilarityYellow 0.6)';
  }
  const value = uc.coerceValue(valueArg);
  setOverride(`detectors.${detector}.${key}`, value);
  return `Set detectors.${detector}.${key} = ${JSON.stringify(value)}.`;
}

function cmdResetGoal() {
  const id = mostRecentSessionId();
  if (!id) return 'No active session found to reset.';
  updateSession(id, (s) => {
    s.goalText = null;
    s.goalAnchorWeak = false;
    // Clear the grace-period anchor too so the next prompt's new goal gets a fresh
    // minTurnsBeforeFiring window instead of inheriting this long session's turns.
    s.goalSetTurn = null;
    if (s.computed) s.computed.goalDrift = null;
    return s;
  });
  return `Goal anchor cleared for session ${id}. Your next prompt becomes the new goal.`;
}

function cmdMute(muted) {
  const id = mostRecentSessionId();
  if (!id) return 'No active session found to mute.';
  updateSession(id, (s) => { s.muted = muted; return s; });
  return muted
    ? `Muted context-health warnings for session ${id} (ambient fill still shows).`
    : `Unmuted context-health warnings for session ${id}.`;
}

function cmdShow() {
  const cfg = loadConfig();
  const d = cfg.detectors;
  const lines = [
    'Context Health — current settings',
    `  enabled: ${cfg.enabled !== false}   muted (global): ${cfg.muted === true}`,
    `  distraction: repetition>${d.distraction.repetitionRateYellow}/${d.distraction.repetitionRateRed}, fill>${d.distraction.contextFillYellow}/${d.distraction.contextFillRed}`,
    `  confusion: tools>${d.confusion.activeToolYellow}, errors>${d.confusion.toolErrorRateYellow}/${d.confusion.toolErrorRateRed}`,
    `  goalDrift: ${d.goalDrift.enabled ? 'on' : 'off'}, cosine<${d.goalDrift.cosineSimilarityYellow}/${d.goalDrift.cosineSimilarityRed}`,
    `  contradiction (opt-in): ${d.contradiction.enabled ? 'on' : 'off'}`,
  ];
  return lines.join('\n');
}

function main() {
  const [cmd, a, b, c] = process.argv.slice(2);
  let out;
  switch (cmd) {
    case 'contradiction': out = cmdContradiction(a, b, c); break;
    case 'set': out = cmdSet(a, b); break;
    case 'threshold': out = cmdThreshold(a, b, c); break;
    case 'reset-goal': out = cmdResetGoal(); break;
    case 'mute': out = cmdMute(!(a === 'off' || a === 'unmute' || a === 'false')); break;
    case 'unmute': out = cmdMute(false); break;
    case 'show': out = cmdShow(); break;
    default:
      out = 'Usage: contradiction on|off | set <path> <value> | threshold <detector> <key> <value> | reset-goal | mute | unmute | show';
  }
  process.stdout.write(out + '\n');
}

try {
  main();
} catch (e) {
  process.stdout.write('context-health config error: ' + (e && e.message ? e.message : 'unknown') + '\n');
}
