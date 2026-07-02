#!/usr/bin/env node
'use strict';

/**
 * Stop hook. Marks the turn boundary. Critically, it checks `stop_hook_active`
 * first and exits immediately when true — a Stop hook that does anything to make
 * Claude continue can otherwise re-fire itself forever. We never continue here;
 * this is pure housekeeping. Prints nothing. Always exits 0.
 */

const { readStdinJson } = require('../lib/io.js');
const { loadConfig } = require('../lib/config.js');
const { updateSession } = require('../lib/state.js');

async function main() {
  const input = await readStdinJson();

  // Loop guard: bail before doing anything if we're already inside a stop-hook
  // continuation.
  if (input.stop_hook_active === true) return;

  const config = loadConfig();
  if (config.enabled === false) return;

  const sessionId = input.session_id || 'unknown';
  // Touch the record so updatedAt advances (keeps recency-based pruning honest).
  updateSession(sessionId, (s) => s);
}

main().catch(() => {}).finally(() => process.exit(0));
