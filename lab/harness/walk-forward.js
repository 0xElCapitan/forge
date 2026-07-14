/**
 * lab/harness/walk-forward.js
 *
 * Cycle-004 S02 (FR-6; SDD Lane L3 + DR-2; Sprint Plan §7.2 T2.2). The
 * deterministic walk-forward engine. The leakage model is pinned EXACTLY:
 *
 *   H = 30 days = 2_592_000_000 ms; P = H (purge gap, carried as its own value)
 *   origin_ms          = t_k                         (a UTC calendar-month start)
 *   training_cutoff_ms = t_k − P
 *   training data      = qualifying obs strictly < training_cutoff_ms   (the slice)
 *   purge interval     = [training_cutoff_ms, t_k)   (never trained, never evaluated)
 *   evaluation window  = (t_k, t_k + H]              (start EXCLUSIVE, end INCLUSIVE)
 *   the point t_k      = in NEITHER set
 *
 * Origin schedule (pre-registered): candidate origins = UTC calendar-month
 * boundaries; eligible iff `(m − P ≥ t_min + min_days·DAY_MS)` AND
 * `(m + H ≤ tail_start_ms)`; kept iff first-kept or gap-to-last-kept ≥ H (the
 * Feb-adjacency overlap control — SEPARATE from the purge). Locked tail
 * `tail_start_ms = t_max − floor((t_max − t_min)/5)`; normal mode structurally
 * cannot touch it; `--final` (C-005-only) refuses without a valid freeze-manifest
 * reference (only its refusal path is exercised this cycle).
 *
 * The engine is origin-unaware in the kernel sense: containment lives entirely
 * in the materialized slice file handed to the production `analyze()`. `now` and
 * `timestampBase` are fixed run constants (future-independent — never derived
 * from the poisoned tail), so the AC-10 purge/future-poison twins are
 * byte-identical by construction.
 *
 * @module lab/harness/walk-forward
 */

import { ForgeConstruct } from '../../src/index.js';
import { qualifyingObservations } from '../../src/derive/effective-information.js';

import {
  readRawFixture, ingestFixture, assertHarnessFixture, materializeSliceFromLoaded,
} from './slice-fixtures.js';
import {
  naiveQuantileBaseline, persistenceBaselineValue, transplantedConstant, rejectAllPoint,
} from './baselines.js';
import { scorePerOrigin, pFloat } from './scoring.js';

// ─── Pinned leakage-model constants (SDD DR-2 / Lane L3) ──────────────────────

export const DAY_MS = 86_400_000;
export const H_DAYS = 30;
export const H_MS = 2_592_000_000;          // 30 · DAY_MS
export const PURGE_GAP_MS = 2_592_000_000;  // P = H (frozen equal this cycle; carried explicitly)
export const TAIL_DIVISOR = 5;              // span/5 locked tail (~20%)

/**
 * Locked-tail boundary: `t_max − floor((t_max − t_min)/5)`. Exact integer
 * arithmetic only.
 */
export function computeTailStart(tMin, tMax) {
  return tMax - Math.floor((tMax - tMin) / TAIL_DIVISOR);
}

/**
 * All UTC calendar-month boundaries `m` (day 1, 00:00:00.000Z) from the month
 * containing `tMin` through `≤ tMax`. `Date.UTC` integer calendar arithmetic —
 * deterministic, no wall clock, no transcendentals.
 */
export function monthStartsInRange(tMin, tMax) {
  if (!Number.isInteger(tMin) || !Number.isInteger(tMax) || tMin > tMax) {
    throw new Error(`monthStartsInRange: invalid range [${tMin}, ${tMax}]`);
  }
  const d = new Date(tMin);
  let y = d.getUTCFullYear();
  let mo = d.getUTCMonth();
  const out = [];
  let m = Date.UTC(y, mo, 1);
  while (m <= tMax) {
    out.push(m);
    mo += 1;
    if (mo === 12) { mo = 0; y += 1; }
    m = Date.UTC(y, mo, 1);
  }
  return out;
}

/** Per-origin boundary tuple (the five pinned manifest fields). */
export function originBoundaries(originMs) {
  return {
    origin_ms: originMs,
    training_cutoff_ms: originMs - PURGE_GAP_MS,
    purge_gap_ms: PURGE_GAP_MS,
    evaluation_start_ms: originMs,          // EXCLUSIVE bound of (t_k, t_k + H]
    evaluation_end_ms: originMs + H_MS,     // INCLUSIVE bound
  };
}

/**
 * Compute the frozen origin schedule from the full-series bounds.
 *
 * @param {{tMin:number, tMax:number, minDays:number}} p
 * @returns {{ tMin:number, tMax:number, tailStartMs:number, candidates:number[],
 *   eligible:number[], kept:Array<ReturnType<typeof originBoundaries>> }}
 */
export function computeSchedule({ tMin, tMax, minDays }) {
  if (!Number.isInteger(minDays) || minDays < 1) {
    throw new Error(`computeSchedule: minDays must be a positive integer, got ${minDays}`);
  }
  const tailStartMs = computeTailStart(tMin, tMax);
  const candidates = monthStartsInRange(tMin, tMax);

  const historyFloor = tMin + minDays * DAY_MS;
  const eligible = candidates.filter(m =>
    (m - PURGE_GAP_MS >= historyFloor) && (m + H_MS <= tailStartMs));

  const kept = [];
  let lastKept = null;
  for (const m of eligible) {
    if (lastKept === null || (m - lastKept) >= H_MS) {   // overlap control (NOT the purge)
      kept.push(originBoundaries(m));
      lastKept = m;
    }
  }
  return { tMin, tMax, tailStartMs, candidates, eligible, kept };
}

/**
 * Full-series bounds from the production qualifying filter (F-3 canonical order).
 *
 * @param {Array<Object>} events - NormalizedEvent[]
 * @returns {{ tMin:number, tMax:number, n:number, qualifying:Array<Object> }}
 */
export function seriesBounds(events) {
  const qualifying = qualifyingObservations(events);
  if (qualifying.length === 0) throw new Error('seriesBounds: no qualifying observations in the full series');
  return {
    tMin: qualifying[0].timestamp,
    tMax: qualifying[qualifying.length - 1].timestamp,
    n: qualifying.length,
    qualifying,
  };
}

/**
 * Evaluation outcomes for an origin: qualifying obs in `(t_k, t_k + H]` from the
 * FULL series (start exclusive, end inclusive). Values only, canonical order.
 */
export function outcomesForOrigin(qualifyingFull, originMs) {
  const end = originMs + H_MS;
  const out = [];
  for (const e of qualifyingFull) {
    if (e.timestamp > originMs && e.timestamp <= end) out.push(e.value);
  }
  return out;
}

/** Qualifying training obs strictly `< training_cutoff_ms` (the sliced data). */
export function trainingQualifying(qualifyingFull, trainingCutoffMs) {
  return qualifyingFull.filter(e => e.timestamp < trainingCutoffMs);
}

/**
 * `--final` refusal control (C-005-only). Normal mode returns immediately.
 * `--final` refuses (DR-5 specification error) without a valid freeze-manifest
 * reference — this cycle exercises ONLY the refusal path on synthetics.
 *
 * @param {{final?:boolean, freezeManifestRef?:Object|null}} p
 */
export function assertFinalAllowed({ final = false, freezeManifestRef = null } = {}) {
  if (!final) return; // normal mode structurally cannot touch the locked tail
  const ref = freezeManifestRef;
  const valid = ref && typeof ref === 'object'
    && typeof ref.manifest_path === 'string' && ref.manifest_path.length > 0
    && typeof ref.manifest_sha256 === 'string' && ref.manifest_sha256.length > 0;
  if (!valid) {
    throw new Error(
      'walk-forward --final refuses without a valid freeze-manifest reference '
      + '(C-005-only; DR-2/DR-8). This cycle exercises only the refusal path.',
    );
  }
  // A valid freeze-manifest reference would extend origins into the tail in
  // C-005 (out of scope here — no freeze manifest exists this cycle).
}

/**
 * Extract the method estimate / structured rejection from an `analyze()` result
 * running in experimental mode (DR-3 result surface).
 *
 * @param {Object} result - ForgeResult with `experimental_derivation`
 * @returns {{state:string, value:number|null, lo:number|null, hi:number|null, reason_code:string|null}}
 */
export function methodFromResult(result) {
  const ed = result.experimental_derivation;
  if (!ed) {
    throw new Error('methodFromResult: analyze() returned no experimental_derivation — experimental mode was not ON');
  }
  if (ed.state === 'RANKED_CANDIDATES') {
    const r = ed.record;
    return { state: 'RANKED_CANDIDATES', value: r.value, lo: r.uncertainty.lo, hi: r.uncertainty.hi, reason_code: null };
  }
  if (ed.state === 'NO_INSTRUMENT') {
    return { state: 'NO_INSTRUMENT', value: null, lo: null, hi: null, reason_code: ed.rejection.reason_code };
  }
  // AUTHORED_PROPOSALS_PRESENT means the fixture matched a burned-domain authored
  // rule — a harness fixture must be non-burned so derivation is the tested path.
  throw new Error(
    `methodFromResult: harness fixture produced authored proposals (state=${ed.state}); harness fixtures must be non-burned so the experimental derivation path is exercised`,
  );
}

/**
 * The walk-forward engine. For each kept origin: materialize the slice →
 * production `analyze()` (experimental ON) → method estimate or per-origin
 * NO_INSTRUMENT (counted, never silently skipped) → baselines over the SAME
 * sliced training data → outcomes from `(t_k, t_k + H]` → deterministic scores.
 *
 * @param {Object} p
 * @param {ForgeConstruct} [p.construct] - reused across origins (defaults to a fresh one)
 * @param {string} p.fixturePath
 * @param {string} p.runId
 * @param {Object} p.config - { feed_id, p, window:{min_days, n_min}, timestampBase, now, constant_candidate_table? }
 * @param {string} [p.outRoot="lab/out"]
 * @param {boolean} [p.final=false]
 * @param {Object|null} [p.freezeManifestRef=null]
 * @returns {Promise<{schedule:Object, series:Object, origins:Array<Object>, config:Object}>}
 */
export async function evaluateOrigins({
  construct = new ForgeConstruct(),
  fixturePath, runId, config, outRoot = 'lab/out', final = false, freezeManifestRef = null,
}) {
  assertFinalAllowed({ final, freezeManifestRef });
  assertRunConfig(config);

  const { feed_id, p: pStr, window, timestampBase, now } = config;
  const pf = pFloat(pStr);

  const rawArray = readRawFixture(fixturePath);
  const events = ingestFixture(fixturePath, timestampBase);
  assertHarnessFixture(rawArray, events);

  const series = seriesBounds(events);
  const schedule = computeSchedule({ tMin: series.tMin, tMax: series.tMax, minDays: window.min_days });

  const origins = [];
  const captures = [];   // per-origin corpus-building inputs (NOT part of the pinned manifest)
  for (const b of schedule.kept) {
    const { slicePath } = materializeSliceFromLoaded({
      rawArray, events, originMs: b.origin_ms, trainingCutoffMs: b.training_cutoff_ms, runId, outRoot,
    });

    // Production-authentic derivation over the materialized slice.
    const result = await construct.analyze(slicePath, {
      feed_id,
      timestampBase,
      now,
      experimental: { derivation: { p: pStr, window: { min_days: window.min_days, n_min: window.n_min } } },
    });
    const method = methodFromResult(result);

    // Baselines over the SAME sliced training data (they see nothing ≥ cutoff either).
    const trainQ = trainingQualifying(series.qualifying, b.training_cutoff_ms);
    const naive = naiveQuantileBaseline(trainQ, pStr);
    const persistence = persistenceBaselineValue(trainQ);
    const constant = transplantedConstant(result.feed_profile, config.constant_candidate_table ?? []);
    const rejectAll = rejectAllPoint();

    const outcomes = outcomesForOrigin(series.qualifying, b.origin_ms);
    const scores = scorePerOrigin({
      outcomes,
      estimates: {
        method: method.value,
        naive,
        persistence,
        constant: constant ? constant.threshold : null,
      },
      pf,
    });

    origins.push({
      ...b,
      outcome_count: outcomes.length,
      method: { state: method.state, value: method.value, lo: method.lo, hi: method.hi, reason_code: method.reason_code },
      baselines: {
        naive,
        persistence,
        constant: constant ? { rule_id: constant.rule_id, threshold: constant.threshold, shared_dims: constant.shared_dims } : null,
        reject_all: rejectAll,
      },
      scores,
    });

    const ed = result.experimental_derivation;
    captures.push({
      origin_ms: b.origin_ms,
      feed_profile: result.feed_profile,
      classifier_version: result.envelope.classifier_version,
      effective_information: method.state === 'RANKED_CANDIDATES'
        ? ed.record.derivation.effective_information : null,
      record: method.state === 'RANKED_CANDIDATES' ? ed.record : null,
      rejection: method.state === 'NO_INSTRUMENT' ? ed.rejection : null,
      method_state: method.state,
      baseline_estimates: {
        naive,
        persistence,
        constant: constant ? { rule_id: constant.rule_id, threshold: constant.threshold } : null,
      },
    });
  }

  return {
    schedule,
    series: { tMin: series.tMin, tMax: series.tMax, n: series.n, tail_start_ms: schedule.tailStartMs },
    origins,
    captures,
    config,
    data_content: rawArray,
  };
}

/** Validate the run config (fail-closed; the co-requirement mirrors DR-3). */
export function assertRunConfig(config) {
  if (config === null || typeof config !== 'object') throw new TypeError('run config must be an object');
  const { feed_id, p, window, timestampBase, now } = config;
  if (typeof feed_id !== 'string' || feed_id.length === 0) throw new Error('run config: feed_id must be a non-empty POSIX string');
  if (typeof p !== 'string') throw new Error('run config: p must be a decimal string (DR-6)');
  if (window === null || typeof window !== 'object') throw new Error('run config: window object required');
  if (!Number.isInteger(window.min_days) || window.min_days < 1) throw new Error('run config: window.min_days must be an integer ≥ 1');
  if (!Number.isInteger(window.n_min) || window.n_min < 2) throw new Error('run config: window.n_min must be an integer ≥ 2');
  if (!Number.isInteger(timestampBase)) throw new Error('run config: timestampBase must be an integer (fixed, future-independent)');
  if (!Number.isInteger(now)) throw new Error('run config: now must be an integer (fixed, future-independent — never derived from the tail)');
}
