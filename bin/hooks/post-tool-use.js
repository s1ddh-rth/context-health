#!/usr/bin/env node
'use strict';

/**
 * PostToolUse hook. Records the tool result with an error flag so the confusion
 * detector can track the tool-error rate. Handles both `tool_output` (spec) and
 * `tool_response` (newer Claude Code) field names.
 *
 * Pure observation. Prints nothing. Always exits 0.
 */

const { readStdinJson } = require('../lib/io.js');
const { loadConfig } = require('../lib/config.js');
const { updateSession } = require('../lib/state.js');
const { recordToolResult } = require('../lib/session-signals.js');

async function main() {
  const input = await readStdinJson();
  const config = loadConfig();
  if (config.enabled === false) return;

  const sessionId = input.session_id || 'unknown';
  const output = input.tool_output != null ? input.tool_output : input.tool_response;
  updateSession(sessionId, (s) => recordToolResult(s, input.tool_name, output));
}

main().catch(() => {}).finally(() => process.exit(0));
