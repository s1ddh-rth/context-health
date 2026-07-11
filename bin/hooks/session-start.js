#!/usr/bin/env node
'use strict';

/**
 * SessionStart hook. Initializes the session's state record.
 *
 *   - startup / clear : fresh session, wipe any stale record for this id.
 *   - resume / compact: keep the existing record (goal, turns, signals survive);
 *     just ensure it exists and is touched.
 *
 * Almost always prints nothing — SessionStart stdout is injected into Claude's
 * context, and we avoid noise there. The one deliberate exception is a single
 * first-run nudge when the statusline is not yet wired: a plugin cannot register a
 * global statusline itself, so without this a fresh install looks silently broken.
 * Always exits 0.
 *
 * Kept synchronous (not async) so it finishes before the first UserPromptSubmit
 * captures the goal — an async reset could otherwise race and wipe the goal.
 */

const { readStdinJson } = require('../lib/io.js');
const { loadConfig } = require('../lib/config.js');
const { updateSession, defaultSessionState } = require('../lib/state.js');
const { firstRunNudge } = require('../lib/statusline-wiring.js');

async function main() {
  const input = await readStdinJson();
  const config = loadConfig();
  if (config.enabled === false) return;

  const sessionId = input.session_id || 'unknown';
  const source = input.source || 'startup';

  updateSession(sessionId, (prev) => {
    if (source === 'startup' || source === 'clear') {
      // Fresh slate, but preserve a manual mute the user may have set.
      const fresh = defaultSessionState(sessionId);
      fresh.muted = !!prev.muted;
      return fresh;
    }
    // resume / compact / anything else: keep what we have.
    return prev;
  });

  // One-time nudge if the statusline isn't wired yet, so a fresh install never
  // looks like it does nothing. Fires at most once (recorded in the DATA dir) and
  // only ever informs — it never touches the user's settings.
  const nudge = firstRunNudge();
  if (nudge) process.stdout.write(nudge + '\n');
}

main().catch(() => {}).finally(() => process.exit(0));
