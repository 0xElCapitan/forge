/**
 * lab/census/selection-rule.js
 *
 * Cycle-004 S03 (FR-11d; SDD Lane L5 07-cycle-004-sdd.md:536; arch section 9:262;
 * Sprint Plan T3.4).
 *
 * The frozen mechanical selection rule: iterate the candidate pool in ascending
 * `rank`, evaluate all six eligibility gates on each candidate's aggregate
 * metadata, and SEAL:
 *
 *   primary = the first candidate passing all hard gates
 *   reserve = the second candidate passing all hard gates
 *
 * The result is sealed and mechanical. There is NO human-choice hook anywhere:
 * the operator approves the pool and the rule, never the outcome (arch section 9:262;
 * PRD FR-11d). S03 MUST NOT apply this rule to real candidate metadata — it is
 * exercised only against fabricated local metadata in tests. The real primary /
 * reserve families are selected mechanically only at C-005 M4, post-freeze,
 * post-census.
 *
 * Pure and deterministic: no network, no filesystem. The caller supplies each
 * candidate's aggregate metadata and the frozen burned-list authority.
 *
 * @module lab/census/selection-rule
 */

import { evaluateEligibility } from './eligibility.js';

/**
 * Apply the sealed mechanical selection rule to a candidate pool with attached
 * aggregate metadata.
 *
 * @param {Array<{rank:number, provider:string, product:string, metadata:Object}>} candidates
 * @param {{entries: Array<{provider:string, product:string}>}} burnedList - frozen authority
 * @returns {{sealed:true, primary:Object|null, reserve:Object|null, evaluations:Array<Object>}}
 */
export function applySelectionRule(candidates, burnedList) {
  if (!Array.isArray(candidates)) throw new Error('applySelectionRule: candidates must be an array');

  // Ascending `rank` is the sole ordering authority. A copy is sorted so the
  // caller's array is never mutated; ties on rank are a specification error.
  const ordered = candidates.slice().sort((a, b) => a.rank - b.rank);
  const seenRanks = new Set();
  for (const c of ordered) {
    if (!Number.isInteger(c.rank)) throw new Error(`applySelectionRule: candidate rank must be an integer (provider ${c.provider})`);
    if (seenRanks.has(c.rank)) throw new Error(`applySelectionRule: duplicate rank ${c.rank} — enumeration order must be a total order`);
    seenRanks.add(c.rank);
  }

  const evaluations = [];
  const passing = [];
  for (const c of ordered) {
    const result = evaluateEligibility(c.metadata, burnedList);
    const identity = { rank: c.rank, provider: c.provider, product: c.product };
    evaluations.push({ ...identity, eligible: result.eligible, failed_hard_gates: result.failed_hard_gates });
    if (result.eligible) passing.push(identity);
  }

  return {
    sealed: true,
    primary: passing.length >= 1 ? passing[0] : null,
    reserve: passing.length >= 2 ? passing[1] : null,
    evaluations,
  };
}
