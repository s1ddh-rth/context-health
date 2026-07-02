#!/usr/bin/env node
'use strict';

/**
 * Eval harness CLI. Runs the labeled corpus through the production detectors and
 * prints a per-detector report: confusion matrix, precision / recall / F0.5 /
 * false-positive-rate, and exact-level accuracy. Precision and FPR are the
 * headline numbers — this product optimizes precision over recall.
 *
 *   node eval/run-eval.js [corpus-glob-or-file ...]   # print the report
 *   node eval/run-eval.js --check                     # exit 1 on any mismatch
 *
 * Zero cost, deterministic — no model, no API. (Goal-drift end-to-end quality is
 * measured separately by worker/eval_drift.py, which uses the local model.)
 */

const fs = require('node:fs');
const path = require('node:path');
const { runCorpus, mismatches } = require('./lib/runner.js');
const { loadConfig } = require('../bin/lib/config.js');

function loadCorpus(paths) {
  const files = paths.length
    ? paths
    : [path.join(__dirname, 'corpus', 'structural.json')];
  const corpus = [];
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (Array.isArray(data)) corpus.push(...data);
  }
  return corpus;
}

function pct(x) {
  return (x * 100).toFixed(1) + '%';
}

function printReport(result) {
  const { metrics } = result;
  console.log('\nContext Health — detector eval\n' + '='.repeat(34));
  for (const det of Object.keys(metrics)) {
    const m = metrics[det];
    console.log(`\n${det}  (n=${m.n})`);
    console.log(`  precision ${pct(m.precision)}   recall ${pct(m.recall)}   F0.5 ${m.fBetaHalf.toFixed(3)}`);
    console.log(`  false-positive rate ${pct(m.falsePositiveRate)}   exact-level accuracy ${pct(m.exact)}`);
    const cm = m.confusion;
    console.log('  confusion (rows=actual, cols=predicted):');
    console.log('           green yellow  red');
    for (const row of ['green', 'yellow', 'red']) {
      const r = cm[row];
      console.log(
        `    ${row.padEnd(7)} ${String(r.green).padStart(4)} ${String(r.yellow).padStart(6)} ${String(r.red).padStart(4)}`
      );
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const paths = args.filter((a) => !a.startsWith('--'));

  const corpus = loadCorpus(paths);
  const config = loadConfig();
  const result = runCorpus(corpus, config);

  printReport(result);

  const wrong = mismatches(result.pairs);
  if (wrong.length) {
    console.log(`\n${wrong.length} mismatch(es):`);
    for (const w of wrong) {
      console.log(`  [${w.detector}] ${w.name}: predicted ${w.predicted}, expected ${w.expected}`);
    }
  } else {
    console.log('\nAll fixtures classified correctly.');
  }

  if (check && wrong.length) {
    process.exitCode = 1;
  }
}

main();
