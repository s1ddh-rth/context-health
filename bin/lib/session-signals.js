'use strict';

/**
 * Pure transforms over a session-state object plus the detector evaluation.
 * These are the domain operations hooks and the statusline call. Keeping them
 * here (not inline in the hook scripts) means they are unit-tested and the hook
 * scripts stay thin glue.
 *
 * All record* functions mutate the passed session state and return it. None do
 * I/O — the caller wraps them in state.updateSession for persistence.
 */

const { normalizeToolCall } = require('./tool-signature.js');
const { detectDistraction } = require('./distraction.js');
const { detectConfusion } = require('./confusion.js');
const { rollup } = require('./severity.js');

const MAX_RECENT_TOOL_CALLS = 40;
const MAX_RECENT_CALLS = 40;
const MAX_PROMPTS = 10;
const MAX_GOAL_CHARS = 4000;
const MAX_ACTIVE_TOOLS = 100;

function pushBounded(arr, item, max) {
  arr.push(item);
  if (arr.length > max) arr.splice(0, arr.length - max);
  return arr;
}

// --- raw-signal recorders (called from hooks) ---

function trackActiveTool(s, name) {
  if (!name || s.activeTools.includes(name)) return;
  // Bounded: the confusion detector only compares the count to ~30, so a FIFO
  // cap well above that keeps the signal intact while preventing unbounded growth.
  pushBounded(s.activeTools, name, MAX_ACTIVE_TOOLS);
}

function recordToolCall(s, toolName, toolInput) {
  const { name, paramsKey } = normalizeToolCall(toolName, toolInput);
  pushBounded(s.recentToolCalls, { name, paramsKey }, MAX_RECENT_TOOL_CALLS);
  trackActiveTool(s, name);
  return s;
}

function recordToolResult(s, toolName, toolOutput) {
  const name = toolName != null ? String(toolName) : '';
  pushBounded(s.recentCalls, { name, isError: isErrorOutput(toolOutput) }, MAX_RECENT_CALLS);
  trackActiveTool(s, name);
  return s;
}

function recordPrompt(s, prompt) {
  const text = prompt != null ? String(prompt) : '';
  pushBounded(s.prompts, text, MAX_PROMPTS);
  s.turnCount = (s.turnCount || 0) + 1;
  if (!s.goalText && text.trim()) setGoal(s, text);
  return s;
}

function setGoal(s, text, weak) {
  const t = (text != null ? String(text) : '').slice(0, MAX_GOAL_CHARS);
  s.goalText = t;
  if (weak != null) s.goalAnchorWeak = !!weak;
  return s;
}

/**
 * Decide whether a PostToolUse output represents a failed call. Precision over
 * recall: only strong, unambiguous error signals count, so a benign output that
 * merely contains the word "error" does not inflate the error rate.
 */
function isErrorOutput(output) {
  if (output == null) return false;
  if (typeof output === 'object') {
    if (output.is_error === true || output.isError === true) return true;
    // A truthy error message counts; but a numeric 0 (some tools report
    // `error: 0` to mean "no error") must not.
    if (output.error != null && output.error !== '' && output.error !== false && output.error !== 0) return true;
    if (typeof output.status === 'string' && /^(error|failed)$/i.test(output.status)) return true;
    if (Number.isFinite(output.exit_code) && output.exit_code !== 0) return true;
    return false;
  }
  if (typeof output === 'string') {
    const head = output.slice(0, 200);
    // Anchored, well-known failure prefixes/markers only (precision over recall).
    // `\w*error` catches SyntaxError/TypeError/ValueError as well as bare "Error".
    return /^\s*(\w*error\b|traceback \(most recent call last\)|exception\b|fatal:|npm err!)/i.test(head) ||
      /\b(command not found|no such file or directory|permission denied|inputvalidationerror)\b/i.test(head);
  }
  return false;
}

// --- detector evaluation (called from statusline) ---

function evaluate(s, liveMetrics, config) {
  const cfg = (config && config.detectors) || {};
  const fillPercent = liveMetrics && Number.isFinite(liveMetrics.fillPercent) ? liveMetrics.fillPercent : null;

  const GREEN = { severity: 'green', reason: '' };

  // A detector can be turned off via config; a disabled detector contributes
  // green (never warns) rather than being skipped, so the roll-up stays simple.
  const distraction = cfg.distraction && cfg.distraction.enabled === false
    ? GREEN
    : detectDistraction({ recentToolCalls: s.recentToolCalls, fillPercent }, cfg.distraction);
  const confusion = cfg.confusion && cfg.confusion.enabled === false
    ? GREEN
    : detectConfusion({ activeToolCount: s.activeTools.length, recentCalls: s.recentCalls }, cfg.confusion);

  const detectorResults = [
    { condition: 'distraction', severity: distraction.severity, reason: distraction.reason },
    { condition: 'confusion', severity: confusion.severity, reason: confusion.reason },
  ];

  const rolled = rollup(detectorResults);
  return {
    severity: rolled.severity,
    worst: rolled.worst,
    alert: rolled.alert,
    fillPercent,
    distraction,
    confusion,
  };
}

module.exports = {
  recordToolCall,
  recordToolResult,
  recordPrompt,
  setGoal,
  isErrorOutput,
  evaluate,
  MAX_RECENT_TOOL_CALLS,
  MAX_RECENT_CALLS,
  MAX_PROMPTS,
  MAX_ACTIVE_TOOLS,
};
