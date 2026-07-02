#!/usr/bin/env node
'use strict';

/**
 * Statusline renderer. Receives the live context metrics JSON on stdin, reads
 * the session's accumulated signals from the shared state file, evaluates the
 * Tier-A detectors, and prints one colored line.
 *
 * Contract with the rest of the plugin:
 *   - This is the ONLY place with access to live context_window metrics.
 *   - It is read-only on the state file (only hooks write raw signals; only the
 *     phase-2 worker writes computed fields). Keeping it read-only keeps it fast
 *     and avoids fighting the hooks over the file.
 *   - It must never crash: any error prints an empty line and exits 0.
 */

const { readStdinJson } = require('../bin/lib/io.js');
const { loadConfig } = require('../bin/lib/config.js');
const { computeContextFill } = require('../bin/lib/context-math.js');
const { readSession } = require('../bin/lib/state.js');
const { evaluate } = require('../bin/lib/session-signals.js');
const { render } = require('../bin/lib/render.js');

async function main() {
  const input = await readStdinJson();
  const config = loadConfig();

  if (config.enabled === false) {
    process.stdout.write('');
    return;
  }

  const fill = computeContextFill(input, config.context);
  const sessionId = input.session_id || 'unknown';
  const session = readSession(sessionId);

  // A muted session (global or per-session) shows the ambient fill but never
  // escalates to a warning.
  const muted = config.muted === true || session.muted === true;

  const result = evaluate(session, { fillPercent: fill.ok ? fill.fillPercent : null }, config);
  if (muted && result.severity !== 'green') {
    result.severity = 'green';
    result.worst = null;
  }

  const line = render(result, {
    showWhenHealthy: config.statusline ? config.statusline.showWhenHealthy !== false : true,
    healthyLabel: config.statusline ? config.statusline.healthyLabel : 'ctx ok',
    color: true,
  });

  process.stdout.write(line);
}

main().catch(() => {
  // Never let the statusline crash the interface.
  try { process.stdout.write(''); } catch (_e) {}
  process.exit(0);
});
