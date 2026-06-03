/**
 * src/bundle/enums.js
 * ConstructAdmissionBundle — closed enums / value sets (shape only).
 *
 * Shape/constants only (S03-A). Each export is the closed set of allowed string
 * values for a bundle field. No validation, coercion, or acceptance logic lives
 * here — all parse/validate/reject semantics are Echelon's receiving end
 * (SDD §16). Grounded in SDD §6.1, §7, §7.1, §12 and the Cycle-113 receiving
 * contract.
 *
 * @module bundle/enums
 */

/**
 * manifest.json `capability_flags[]` — closed enum of exactly five; declares
 * INTENT only, never behavior (SDD §6.1). No payout terms attach in the bundle.
 */
export const CAPABILITY_FLAGS = Object.freeze([
  'parametric_payout_capable',
  'multi_input_position',
  'multi_class_resolution',
  'binary_resolution',
  'composed_theatre',
]);

/**
 * `source_side` — the boundary discriminator for an oracle declaration / settling
 * source (SDD §7, invariant S-1). One of forge | echelon | lattice.
 */
export const SOURCE_SIDE = Object.freeze(['forge', 'echelon', 'lattice']);

/**
 * oracle_declarations[] `role` — the construct's function for an oracle (SDD §7).
 */
export const ORACLE_ROLE = Object.freeze([
  'primary',
  'cross_validation',
  'settlement',
  'corroboration',
  'signal',
]);

/**
 * `trust_tier` — FORGE-owned trust axis (SDD §7.1). REQUIRED iff
 * `source_side == forge`, else null. FORGE MUST NOT coerce T0–T3 onto Echelon's
 * source-authority tiers (distinct axes); that reconciliation is Echelon's, not
 * defined or performed here.
 */
export const TRUST_TIER = Object.freeze(['T0', 'T1', 'T2', 'T3', 'unknown']);

/**
 * handoff.md `theatre_trigger_conditions[].template` — FORGE's six templates,
 * matching the `proposal-ir.json::Proposal.template` enum exactly
 * (SDD §12, invariant H-4).
 */
export const HANDOFF_TEMPLATE = Object.freeze([
  'threshold_gate',
  'cascade',
  'divergence',
  'regime_shift',
  'anomaly',
  'persistence',
]);
