/**
 * lab/census/eligibility.js
 *
 * Cycle-004 S03 (FR-11c; SDD Lane L5 07-cycle-004-sdd.md:535; arch section 9:244-250;
 * Sprint Plan T3.3).
 *
 * The six pre-registered mechanical eligibility gates, as PURE, DETERMINISTIC,
 * REASON-BEARING predicates over an aggregate-metadata object. No network access
 * and no filesystem access anywhere in this predicate layer — the caller supplies
 * the aggregate metadata and the frozen burned-list authority.
 *
 * The existence-bound arithmetic is IMPORTED from the landed product primitive
 * `src/derive/quantile.js` (same math, no reimplementation — SDD risk row 5).
 *
 * Gates (arch section 9:244-250):
 *   1. authority-published AND public AND machine-readable AND free
 *   2. exogenous (authored judgment recorded)
 *   3. history >= 3 years AND n >= 10^4 AND existenceBound(n, "0.90") <= alpha/3
 *      (the census-margin variant; alpha = 0.05, one further pinned division; SDD:229)
 *   4. mechanical outcome function declared (realized future values; no human labeling)
 *   5. zero burned-list matches (provider-product join)
 *   6. documented revision/vintage semantics (TIE-BREAKER, not a hard gate)
 *
 * `eligible` is the conjunction of the FIVE hard gates (1-5). Gate 6 is evaluated
 * and recorded but is a tie-breaker only, never a hard eligibility failure.
 *
 * @module lab/census/eligibility
 */

import { existenceBound, parseDecimalRational } from '../../src/derive/quantile.js';
import { isBurned } from './burned-list.js';

/** Gate-3 minimum retrievable history (arch section 9:247). */
export const MIN_HISTORY_YEARS = 3;
/** Gate-3 minimum observation count = 10^4 (arch section 9:247). */
export const MIN_OBSERVATIONS = 10000;
/** alpha = 0.05 (DR-4 pinned; SDD:229) as the exact rational used by the primitive. */
export const ALPHA = parseDecimalRational('0.05');
/** The census-margin quantile p* = "0.90" (arch section 9:247), exact rational form. */
export const CENSUS_MARGIN_P = parseDecimalRational('0.90');

/**
 * The census-margin existence-bound threshold = alpha / 3 (the "3x margin" rule,
 * one further pinned IEEE division; SDD:229). Gate 3 requires
 * `existenceBound(n, "0.90") <= this`.
 * @returns {number}
 */
export function existenceMarginThreshold() {
  return (ALPHA.num / ALPHA.den) / 3;
}

/** Gate 1 — authority-published, public, machine-readable, free (all four). */
export function gateAuthority(m) {
  const reasons = [];
  if (m.authority_published !== true) reasons.push('not authority-published');
  if (m.public !== true) reasons.push('not public');
  if (m.machine_readable !== true) reasons.push('not machine-readable');
  if (m.free !== true) reasons.push('not free');
  return { pass: reasons.length === 0, reasons };
}

/** Gate 2 — exogenous, with the authored judgment recorded. */
export function gateExogeneity(m) {
  const reasons = [];
  if (typeof m.exogeneity_judgment !== 'string' || m.exogeneity_judgment.trim().length === 0) {
    reasons.push('exogeneity judgment not recorded');
  }
  if (m.exogenous !== true) reasons.push('judged non-exogenous (plausible reflexivity)');
  return { pass: reasons.length === 0, reasons };
}

/**
 * Gate 3 — history: >= 3 years AND >= 10^4 observations AND the census-margin
 * existence bound clears (existenceBound(n, "0.90") <= alpha/3). Reason-bearing
 * with per-sub-condition results; the existence-bound value is imported, not
 * reimplemented.
 */
export function gateHistory(m) {
  const reasons = [];
  const years_ok = Number.isFinite(m.history_years) && m.history_years >= MIN_HISTORY_YEARS;
  if (!years_ok) reasons.push(`history_years ${m.history_years} < ${MIN_HISTORY_YEARS}`);

  const n = m.n_observations;
  const count_ok = Number.isInteger(n) && n >= MIN_OBSERVATIONS;
  if (!count_ok) reasons.push(`n_observations ${n} < ${MIN_OBSERVATIONS}`);

  // Existence-bound margin is only defined for a positive integer n.
  const threshold = existenceMarginThreshold();
  let bound = null;
  let existence_margin_ok = false;
  if (Number.isInteger(n) && n > 0) {
    bound = existenceBound(n, CENSUS_MARGIN_P);
    existence_margin_ok = bound <= threshold;
  }
  if (!existence_margin_ok) {
    reasons.push(`existenceBound(n, "0.90")=${bound} > alpha/3=${threshold}`);
  }

  return {
    pass: years_ok && count_ok && existence_margin_ok,
    sub: { years_ok, count_ok, existence_margin_ok, existence_bound: bound, existence_margin_threshold: threshold },
    reasons,
  };
}

/** Gate 4 — mechanical outcome function declared (realized future values; no human labeling). */
export function gateMechanicalOutcome(m) {
  const reasons = [];
  if (m.mechanical_outcome_declared !== true) reasons.push('mechanical outcome function not declared');
  return { pass: reasons.length === 0, reasons };
}

/** Gate 5 — zero burned-list matches (provider-product join). Pass = NOT burned. */
export function gateBurnedList(m, burnedList) {
  const match = isBurned({ provider: m.provider, product: m.product }, burnedList);
  return {
    pass: match === null,
    burned_match: match,
    reasons: match === null ? [] : [`provider-product match against burned list: ${match.provider} / ${match.product}`],
  };
}

/** Gate 6 — documented revision/vintage semantics. TIE-BREAKER only, never a hard failure. */
export function gateVintage(m) {
  const documented = m.revision_vintage_documented === true;
  return { pass: documented, tiebreaker: true, reasons: documented ? [] : ['revision/vintage semantics not documented (tie-breaker only)'] };
}

/**
 * Evaluate all six gates for one aggregate-metadata object. Pure and deterministic.
 * `eligible` is the conjunction of the five HARD gates (1-5); gate 6 is recorded as
 * a tie-breaker and does not affect `eligible`.
 *
 * @param {Object} metadata - aggregate metadata (counts/flags only; no value-level series)
 * @param {{entries: Array<{provider:string, product:string}>}} burnedList - frozen authority
 * @returns {{eligible:boolean, gates:Object, failed_hard_gates:string[]}}
 */
export function evaluateEligibility(metadata, burnedList) {
  if (metadata === null || typeof metadata !== 'object') throw new Error('evaluateEligibility: metadata must be an object');
  const gates = {
    authority: gateAuthority(metadata),
    exogeneity: gateExogeneity(metadata),
    history: gateHistory(metadata),
    mechanical_outcome: gateMechanicalOutcome(metadata),
    burned: gateBurnedList(metadata, burnedList),
    vintage: gateVintage(metadata),
  };
  const hardGates = ['authority', 'exogeneity', 'history', 'mechanical_outcome', 'burned'];
  const failed_hard_gates = hardGates.filter(g => !gates[g].pass);
  return { eligible: failed_hard_gates.length === 0, gates, failed_hard_gates };
}
