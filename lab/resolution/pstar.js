/**
 * lab/resolution/pstar.js
 *
 * Cycle-005 S01 (PRD FR-D4; SDD DR-6; Sprint Plan T1.6).
 *
 * The p\*-resolution evidence resolver. The ARITHMETIC is frozen
 * ([preregistration.md:43]): p\* = the largest p ∈ {"0.90","0.95","0.99"} whose
 * existence bound clears with ≥ 3× margin (`existenceBound(n, p) ≤ α/3`) at the
 * census-measured n of the sealed primary. This module IMPORTS `existenceBound` +
 * `parseDecimalRational` from the pinned `src/derive/quantile.js` (never
 * reimplemented — the eligibility.js house rule) and evaluates the three levels in
 * DESCENDING order, selecting the first (= largest) that clears.
 *
 * FR-D4 lawfulness precondition: the resolver produces a p\* ONLY when a primary is
 * sealed AND its `n_observations` carries FR-A6 class (i) or accepted class (ii);
 * otherwise it emits a `blocked{reason}` record (specification/acquisition
 * escalation), never a resolved p\*.
 *
 * Verified first-hand this pass against the frozen code: clearing minima are n=39
 * (0.90), 80 (0.95), 408 (0.99); at every Gate-3-passing n (≥ 10⁴) all three levels
 * clear, so a sealed primary's p\* is mechanically "0.99" for any lawful n ≥ 10⁴.
 *
 * @module lab/resolution/pstar
 */

import { existenceBound, parseDecimalRational } from '../../src/derive/quantile.js';

/** The frozen p\* candidate levels, DESCENDING (largest first). */
export const PSTAR_LEVELS = Object.freeze(['0.99', '0.95', '0.90']);

/** α = 0.05 (the pinned rational) and the ≥3× margin threshold α/3 (the eligibility construction). */
export const ALPHA = parseDecimalRational('0.05');
/** The census-margin threshold = α/3 (same IEEE construction as eligibility.existenceMarginThreshold). */
export const THRESHOLD = (ALPHA.num / ALPHA.den) / 3;

/** A p\*-resolution refusal — the defensive no-clear branch (spec-error HALT, DR-6.5). */
export class PStarRefusal extends Error {
  constructor(message) { super(message); this.name = 'PStarRefusal'; }
}

/**
 * Compute the full bound table + resolved p\* at a census-measured n. Descending
 * scan; the first clearing level is p\*. Throws {@link PStarRefusal} if NO level
 * clears (impossible for a Gate-3-passing primary; never a silent default).
 *
 * @param {number} n - census-measured n_observations of the sealed primary
 * @returns {{bounds:Array<{p:string, bound:number, clears_3x:boolean}>, p_star:string}}
 */
export function resolvePStar(n) {
  if (!Number.isInteger(n) || n < 1) throw new PStarRefusal(`p*: n must be a positive integer, got ${n}`);
  const bounds = [];
  let p_star = null;
  for (const p of PSTAR_LEVELS) {
    const bound = existenceBound(n, parseDecimalRational(p));
    const clears_3x = bound <= THRESHOLD;
    bounds.push({ p, bound, clears_3x });
    if (clears_3x && p_star === null) p_star = p; // first (largest) clearing level
  }
  if (p_star === null) {
    throw new PStarRefusal(`p*: no level in {${PSTAR_LEVELS.join(',')}} clears α/3=${THRESHOLD} at n=${n} (specification error, HALT)`);
  }
  return { bounds, p_star };
}

/**
 * Resolve p\* where lawful (FR-D4), or emit a blocked record. Returns the
 * `p-star-resolution.json` body — either `{ ..., p_star }` or `{ ..., blocked:{reason} }`.
 * No wall-clock (deterministic derived record, DR-10.3); wrapped by evidence.js.
 *
 * @param {Object} p
 * @param {(Object|null)} p.sealed_primary - the sealed primary identity, or null
 * @param {number} p.n - the primary's census-measured n_observations
 * @param {("i"|"ii"|"iii"|"iv"|"v"|null)} p.n_classification - FR-A6 class of `n`
 * @param {Object} [p.refs] - { selection_outcome, provenance_n, quantile_digest }
 * @returns {Object}
 */
export function resolveLawful({ sealed_primary, n, n_classification, refs = {} }) {
  const bodyBase = {
    record_kind: 'p-star-resolution',
    schema_version: '1.0.0',
    cycle: 'cycle-005',
    refs,
    sealed_primary: sealed_primary || null,
    n: Number.isFinite(n) ? n : null,
    n_classification: n_classification ?? null,
    alpha: '0.05',
    threshold: THRESHOLD,
  };

  if (!sealed_primary) {
    return { ...bodyBase, bounds: [], p_star: null, blocked: { reason: 'no primary sealed — p* is not resolvable (FR-D4)' } };
  }
  // FR-D4: n must be FR-A6 class (i) or accepted class (ii).
  if (n_classification !== 'i' && n_classification !== 'ii') {
    return { ...bodyBase, bounds: [], p_star: null, blocked: { reason: `sealed primary n_observations classification "${n_classification}" is not FR-A6 class (i)/(ii) — specification/acquisition escalation, not a resolved p* (FR-D4)` } };
  }
  if (!Number.isInteger(n)) {
    return { ...bodyBase, bounds: [], p_star: null, blocked: { reason: `sealed primary n_observations is not an integer (${n}) — cannot resolve p* (FR-D4)` } };
  }
  const { bounds, p_star } = resolvePStar(n);
  return { ...bodyBase, bounds, p_star };
}
