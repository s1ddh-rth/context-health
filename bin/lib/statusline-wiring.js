'use strict';

/**
 * Statusline wiring: the "option D" self-healing bridge.
 *
 * Why this exists — Claude Code CANNOT auto-register a global statusline from a
 * plugin. A plugin's settings.json honors only `agent` and `subagentStatusLine`,
 * and ${CLAUDE_PLUGIN_ROOT} is NOT substituted in a statusLine command a user
 * puts in their own ~/.claude/settings.json. So every user must add a statusLine
 * entry to their OWN settings once. The problem: the plugin installs to a
 * version-pinned cache path (…/cache/…/0.1.3/…) that is deleted ~7 days after
 * each update, so a hardcoded path rots on the next release.
 *
 * The fix: point the user's settings at a STABLE, version-independent path under
 * ${CLAUDE_PLUGIN_DATA} (documented to survive updates). The SessionStart hook
 * copies the current version's renderer into <DATA>/current/ on every version
 * change (materialize, below), so the target self-heals; the user's settings
 * never change again after the one-time wire.
 *
 * Everything here is defensive: it must never throw into a hook, and it must
 * never clobber a settings.json it cannot parse or a statusline it doesn't own.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CURRENT_SUBDIR = 'current';
const VERSION_STAMP = 'version';

// The minimum set that lets the statusline run standalone from <DATA>/current/:
//   - statusline/        the entry (statusline.js)
//   - bin/               statusline.js does require('../bin/lib/*.js')
//   - settings.json      config.js, when CLAUDE_PLUGIN_ROOT is unset (the case for
//                        a user-settings statusline), resolves settings.json two
//                        dirs up from bin/lib — i.e. <DATA>/current/settings.json
// The statusline/ + bin/ SIBLING structure must be preserved, not flattened.
const COPY_ITEMS = ['statusline', 'bin', 'settings.json'];

function toForwardSlash(p) {
  return String(p).replace(/\\/g, '/');
}

function resolveRoot(explicit) {
  const r = explicit || process.env.CLAUDE_PLUGIN_ROOT;
  if (r && String(r).trim()) return path.resolve(String(r).trim());
  // This file lives at <root>/bin/lib/statusline-wiring.js
  return path.resolve(__dirname, '..', '..');
}

function resolveDataDir(explicit) {
  const d = explicit || process.env.CLAUDE_PLUGIN_DATA;
  if (d && String(d).trim()) return path.resolve(String(d).trim());
  return null;
}

function currentDir(dataDir) {
  return path.join(dataDir, CURRENT_SUBDIR);
}

// The stable path a user's settings.json should invoke. Forward slashes so it is
// safe in a statusLine command routed through Git Bash on Windows (which eats
// backslashes as escapes) and fine on POSIX shells too.
function launcherPath(dataDir) {
  return toForwardSlash(path.join(currentDir(dataDir), 'statusline', 'statusline.js'));
}

// The node-resolving launcher inside the stable DATA copy. Routing the statusline
// through it (instead of a bare `node`) means a box where node is missing or off
// the non-interactive PATH shows a one-line hint instead of a blank/broken line.
// COPY_ITEMS includes 'bin', so ch-run.sh is always present alongside the copy.
function runnerPath(dataDir) {
  return toForwardSlash(path.join(currentDir(dataDir), 'bin', 'ch-run.sh'));
}

// The exact command string we write. Double-quoted so a space in the path
// (e.g. C:/Users/John Doe/…) is handled by both Git Bash and PowerShell. Invoked
// via `sh` so it degrades gracefully when node is absent (see bin/ch-run.sh).
function ourCommand(dataDir) {
  return 'sh "' + runnerPath(dataDir) + '" --statusline "' + launcherPath(dataDir) + '"';
}

function readVersion(root) {
  try {
    const raw = fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && parsed.version ? String(parsed.version) : null;
  } catch (_e) {
    return null;
  }
}

function readStamp(dataDir) {
  try {
    return fs.readFileSync(path.join(currentDir(dataDir), VERSION_STAMP), 'utf8').trim();
  } catch (_e) {
    return null;
  }
}

/**
 * Ensure <DATA>/current/ holds the installed version's renderer. Fast path (the
 * common case) is a stamp read + string compare; the real copy only runs when the
 * plugin version changed or the copy is missing. Returns a plain result object,
 * never throws.
 */
function materialize(opts) {
  opts = opts || {};
  const root = resolveRoot(opts.root);
  const dataDir = resolveDataDir(opts.dataDir);
  if (!dataDir) return { ok: false, reason: 'no-data-dir' };

  const version = readVersion(root) || '0.0.0';
  const target = currentDir(dataDir);
  const entry = path.join(target, 'statusline', 'statusline.js');

  if (readStamp(dataDir) === version && fs.existsSync(entry)) {
    return { ok: true, changed: false, version, launcher: launcherPath(dataDir) };
  }

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = path.join(dataDir, '.current.' + process.pid + '.tmp');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });

    for (const item of COPY_ITEMS) {
      const src = path.join(root, item);
      if (!fs.existsSync(src)) continue;
      fs.cpSync(src, path.join(tmp, item), { recursive: true });
    }
    fs.writeFileSync(path.join(tmp, VERSION_STAMP), version, 'utf8');

    // Swap into place. renameSync onto an existing dir fails on Windows, so drop
    // the old copy first. A concurrent SessionStart could race in the small gap;
    // the contents are identical for a given version, so last-writer-wins is safe
    // and a render landing mid-swap self-heals on the next tick.
    fs.rmSync(target, { recursive: true, force: true });
    try {
      fs.renameSync(tmp, target);
    } catch (_e) {
      fs.cpSync(tmp, target, { recursive: true });
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  } catch (e) {
    return { ok: false, reason: (e && e.message) || 'copy-failed' };
  }
  return { ok: true, changed: true, version, launcher: launcherPath(dataDir) };
}

// Location of the user's real Claude Code settings. The env override is a test seam.
function userSettingsPath() {
  if (process.env.CONTEXT_HEALTH_CC_SETTINGS) return process.env.CONTEXT_HEALTH_CC_SETTINGS;
  return path.join(os.homedir(), '.claude', 'settings.json');
}

// Is an existing statusLine command one WE own (safe to replace/migrate)? When we
// know the data dir, match our exact stable launcher path first — the most precise
// signal. Otherwise fall back to recognizing our renderer by path shape (covers a
// working-tree dev path) and the old, broken ${CLAUDE_PLUGIN_ROOT} instruction we
// used to ship. Anything else is treated as the user's own and never touched.
function isOurCommand(cmd, dataDir) {
  if (typeof cmd !== 'string') return false;
  if (dataDir) {
    if (cmd === ourCommand(dataDir)) return true;
    if (cmd.includes(launcherPath(dataDir))) return true;
  }
  const c = cmd.toLowerCase();
  const mentionsOurRenderer = c.includes('statusline/statusline.js') && c.includes('context-health');
  const oldBrokenToken = c.includes('${claude_plugin_root}') && c.includes('statusline');
  return mentionsOurRenderer || oldBrokenToken;
}

// Read ~/.claude/settings.json as strict JSON. Missing file -> empty object.
// A parse error is reported (never silently overwritten — it is the user's file).
function readSettingsStrict(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (_e) {
    return { ok: true, value: {}, missing: true };
  }
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      return { ok: false, parseError: 'not a JSON object' };
    }
    return { ok: true, value: v };
  } catch (e) {
    return { ok: false, parseError: (e && e.message) || 'invalid JSON' };
  }
}

function writeSettingsAtomic(file, obj) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * Point the user's ~/.claude/settings.json statusLine at the stable renderer.
 * Materializes the target first so it always exists. Idempotent, additive, backs
 * up before writing, and refuses to overwrite a foreign statusline. Returns a
 * result with a human-readable `message`; never throws.
 */
function wireStatusline(opts) {
  opts = opts || {};
  const dataDir = resolveDataDir(opts.dataDir);
  if (!dataDir) {
    return {
      ok: false,
      message: 'CLAUDE_PLUGIN_DATA is not available here. Run this through the ' +
        '/context-health:setup-statusline slash command so Claude Code can supply the path.',
    };
  }

  const mat = materialize({ root: opts.root, dataDir });
  if (!mat.ok) {
    return { ok: false, message: 'Could not prepare the statusline renderer (' + mat.reason + ').' };
  }

  const file = userSettingsPath();
  const parsed = readSettingsStrict(file);
  if (!parsed.ok) {
    return {
      ok: false,
      message: 'Refusing to edit ' + file + ' — it is not valid JSON (' + parsed.parseError +
        '). Fix or remove it, then re-run setup.',
    };
  }

  const settings = parsed.value;
  const desired = { type: 'command', command: ourCommand(dataDir) };
  const existing = settings.statusLine;
  const existingCmd = existing && typeof existing === 'object' ? existing.command : undefined;

  if (existingCmd === desired.command) {
    return { ok: true, changed: false, message: 'Statusline is already wired to the stable path:\n  ' + desired.command };
  }

  if (existingCmd && !isOurCommand(existingCmd, dataDir)) {
    return {
      ok: false,
      blocked: true,
      message: 'You already have a custom statusLine:\n  ' + existingCmd +
        '\n\ncontext-health will NOT overwrite it. To use context-health instead, set your ' +
        'statusLine command to:\n  ' + desired.command +
        '\n…or remove your statusLine and run setup again.',
    };
  }

  if (!parsed.missing) {
    try { fs.copyFileSync(file, file + '.context-health.bak'); } catch (_e) {}
  }
  const before = existingCmd || '(none)';
  settings.statusLine = desired;
  writeSettingsAtomic(file, settings);

  return {
    ok: true,
    changed: true,
    message: 'Wired context-health statusline in ' + file + '\n  before: ' + before +
      '\n  after:  ' + desired.command +
      (parsed.missing ? '' : '\n  backup: ' + path.basename(file) + '.context-health.bak') +
      '\nRestart Claude Code (or open a new session) to see it.',
  };
}

/** Remove a context-health statusLine we own; leave a foreign one untouched. */
function unwireStatusline(opts) {
  opts = opts || {};
  const file = userSettingsPath();
  const parsed = readSettingsStrict(file);
  if (!parsed.ok) {
    return { ok: false, message: 'Refusing to edit ' + file + ' — not valid JSON (' + parsed.parseError + ').' };
  }
  if (parsed.missing) {
    return { ok: true, changed: false, message: 'No settings.json found; nothing to remove.' };
  }
  const settings = parsed.value;
  const existing = settings.statusLine;
  const existingCmd = existing && typeof existing === 'object' ? existing.command : undefined;
  const dataDir = resolveDataDir(opts.dataDir);
  if (!existingCmd || !isOurCommand(existingCmd, dataDir)) {
    return { ok: true, changed: false, message: 'No context-health statusLine found; settings left untouched.' };
  }
  try { fs.copyFileSync(file, file + '.context-health.bak'); } catch (_e) {}
  delete settings.statusLine;
  writeSettingsAtomic(file, settings);
  return { ok: true, changed: true, message: 'Removed the context-health statusLine from ' + file + '. Restart to apply.' };
}

// Is the user's settings.json statusLine currently pointed at our renderer?
function isStatuslineWired(dataDir) {
  const resolved = resolveDataDir(dataDir);
  const parsed = readSettingsStrict(userSettingsPath());
  if (!parsed.ok || parsed.missing) return false;
  const existing = parsed.value.statusLine;
  const cmd = existing && typeof existing === 'object' ? existing.command : undefined;
  return isOurCommand(cmd, resolved);
}

/**
 * First-run discoverability: a plugin cannot auto-register a global statusline, so
 * a fresh install shows nothing until the user runs /context-health:setup-statusline.
 * This returns a one-time nudge string (and records that it fired, in the DATA dir)
 * when the statusline is not yet wired — so the plugin never looks silently broken.
 * It NEVER edits the user's settings; it only informs. Returns null when already
 * wired, already nudged, or no DATA dir is available.
 */
function firstRunNudge(opts) {
  opts = opts || {};
  const dataDir = resolveDataDir(opts.dataDir);
  if (!dataDir) return null;
  if (isStatuslineWired(dataDir)) return null;

  // Nudge once per plugin version while still unwired. The DATA dir and this flag
  // persist across uninstall/reinstall, so a bare "already nudged" marker would
  // suppress the reminder forever after the very first install — meaning a
  // reinstall or upgrade (the exact moment a user is most likely to have wiped
  // their settings or expect a fresh setup) would silently show nothing. Keying
  // the flag to the version re-nudges exactly once per release for anyone who
  // still hasn't wired the statusline; wired users short-circuit above.
  const version = readVersion(resolveRoot(opts.root)) || '0.0.0';
  const flag = path.join(dataDir, '.setup-nudged');
  try {
    if (fs.existsSync(flag) && fs.readFileSync(flag, 'utf8').trim() === version) return null;
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(flag, version, 'utf8');
  } catch (_e) {
    // If we cannot record that we nudged, stay silent rather than risk nagging
    // on every single session start.
    return null;
  }

  return 'context-health is installed, but its statusline is not wired yet — so the ' +
    'health signal will not show. Run /context-health:setup-statusline once to enable it ' +
    '(it edits only your ~/.claude/settings.json, backs it up first, and never overwrites ' +
    'an existing custom statusline).';
}

module.exports = {
  materialize,
  wireStatusline,
  unwireStatusline,
  isStatuslineWired,
  firstRunNudge,
  launcherPath,
  ourCommand,
  currentDir,
  userSettingsPath,
  isOurCommand,
  resolveRoot,
  resolveDataDir,
};
