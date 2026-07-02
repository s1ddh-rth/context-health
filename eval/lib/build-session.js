'use strict';

/**
 * Builds a real session-state object from a compact fixture spec, using the same
 * recorders the hooks use — so the eval exercises the production code path, not a
 * reimplementation.
 *
 * Spec fields (all optional):
 *   prompts:       string[]                       -> recordPrompt each
 *   toolCalls:     [{name, input?, repeat?}]      -> recordToolCall (repeat x)
 *   distinctTools: number                         -> N distinct tool calls
 *   toolResults:   [{name?, error?, repeat?}]     -> recordToolResult (repeat x)
 *   computed:      object                         -> merged into session.computed
 */

const { defaultSessionState } = require('../../bin/lib/state.js');
const sig = require('../../bin/lib/session-signals.js');

function buildSession(spec) {
  const s = defaultSessionState((spec && spec.name) || 'eval');

  const prompts = (spec && spec.prompts) || [];
  for (const p of prompts) sig.recordPrompt(s, p);

  const toolCalls = (spec && spec.toolCalls) || [];
  for (const tc of toolCalls) {
    const n = tc.repeat || 1;
    for (let i = 0; i < n; i++) sig.recordToolCall(s, tc.name, tc.input || {});
  }

  if (spec && Number.isFinite(spec.distinctTools)) {
    for (let i = 0; i < spec.distinctTools; i++) sig.recordToolCall(s, 'tool_' + i, { i });
  }

  const toolResults = (spec && spec.toolResults) || [];
  for (const tr of toolResults) {
    const n = tr.repeat || 1;
    const output = tr.error ? { is_error: true } : { stdout: 'ok' };
    for (let i = 0; i < n; i++) sig.recordToolResult(s, tr.name || 'T', output);
  }

  if (spec && spec.computed && typeof spec.computed === 'object') {
    s.computed = Object.assign(s.computed, spec.computed);
  }

  return s;
}

module.exports = { buildSession };
