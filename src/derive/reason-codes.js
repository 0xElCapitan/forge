/**
 * src/derive/reason-codes.js
 *
 * Single source of truth for the derivation kernel's output-state and
 * reason-code vocabulary (Cycle-004 FR-5; SDD DR-5, Lane L1). Frozen,
 * immutable, and the ONLY place these enums are defined — no other product
 * module duplicates the vocabulary.
 *
 * @module derive/reason-codes
 */

/**
 * The four output states (arch §3-3:61). Frozen.
 * @type {Readonly<{RANKED_CANDIDATES:string, NO_INSTRUMENT:string, MORE_METADATA_REQUIRED:string, HUMAN_REVIEW_REQUIRED:string}>}
 */
export const OUTPUT_STATES = Object.freeze({
  RANKED_CANDIDATES:      'RANKED_CANDIDATES',
  NO_INSTRUMENT:          'NO_INSTRUMENT',
  MORE_METADATA_REQUIRED: 'MORE_METADATA_REQUIRED',
  HUMAN_REVIEW_REQUIRED:  'HUMAN_REVIEW_REQUIRED',
});

/**
 * The fourteen reserved reason codes (thesis §11:286). Frozen.
 * Only `insufficient_history`, `unacceptable_missingness`, and
 * `no_nontrivial_parameter` are exercised this cycle; the rest are reserved
 * enum values.
 * @type {Readonly<Record<string,string>>}
 */
export const REASON_CODES = Object.freeze({
  insufficient_history:     'insufficient_history',
  unstable_distribution:    'unstable_distribution',
  no_nontrivial_parameter:  'no_nontrivial_parameter',
  ambiguous_authority:      'ambiguous_authority',
  excessive_revision_risk:  'excessive_revision_risk',
  unresolved_units:         'unresolved_units',
  weak_out_of_sample:       'weak_out_of_sample',
  source_dependency:        'source_dependency',
  reflexive_feed:           'reflexive_feed',
  trivial_outcome:          'trivial_outcome',
  impossible_outcome:       'impossible_outcome',
  unacceptable_missingness: 'unacceptable_missingness',
  unsupported_family:       'unsupported_family',
  human_review_required:    'human_review_required',
});

/** Ordered, frozen list of the four output states. */
export const OUTPUT_STATE_LIST = Object.freeze(Object.keys(OUTPUT_STATES));

/** Ordered, frozen list of the fourteen reason codes. */
export const REASON_CODE_LIST = Object.freeze(Object.keys(REASON_CODES));

/**
 * @param {string} code
 * @returns {boolean} true iff `code` is a registered reason code.
 */
export function isReasonCode(code) {
  return Object.prototype.hasOwnProperty.call(REASON_CODES, code);
}

/**
 * @param {string} state
 * @returns {boolean} true iff `state` is a registered output state.
 */
export function isOutputState(state) {
  return Object.prototype.hasOwnProperty.call(OUTPUT_STATES, state);
}
