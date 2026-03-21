/**
 * src/processor/settlement.js
 * Generalized evidence class assignment.
 *
 * Maps oracle trust tier → evidence_class label for EvidenceBundle.
 * Evidence class determines how a bundle is used in theatre resolution:
 *   - 'ground_truth'  : may settle a theatre (T0 / T1)
 *   - 'corroboration' : updates position only, cannot settle (T2)
 *   - 'provisional'   : updates position only, cannot settle (T3 / unknown)
 *
 * Settlement authority is re-enforced at bundle processing time by oracle-trust.js
 * (canSettle). settlement.js is responsible for labelling; oracle-trust.js is
 * responsible for enforcement.
 *
 * @module processor/settlement
 */

// ─── Evidence class registry ─────────────────────────────────────────────────

/**
 * Tier → evidence class mapping.
 * T1 is labelled 'ground_truth' because it settles (with Brier discount applied
 * at scoring time), consistent with TREMOR/CORONA/BREATH contracts.
 */
const TIER_CLASS = {
  T0: 'ground_truth',
  T1: 'ground_truth',  // settles with Brier discount
  T2: 'corroboration',
  T3: 'provisional',
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Assign an evidence class based on oracle trust tier.
 *
 * @param {string} tier - oracle trust tier: 'T0'|'T1'|'T2'|'T3'
 * @returns {'ground_truth'|'corroboration'|'provisional'} evidence class
 */
export function assignEvidenceClass(tier) {
  return TIER_CLASS[tier] ?? 'provisional';
}

/**
 * Returns true when an evidence class permits theatre settlement.
 * Only 'ground_truth' classes may settle.
 *
 * Note: for enforcement, prefer oracle-trust.js canSettle(tier), which
 * operates on the tier directly and is the authoritative settlement gate.
 *
 * @param {string} evidence_class
 * @returns {boolean}
 */
export function canSettleByClass(evidence_class) {
  return evidence_class === 'ground_truth';
}
