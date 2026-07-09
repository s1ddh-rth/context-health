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
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

const DOT = '●'; // ●

// Control / ANSI-escape chars (C0 + DEL + C1). Stripped from any reason before it
// reaches the terminal so untrusted text can't inject newlines or escape sequences.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

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
  // Defense in depth: a reason can originate from an LLM judge (untrusted). Strip
  // control/escape chars and collapse whitespace so nothing can inject newlines or
  // terminal escape sequences into this single colored line.
  const safeReason = typeof worst.reason === 'string'
    ? worst.reason.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim()
    : '';
  const reason = safeReason ? `: ${safeReason}` : '';
  const head = colorize(`${DOT} ${condition}${reason}`, severity, color);

  // Show the remedy inline, dimmed, so the fix is one glance away — not buried
  // in a notification the user may miss. Falls back cleanly when absent.
  const tip = typeof worst.action === 'string' && worst.action
    ? colorize(` → ${worst.action}`, 'dim', color)
    : '';
  return head + tip;
}

module.exports = { render, colorize, COLORS };
