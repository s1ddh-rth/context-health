'use strict';

/**
 * stdin helpers for hook and statusline entry scripts. Both read a single JSON
 * object from stdin. Everything here is defensive: a hook must never crash the
 * host, so a bad/empty stdin resolves to an empty object rather than throwing.
 */

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(data);
    };
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', done);
      process.stdin.on('error', done);
      // If nothing is piped, don't hang forever.
      process.stdin.on('close', done);
    } catch (_e) {
      done();
    }
  });
}

// Parse JSON tolerantly: skip any leading junk (e.g. a stray shell-rc echo) that
// might precede the real object.
function parseJsonLoose(str) {
  if (typeof str !== 'string') return {};
  const start = str.indexOf('{');
  if (start === -1) return {};
  try {
    const parsed = JSON.parse(str.slice(start));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_e) {
    return {};
  }
}

async function readStdinJson() {
  const raw = await readStdin();
  return parseJsonLoose(raw);
}

module.exports = { readStdin, parseJsonLoose, readStdinJson };
