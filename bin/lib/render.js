'use strict';

/**
 * Renders the evaluate() result into the one-line statusline string.
 *
 * Design (build-spec 8.2): stay quiet until something is wrong. When healthy we
 * still show the corrected context fill — that is the "beat a plain token
 * counter" win. When yellow/red we name the worst condition and a short reason,
 * colored so it is glanceable.
 *
 * Pure and defensive: any malformed input renders a safe fallback, never throws.
 */

const COLORS = {
  green: '[32m',
  yellow: '[33m',
  red: '[31m',
  dim: '[2m',
  reset: '[0m',
};

const DOT = '●'; // ●

// Friendly display names for conditions whose internal key isn't presentable.
const CONDITION_LABELS = {
  goalDrift: 'goal drift',
  contradiction: 'contradiction',
};

function colorize(text, color, enabled) {
  if (!enabled) return text;
  const code = COLORS[color];
  if (!code) return text;
  return code + text + COLORS.reset;
}

function fillLabel(fillPercent) {
  if (!Number.isFinite(fillPercent)) return null;
  return `${Math.round(fillPercent)}%`;
}

function render(result, opts) {
  const o = opts || {};
  const color = o.color !== false; // default on
  const r = result && typeof result === 'object' ? result : { severity: 'green' };
  const severity = r.severity === 'red' || r.severity === 'yellow' ? r.severity : 'green';

  if (severity === 'green') {
    if (o.showWhenHealthy === false) return '';
    const fill = fillLabel(r.fillPercent);
    const label = fill ? `ctx ${fill}` : (o.healthyLabel || 'ctx ok');
    return colorize(`${DOT} ${label}`, 'green', color);
  }

  const worst = r.worst && typeof r.worst === 'object' ? r.worst : {};
  const rawCondition = worst.condition || 'context';
  const condition = CONDITION_LABELS[rawCondition] || rawCondition;
  const reason = worst.reason ? `: ${worst.reason}` : '';
  const text = `${DOT} ${condition}${reason}`;
  return colorize(text, severity, color);
}

module.exports = { render, colorize, COLORS };
