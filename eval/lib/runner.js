'use strict';

/**
 * Eval runner. Feeds each labeled fixture through the production evaluate() path
 * and scores predictions against the labels, per detector.
 *
 * A fixture:
 *   {
 *     name, detector?,               // detector is informational
 *     build: <session spec>,         // see build-session.js (or spec inline)
 *     liveMetrics: { fillPercent },
 *     expected: { distraction, confusion, goalDrift, overall }  // any subset
 *   }
 */

const { buildSession } = require('./build-session.js');
const { evaluate } = require('../../bin/lib/session-signals.js');
const { binaryMetrics, exactAccuracy, confusionMatrix } = require('./metrics.js');

// goalDrift is intentionally NOT a standalone metric here: in the structural
// corpus the drift severity is *injected* into the fixture (the worker/model
// isn't run), so predicted would equal expected by construction and measure
// nothing. Real goal-drift quality is measured against labeled text pairs by
// worker/eval_drift.py. Injected drift still flows into the genuine `overall`
// roll-up below (which tests that evaluate()/addComputed surface it correctly).
const DETECTORS = ['distraction', 'confusion', 'overall'];

function predictOne(fixture, config) {
  const spec = fixture.build || fixture;
  const session = buildSession(spec);
  const res = evaluate(session, fixture.liveMetrics || {}, config);
  return {
    distraction: res.distraction.severity,
    confusion: res.confusion.severity,
    goalDrift: (session.computed && session.computed.goalDrift && session.computed.goalDrift.severity) || 'green',
    overall: res.severity,
  };
}

function runCorpus(corpus, config) {
  const pairs = {};
  for (const d of DETECTORS) pairs[d] = [];
  const details = [];

  for (const fixture of corpus || []) {
    const predicted = predictOne(fixture, config);
    const expected = fixture.expected || {};
    for (const d of DETECTORS) {
      if (expected[d] != null) {
        pairs[d].push({ predicted: predicted[d], expected: expected[d], name: fixture.name });
      }
    }
    details.push({ name: fixture.name, predicted, expected });
  }

  const metrics = {};
  for (const d of DETECTORS) {
    if (pairs[d].length) {
      metrics[d] = Object.assign({}, binaryMetrics(pairs[d]), {
        exact: exactAccuracy(pairs[d]),
        confusion: confusionMatrix(pairs[d]),
        n: pairs[d].length,
      });
    }
  }

  return { metrics, details, pairs };
}

// Which fixtures did the detector get wrong (for a report / --check)?
function mismatches(pairs) {
  const out = [];
  for (const detector of Object.keys(pairs || {})) {
    for (const p of pairs[detector]) {
      if (p.predicted !== p.expected) {
        out.push({ detector, name: p.name, predicted: p.predicted, expected: p.expected });
      }
    }
  }
  return out;
}

module.exports = { runCorpus, predictOne, mismatches, DETECTORS };
