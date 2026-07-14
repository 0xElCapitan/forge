/**
 * lab/harness/baselines.js
 *
 * Cycle-004 S02 (FR-8; SDD Lane L3; Sprint Plan §7.2 T2.4). The five-tier
 * baseline hierarchy (Δ5 applied). All estimators see the SAME sliced training
 * data (`< training_cutoff_ms`) the method sees. Every quantitative primitive is
 * imported from `src/` — zero reimplementation, spec drift impossible:
 *
 *   1. PRIMARY scientific — naive expanding-window HF-1 quantile: `hf1Quantile`
 *      from `src/derive/quantile.js` (same primitive, two callers), NO windowing.
 *   2. Derived method under test — comes back ONLY through `analyze()` (never here).
 *   3. Persistence — `persistenceForecast` consumed verbatim from the landed
 *      `src/baseline/persistence.js`.
 *   4. Legacy/reference transplanted authored constant — the frozen mapping RULE
 *      (most-shared 5-dim profile among burned-domain `threshold_gate` rules with
 *      numeric thresholds; tie → lexical rule id). The mapping rule binds here;
 *      the EVALUATED table freezes in S03's pre-registration.
 *   5. Reject-all coverage point (no curves; AURC out of scope).
 *
 * The optional S07 structural comparators (`base-rate`, `domain-priors`,
 * `rolling-baseline`, `transition-frequency`) are NOT included — they are
 * exploratory only, never in the primary comparison (n = 1; FR-10).
 *
 * @module lab/harness/baselines
 */

import { hf1Quantile, parseDecimalRational } from '../../src/derive/quantile.js';
import { persistenceForecast } from '../../src/baseline/persistence.js';
import { canonicalize } from '../../src/receipt/canonicalize.js';

/** The 5 FeedProfile dimensions (src/classifier/feed-grammar.js classify()). */
export const PROFILE_DIMENSIONS = Object.freeze(['cadence', 'distribution', 'noise', 'density', 'thresholds']);

/**
 * The burned-domain `threshold_gate` rules with NUMERIC thresholds — the only
 * candidates the transplanted-constant mapping may resolve to (SDD Lane L3;
 * src/selector/rules.js). The flare gate's `'M1.0'` STRING threshold is
 * non-numeric and excluded. These numeric values are landed + frozen; each
 * rule's evaluated 5-dim FeedProfile freezes in the S03 pre-registration table
 * (NOT built this cycle).
 */
export const LEGACY_NUMERIC_THRESHOLD_CANDIDATES = Object.freeze({
  seismic_threshold_gate: 5.0,
  space_weather_kp_gate: 5,
  aqi_threshold_gate: 151,
});

// ─── Tier 1: primary scientific — naive expanding-window HF-1 quantile ────────

/**
 * Naive expanding-window HF-1 quantile over ALL qualifying training
 * observations (`< training_cutoff_ms`), no windowing. Sorts values ascending
 * with the pinned three-way comparator, then calls the PRODUCT primitive
 * `hf1Quantile`. Returns `null` for an empty training set.
 *
 * @param {Array<{value:number}>} trainingQualifying
 * @param {string} pStr - DR-6 decimal string
 * @returns {number|null}
 */
export function naiveQuantileBaseline(trainingQualifying, pStr) {
  if (!trainingQualifying || trainingQualifying.length === 0) return null;
  const p = parseDecimalRational(pStr);
  const sorted = trainingQualifying.map(e => e.value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return hf1Quantile(sorted, p);
}

// ─── Tier 3: persistence (landed src/baseline/persistence.js, verbatim) ───────

/**
 * Persistence baseline value — the most recently observed training value, via
 * the landed `persistenceForecast`. Same training cutoff as every estimator.
 * Returns `null` for an empty training set.
 *
 * @param {Array<{timestamp:number, value:number}>} trainingQualifying - NormalizedEvent[]
 * @returns {number|null}
 */
export function persistenceBaselineValue(trainingQualifying) {
  return persistenceForecast(trainingQualifying).predicted_value;
}

// ─── Tier 4: legacy/reference transplanted authored constant (the mapping RULE) ─

/**
 * Count of the 5 FeedProfile dimensions on which two profiles agree (canonical
 * equality — handles nested dimension objects deterministically).
 *
 * @param {Object} a
 * @param {Object} b
 * @returns {number} 0..5
 */
export function sharedProfileDims(a, b) {
  let shared = 0;
  for (const dim of PROFILE_DIMENSIONS) {
    if (canonicalize(a?.[dim] ?? null) === canonicalize(b?.[dim] ?? null)) shared += 1;
  }
  return shared;
}

/**
 * The frozen transplanted-constant mapping RULE: among the candidate
 * burned-domain `threshold_gate` rules (each `{ rule_id, profile, threshold }`),
 * pick the one whose fixture default-mode FeedProfile shares the MOST of the 5
 * dimensions with the target feed's profile; TIE → lexical `rule_id` (ascending).
 * Returns `{ rule_id, threshold, shared_dims }`, or `null` when the candidate
 * table is empty (the evaluated table freezes in S03 — absent this cycle).
 *
 * @param {Object} targetProfile - the target feed's 5-dim profile
 * @param {Array<{rule_id:string, profile:Object, threshold:number}>} candidateTable
 * @returns {{rule_id:string, threshold:number, shared_dims:number}|null}
 */
export function transplantedConstant(targetProfile, candidateTable) {
  if (!Array.isArray(candidateTable) || candidateTable.length === 0) return null;
  let best = null;
  for (const cand of candidateTable) {
    if (typeof cand.threshold !== 'number' || !Number.isFinite(cand.threshold)) {
      throw new Error(`transplantedConstant: candidate ${cand.rule_id} has a non-numeric threshold (excluded by the mapping rule)`);
    }
    const shared = sharedProfileDims(targetProfile, cand.profile);
    if (
      best === null
      || shared > best.shared_dims
      || (shared === best.shared_dims && cand.rule_id < best.rule_id)   // lexical tie-break
    ) {
      best = { rule_id: cand.rule_id, threshold: cand.threshold, shared_dims: shared };
    }
  }
  return best;
}

// ─── Tier 5: reject-all coverage point (no curves) ────────────────────────────

/**
 * The reject-all coverage anchor: the (risk, coverage) POINT in the scorecard
 * shape — no numeric estimate, no curves (AURC out of scope).
 */
export function rejectAllPoint() {
  return { kind: 'reject-all', coverage: 0, estimate: null };
}
