'use strict';

/**
 * Severity roll-up.
 *
 * The statusline shows a single worst condition. Overall color is red if any
 * detector is red, yellow if any is yellow, otherwise green. On a red event we
 * also build a one-line alert naming the condition and the suggested action
 * (usually: compact now, or start fresh and reload).
 *
 * Pure. Defensive against garbage severities and missing input.
 */

const SEVERITY_ORDER = { green: 0, yellow: 1, red: 2 };

// Suggested action per condition when it goes red — one short evidence-based
// remedy each (sources verified against the context-engineering literature):
//   distraction  -> compaction is Anthropic's "first lever" for a bloated context
//   confusion    -> curating the tool set restores selection accuracy (RAG-MCP)
//   goalDrift    -> re-anchoring to a durable goal note beats the fading transcript
//   contradiction-> a bad fact propagates through a summary, so start fresh
const SUGGESTED_ACTION = {
  distraction: 'compact now, or start fresh and reload the essentials',
  confusion: 'disable unneeded tools — fewer choices sharpen selection',
  goalDrift: 'restate your goal (keep it in a durable note) and re-anchor',
  contradiction: "start fresh; don't compact the bad fact forward",
};

function rank(sev) {
  return SEVERITY_ORDER[sev] != null ? SEVERITY_ORDER[sev] : 0;
}

function rollup(detectorResults) {
  const results = Array.isArray(detectorResults) ? detectorResults : [];

  let worst = null;
  let worstRank = 0;
  for (const r of results) {
    if (!r || typeof r !== 'object') continue;
    const rr = rank(r.severity);
    if (rr > worstRank) {
      worstRank = rr;
      worst = r;
    }
  }

  const severity = worstRank === 2 ? 'red' : worstRank === 1 ? 'yellow' : 'green';

  let alert = null;
  if (severity === 'red' && worst) {
    const cond = worst.condition || 'context';
    const action = SUGGESTED_ACTION[cond] || 'compact now or start a fresh session';
    const detail = worst.reason ? ` (${worst.reason})` : '';
    alert = `Context health: ${cond}${detail} — ${action}.`;
  }

  return {
    severity,
    worst: severity === 'green' ? null : worst,
    alert,
  };
}

module.exports = { rollup, SEVERITY_ORDER, SUGGESTED_ACTION };
