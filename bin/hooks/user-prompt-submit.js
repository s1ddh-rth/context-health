#!/usr/bin/env node
'use strict';

/**
 * UserPromptSubmit hook. Records the prompt: increments the turn counter and,
 * on the first prompt of the session, captures it as the goal (phase-2 embeds
 * it for drift detection).
 *
 * Prints nothing in phase 1 (no context injection). Always exits 0. Kept
 * synchronous so the goal is captured before the turn proceeds, and so phase 2
 * can inject a red-alert systemMessage here without restructuring.
 */

const { readStdinJson } = require('../lib/io.js');
const { loadConfig } = require('../lib/config.js');
const { updateSession } = require('../lib/state.js');
const { recordPrompt } = require('../lib/session-signals.js');

async function main() {
  const input = await readStdinJson();
  const config = loadConfig();
  if (config.enabled === false) return;

  const sessionId = input.session_id || 'unknown';
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';

  updateSession(sessionId, (s) => recordPrompt(s, prompt));
}

main().catch(() => {}).finally(() => process.exit(0));
