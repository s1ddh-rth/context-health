'use strict';

/**
 * Confusion detector (Tier A — free, local, no model).
 *
 * Too many tools or a rising rate of failed tool calls pulls the model toward
 * wrong choices. Two signals:
 *
 *   1. Active tool count — distinct tools available this session. Selection
 *      accuracy is known to collapse past ~30 tools. Yellow only (a big tool
 *      surface is a risk, not a failure by itself).
 *   2. Tool-error rate over the recent call window — a call is an error when its
 *      output signals failure. Yellow above the low threshold, red above the high one.
 *
 * Worst signal wins. Pure function; thresholds from config. Defensive.
 */

function severityRank(sev) {
  return sev === 'red' ? 2 : sev === 'yellow' ? 1 : 0;
}

function detectConfusion(input, config) {
  const cfg = config || {};
  const window = Number.isFinite(cfg.recentCallWindow) && cfg.recentCallWindow > 0 ? cfg.recentCallWindow : 20;
  const toolYellow = Number.isFinite(cfg.activeToolYellow) ? cfg.activeToolYellow : 30;
  const errYellow = Number.isFinite(cfg.toolErrorRateYellow) ? cfg.toolErrorRateYellow : 0.10;
  const errRed = Number.isFinite(cfg.toolErrorRateRed) ? cfg.toolErrorRateRed : 0.20;
  const minErrors = Number.isFinite(cfg.minErrorsToFire) && cfg.minErrorsToFire > 0 ? cfg.minErrorsToFire : 3;

  const activeToolCount = input && Number.isFinite(input.activeToolCount) ? input.activeToolCount : 0;
  const allCalls = input && Array.isArray(input.recentCalls) ? input.recentCalls : [];

  // --- tool-error signal ---
  const recent = allCalls.slice(-window);
  const total = recent.length;
  let errorCount = 0;
  for (const c of recent) {
    if (c && c.isError) errorCount++;
  }
  const toolErrorRate = total > 0 ? errorCount / total : 0;

  // Transient tool failures are routine in a real session (a failed Bash, a
  // not-yet-created file, a flaky test). Require an absolute minimum error COUNT
  // before the rate can fire, so two unlucky calls don't paint the line red — the
  // "cries wolf, gets disabled" outcome the precision-first design exists to avoid.
  let errSeverity = 'green';
  if (errorCount >= minErrors) {
    if (toolErrorRate > errRed) errSeverity = 'red';
    else if (toolErrorRate > errYellow) errSeverity = 'yellow';
  }

  // --- active-tool-count signal (yellow ceiling only) ---
  let toolSeverity = 'green';
  if (activeToolCount > toolYellow) toolSeverity = 'yellow';

  const severity = severityRank(errSeverity) >= severityRank(toolSeverity) ? errSeverity : toolSeverity;

  let reason = 'tools healthy';
  if (severity !== 'green') {
    const parts = [];
    if (severityRank(errSeverity) === severityRank(severity) && errSeverity !== 'green') {
      parts.push(`tool errors ${Math.round(toolErrorRate * 100)}%`);
    }
    if (severityRank(toolSeverity) === severityRank(severity) && toolSeverity !== 'green') {
      parts.push(`${activeToolCount} tools active`);
    }
    reason = parts.join(' + ');
  }

  return {
    severity,
    toolErrorRate,
    activeToolCount,
    reason,
    signals: { error: errSeverity, tools: toolSeverity },
  };
}

module.exports = { detectConfusion };
