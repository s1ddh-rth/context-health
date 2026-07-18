'use strict';

/**
 * Context-fill math for the statusline.
 *
 * The statusline JSON reports `context_window.used_percentage` against the FULL
 * window. But Claude Code reserves a fixed autocompact buffer (~33k tokens) at
 * the top of the window: once the used tokens reach `windowSize - buffer`,
 * autocompaction fires. So the number that actually matters to a user is how
 * full the *usable* window is, where usable = windowSize - buffer.
 *
 * fillPercent = usedTokens / (windowSize - buffer) * 100
 *   - reaches 100 exactly at the autocompact boundary
 *   - is always >= the raw used_percentage (the correction never flatters)
 *
 * Everything here is a pure function of its inputs. No I/O, no throwing on bad
 * input — callers (statusline) must render fallback text, never crash.
 */

const FALLBACK_BUFFER = 33000;
const FALLBACK_WINDOW = 200000;
// The reserve as a fraction of the window. 0.165 == 33000/200000, i.e. it exactly
// reproduces the calibrated 200K buffer while scaling the reserve up on larger
// windows (a flat 33K is only ~3% of a 1M window and badly overstates usable space).
const FALLBACK_RESERVE_FRACTION = FALLBACK_BUFFER / FALLBACK_WINDOW;

// Field names the statusline JSON might use for the total window size, in
// order of preference. Claude Code has shifted these across versions, so we
// probe a few and fall back to the configured default.
const WINDOW_SIZE_FIELDS = ['context_window_size', 'max_tokens', 'window_size', 'size', 'limit'];

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function extractWindowSize(input, opts = {}) {
  const fallback = isFiniteNumber(opts.defaultWindowSize) && opts.defaultWindowSize > 0
    ? opts.defaultWindowSize
    : FALLBACK_WINDOW;
  const cw = input && typeof input === 'object' ? input.context_window : null;
  if (cw && typeof cw === 'object') {
    for (const field of WINDOW_SIZE_FIELDS) {
      if (isFiniteNumber(cw[field]) && cw[field] > 0) return cw[field];
    }
  }
  return fallback;
}

function computeContextFill(input, opts = {}) {
  const minBuffer = isFiniteNumber(opts.autocompactBufferTokens) && opts.autocompactBufferTokens >= 0
    ? opts.autocompactBufferTokens
    : FALLBACK_BUFFER;
  const reserveFraction = isFiniteNumber(opts.autocompactReserveFraction)
    && opts.autocompactReserveFraction > 0 && opts.autocompactReserveFraction < 1
    ? opts.autocompactReserveFraction
    : FALLBACK_RESERVE_FRACTION;

  const cw = input && typeof input === 'object' ? input.context_window : null;
  const usedPercentage = cw ? cw.used_percentage : undefined;

  if (!isFiniteNumber(usedPercentage)) {
    return { ok: false, fillPercent: null, freeUntilCompactPercent: null, windowSize: null, usedTokens: null };
  }

  const windowSize = extractWindowSize(input, opts);
  // The autocompact reserve scales with the window. A flat token buffer is ~16.5%
  // of a 200K window but only ~3% of a 1M window, which overstated usable space on
  // large-context models (autocompact there fires far earlier than windowSize-33000
  // implies). Take the larger of the configured floor and the proportional reserve:
  // exact at the calibrated 200K size, conservative as the window grows. Large-window
  // reserves are approximate (see docs/METHODOLOGY.md) and tunable via config.
  const reserve = Math.max(minBuffer, Math.round(windowSize * reserveFraction));
  // If the reserve is >= the window (a degenerate/misreported case that has occurred
  // upstream), fall back to the full window rather than clamping usable to 1 — which
  // would blow fillPercent up to absurd values (e.g. 1,000,000%).
  const usableWindow = Math.max(1, windowSize > reserve ? windowSize - reserve : windowSize);
  const usedTokens = (usedPercentage / 100) * windowSize;

  const fillPercentRaw = (usedTokens / usableWindow) * 100;
  const fillPercent = Math.max(0, fillPercentRaw);
  // Room left before autocompaction, expressed against the usable window (the
  // complement of fillPercent). Note this is usable-window-relative, matching
  // fillPercent — not the total-window figure sketched in build-spec §9.
  const freeUntilCompactPercent = Math.max(0, 100 - fillPercent);

  return {
    ok: true,
    fillPercent,
    freeUntilCompactPercent,
    windowSize,
    usedTokens,
  };
}

module.exports = { computeContextFill, extractWindowSize, FALLBACK_BUFFER, FALLBACK_WINDOW, FALLBACK_RESERVE_FRACTION };
