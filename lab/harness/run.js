/**
 * lab/harness/run.js
 *
 * Cycle-004 S02 (SDD Lane L3/L4; Sprint Plan §7.2 T2.7). The run CLI + passive
 * corpus-record shapes. Wiring:
 *
 *   config → schedule → slice → analyze → baselines → scoring → manifest
 *          → ledger/corpus emission
 *
 * Passive corpus records v0 (shapes only — NO corpus formalization) are written
 * as JSONL, one object per line, UNDER the run work directory
 * `lab/out/<run_id>/corpus/` — which the existing bare `out/` .gitignore rule
 * already ignores. NOTHING is ever written to the tracked `lab/corpus/` (only
 * `README.md` lives there). `OutcomeRecord` is reserved-empty (documented in the
 * corpus README only). The run manifest + BI-5 self-test also write only under
 * the work dir / temp, so the tracked tree stays clean before every commit.
 *
 * This module is ZERO-NETWORK by construction — no http/https/net/fetch/
 * child_process import. It reads local fixtures and writes local artifacts only.
 *
 * @module lab/harness/run
 */

import { appendFileSync, mkdirSync } from 'node:fs';

import { canonicalize } from '../../src/receipt/canonicalize.js';
import { evaluateOrigins } from './walk-forward.js';
import { aggregate } from './scoring.js';
import {
  buildRunManifest, withRunId, writeRunManifest, contentAddress, environmentBlock,
} from './manifests.js';

// ─── Passive corpus-record shapes v0 (Lane L4; minimum fields) ────────────────

/** FeedSnapshotRef — single-vintage snapshot reference. */
export function buildFeedSnapshotRef({ feed_id, start_ms, end_ms, data_sha256, ingested_at_ms }) {
  return { record_kind: 'FeedSnapshotRef', feed_id, window: { start_ms, end_ms }, data_sha256, vintage_note: 'single-vintage', ingested_at_ms };
}

/** GrammarStateRecord — the classifier grammar state for a slice. */
export function buildGrammarStateRecord({ feed_id, feed_profile, effective_information, grammar_version, classifier_version }) {
  return { record_kind: 'GrammarStateRecord', feed_id, feed_profile, effective_information, grammar_version, classifier_version };
}

/** CandidateRecord — one (family, method, params) considered (incl. shadows + transplanted constant). */
export function buildCandidateRecord({ template, params_ref, origin }) {
  const rec = { record_kind: 'CandidateRecord', template, params_ref, origin };
  rec.record_sha256 = contentAddress({ template, params_ref, origin });
  return rec;
}

/** DecisionRecord — selected | rejected at an origin. */
export function buildDecisionRecord({ decision, reason_code = null, evidence_ref, reconsideration = null, trials_ledger_ref }) {
  return { record_kind: 'DecisionRecord', decision, reason_code, evidence_ref, reconsideration, trials_ledger_ref };
}

/** ReplayRecord — pins the run manifest digest + a per-origin scores digest. */
export function buildReplayRecord({ run_manifest_sha256, per_origin_scores_ref }) {
  return { record_kind: 'ReplayRecord', run_manifest_sha256, per_origin_scores_ref };
}

/** Append one canonical JSONL corpus line (whole-line, explicit LF). */
function appendCorpusLine(filePath, obj) {
  appendFileSync(filePath, canonicalize(obj) + '\n');
}

/**
 * Build all passive corpus records for a run from the engine result. Returns a
 * flat array of records (written per-type under the work dir by the caller).
 */
export function buildCorpusRecords({ manifest, evalResult }) {
  const { config, series, captures, origins } = evalResult;
  const records = [];

  records.push(buildFeedSnapshotRef({
    feed_id: config.feed_id,
    start_ms: series.tMin,
    end_ms: series.tMax,
    data_sha256: manifest.data.data_sha256,
    ingested_at_ms: config.now,
  }));

  for (const cap of captures) {
    records.push(buildGrammarStateRecord({
      feed_id: config.feed_id,
      feed_profile: cap.feed_profile,
      effective_information: cap.effective_information,
      grammar_version: cap.classifier_version,
      classifier_version: cap.classifier_version,
    }));

    // Derived method candidate (or its rejection), then the baseline candidates
    // (incl. the transplanted constant) — shadows + authored constant per L4.
    if (cap.method_state === 'RANKED_CANDIDATES') {
      records.push(buildCandidateRecord({ template: 'threshold_gate', params_ref: contentAddress(cap.record), origin: 'derived' }));
      records.push(buildDecisionRecord({
        decision: 'selected', evidence_ref: contentAddress(cap.record),
        trials_ledger_ref: 'lab/ledgers/trials-ledger.jsonl',
      }));
    } else {
      records.push(buildDecisionRecord({
        decision: 'rejected', reason_code: cap.rejection ? cap.rejection.reason_code : null,
        evidence_ref: cap.rejection ? contentAddress(cap.rejection) : null,
        reconsideration: cap.rejection ? (cap.rejection.reconsideration ?? null) : null,
        trials_ledger_ref: 'lab/ledgers/trials-ledger.jsonl',
      }));
    }
    if (cap.baseline_estimates.naive !== null) {
      records.push(buildCandidateRecord({ template: 'threshold_gate', params_ref: contentAddress({ naive: cap.baseline_estimates.naive }), origin: 'baseline' }));
    }
    if (cap.baseline_estimates.constant !== null) {
      records.push(buildCandidateRecord({ template: 'threshold_gate', params_ref: contentAddress(cap.baseline_estimates.constant), origin: 'authored' }));
    }
  }

  records.push(buildReplayRecord({
    run_manifest_sha256: manifest.run_id,
    per_origin_scores_ref: contentAddress(origins.map(o => o.scores)),
  }));

  return records;
}

/**
 * Execute a full harness run: engine → aggregate → run manifest (content-addressed)
 * → passive corpus JSONL under `lab/out/<run_id>/corpus/`. Returns the finalized
 * manifest and the corpus records. Writes ONLY under the work dir (never a
 * tracked path).
 *
 * @param {Object} p
 * @param {string} p.fixturePath
 * @param {Object} p.config
 * @param {string} p.runId - work-directory label (organizes ephemeral output)
 * @param {string} [p.outRoot="lab/out"]
 * @param {Object} [p.construct]
 * @returns {Promise<{ manifest:Object, corpus:Array<Object>, evalResult:Object }>}
 */
export async function runHarness({ fixturePath, config, runId, outRoot = 'lab/out', construct }) {
  const evalResult = await evaluateOrigins({ construct, fixturePath, runId, config, outRoot });
  const { rejection_metrics } = aggregate(evalResult.origins, { primaryBaseline: 'naive' });

  const data = {
    fixture: config.feed_id,
    data_sha256: contentAddress(evalResult.data_content),
    span: { start_ms: evalResult.series.tMin, end_ms: evalResult.series.tMax },
    n: evalResult.series.n,
  };

  const manifest = withRunId(buildRunManifest({
    freeze: config.freeze ?? null,
    data,
    config: manifestConfig(config, evalResult),
    origins: evalResult.origins,
    rejection_metrics,
    environment: environmentBlock(),
  }));

  const workDir = `${outRoot}/${runId}`;
  writeRunManifest(`${workDir}/run-manifest.json`, manifest);

  const corpus = buildCorpusRecords({ manifest, evalResult });
  writeCorpus(`${workDir}/corpus`, corpus);

  return { manifest, corpus, evalResult };
}

/** The scientific config block recorded in the run manifest (Lane L4). */
export function manifestConfig(config, evalResult) {
  return {
    p: config.p,
    alpha: '0.05',
    window: { min_days: config.window.min_days, n_min: config.window.n_min },
    H_days: 30,
    purge_gap_ms: 2592000000,
    tail_rule: 'span/5',
    tail_start_ms: evalResult.series.tail_start_ms,
    timestampBase: config.timestampBase,
    now: config.now,
    feed_id: config.feed_id,
    origin_rule: 'utc-month-start; eligible iff (m − P ≥ t_min + min_days·DAY_MS) and (m + H ≤ tail_start); keep iff gap-to-last-kept ≥ H (overlap control, not purge)',
  };
}

/** Write the passive corpus records grouped by record_kind, one JSONL file each. */
export function writeCorpus(corpusDir, records) {
  mkdirSync(corpusDir, { recursive: true });
  const byKind = new Map();
  for (const r of records) {
    if (!byKind.has(r.record_kind)) byKind.set(r.record_kind, []);
    byKind.get(r.record_kind).push(r);
  }
  for (const [kind, recs] of byKind) {
    const file = `${corpusDir}/${kind}.jsonl`;
    for (const r of recs) appendCorpusLine(file, r);
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

/** Parse `--key value` / `--flag` CLI args into a plain object. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { out[key] = true; }
      else { out[key] = next; i += 1; }
    }
  }
  return out;
}

/**
 * CLI entry: `node lab/harness/run.js --fixture <path> --config <path> [--run-id <id>] [--out <dir>]`.
 * The config JSON supplies { feed_id, p, window, timestampBase, now, ... }.
 */
export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.fixture || !args.config) {
    process.stderr.write('usage: run.js --fixture <path> --config <config.json> [--run-id <id>] [--out <dir>]\n');
    return 2;
  }
  const { readFileSync } = await import('node:fs');
  const config = JSON.parse(readFileSync(args.config, 'utf8'));
  const runId = typeof args['run-id'] === 'string' ? args['run-id'] : contentAddress(config).replace('sha256:', '').slice(0, 16);
  const outRoot = typeof args.out === 'string' ? args.out : 'lab/out';
  const { manifest } = await runHarness({ fixturePath: args.fixture, config, runId, outRoot });
  process.stdout.write(`${manifest.run_id}\n`);
  return 0;
}

// Execute only when invoked directly (never on import).
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().then(code => { if (code) process.exitCode = code; }).catch(err => { process.stderr.write(`${err.stack || err}\n`); process.exitCode = 1; });
}
