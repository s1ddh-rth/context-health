#!/usr/bin/env node
'use strict';

/**
 * SessionStart hook (async): keep the CLAUDE_PLUGIN_DATA copy of the statusline
 * renderer in sync with the installed plugin version. This is what makes the
 * user's one-time statusLine wiring survive plugin updates — their settings point
 * at <DATA>/current/, and this refreshes <DATA>/current/ whenever the version
 * changes.
 *
 * Reads CLAUDE_PLUGIN_ROOT / CLAUDE_PLUGIN_DATA from the environment (both are
 * exported to plugin hook processes). The common path is a stamp read + string
 * compare — the actual copy only runs on a version change. Marked async in
 * hooks.json so it never sits on the session's critical path. Prints nothing,
 * never throws, always exits 0.
 */

const { loadConfig } = require('../lib/config.js');
const { materialize } = require('../lib/statusline-wiring.js');

async function main() {
  const config = loadConfig();
  if (config.enabled === false) return;
  materialize();
}

main().catch(() => {}).finally(() => process.exit(0));
