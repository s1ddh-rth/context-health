#!/usr/bin/env node
'use strict';

/**
 * PreToolUse hook. Records the tool call (name + normalized params) so the
 * distraction detector can spot repeats, and tracks the tool in the active-tool
 * set for the confusion detector.
 *
 * Pure observation — never blocks or denies. Prints nothing. Always exits 0.
 */

const { readStdinJson } = require('../lib/io.js');
const { loadConfig } = require('../lib/config.js');
const { updateSession } = require('../lib/state.js');
const { recordToolCall } = require('../lib/session-signals.js');

async function main() {
  const input = await readStdinJson();
  const config = loadConfig();
  if (config.enabled === false) return;

  const sessionId = input.session_id || 'unknown';
  updateSession(sessionId, (s) => recordToolCall(s, input.tool_name, input.tool_input));
}

main().catch(() => {}).finally(() => process.exit(0));
