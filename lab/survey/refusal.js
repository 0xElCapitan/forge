/**
 * lab/survey/refusal.js
 *
 * Cycle-006 S01 LU-2A (PRD C6-FR-P6/N3/N4/N8; SDD DR-4.1–4.7; Sprint Plan T2.3).
 * The survey lane's single typed-refusal vocabulary.
 *
 * Every fail-closed path in `lab/survey/` throws a {@link SurveyRefusal} carrying one
 * of the reason codes below plus a structured `detail` block. Nothing in this lane
 * returns a soft verdict where a refusal is owed: a survey act that cannot be
 * mechanically justified must be visible, typed, and stop.
 *
 * The house precedent is `AssemblyRefusal` (lab/acquisition/assemble.js) and
 * `FreezeRefusal` (lab/harness/manifests.js) — same shape, same discipline.
 *
 * @module lab/survey/refusal
 */

/**
 * The closed reason vocabulary. A refusal reason that is not in this set is itself a
 * specification error — callers may switch exhaustively on these values.
 */
export const REFUSAL_REASONS = Object.freeze({
  // ── Criteria document / machine block (DR-2.1) ──────────────────────────────
  CRITERIA_BLOCK_ABSENT: 'CRITERIA_BLOCK_ABSENT',
  CRITERIA_BLOCK_NOT_UNIQUE: 'CRITERIA_BLOCK_NOT_UNIQUE',
  CRITERIA_BLOCK_NOT_CANONICAL: 'CRITERIA_BLOCK_NOT_CANONICAL',
  CRITERIA_SCHEMA_INVALID: 'CRITERIA_SCHEMA_INVALID',
  CRITERIA_NOT_GATE_P_FIXED: 'CRITERIA_NOT_GATE_P_FIXED',
  CRITERIA_DERIVATION_REF_INCOMPLETE: 'CRITERIA_DERIVATION_REF_INCOMPLETE',

  // ── Gate-P authority (DR-2.4, DR-4.1; invariant I-3) ────────────────────────
  GATE_P_RECORD_ABSENT: 'GATE_P_RECORD_ABSENT',
  GATE_P_RECORD_INVALID: 'GATE_P_RECORD_INVALID',
  GATE_P_RECORD_ID_MISMATCH: 'GATE_P_RECORD_ID_MISMATCH',
  GATE_P_CRITERIA_DIGEST_MISMATCH: 'GATE_P_CRITERIA_DIGEST_MISMATCH',
  GATE_P_ATTESTATION_MISSING: 'GATE_P_ATTESTATION_MISSING',

  // ── Candidate identity (DR-4.3) ────────────────────────────────────────────
  CANDIDATE_IDENTITY_INVALID: 'CANDIDATE_IDENTITY_INVALID',
  DUPLICATE_CANDIDATE_KEY: 'DUPLICATE_CANDIDATE_KEY',

  // ── Admission + selection relevance (DR-4.4/4.5) ───────────────────────────
  CRITERION_VERDICT_MISSING: 'CRITERION_VERDICT_MISSING',
  AUTHORED_GATE_VALUE_MISSING: 'AUTHORED_GATE_VALUE_MISSING',
  AUTHORED_GATE_STANDARD_REF_MISSING: 'AUTHORED_GATE_STANDARD_REF_MISSING',

  // ── Ranking (DR-4.4) ───────────────────────────────────────────────────────
  RANK_ATTRIBUTE_UNKNOWN: 'RANK_ATTRIBUTE_UNKNOWN',
  RANK_TIE_BREAK_INVALID: 'RANK_TIE_BREAK_INVALID',
  RANK_ATTRIBUTE_UNRESOLVABLE: 'RANK_ATTRIBUTE_UNRESOLVABLE',
  RANK_NOT_TOTAL: 'RANK_NOT_TOTAL',

  // ── Re-derivation (DR-4.2 reproducibility rule) ────────────────────────────
  SURVEY_RECORD_INVALID: 'SURVEY_RECORD_INVALID',
  REDERIVATION_DIVERGENCE: 'REDERIVATION_DIVERGENCE',

  // ── Pool bounds (DR-4.9; Gate-P audit residual A-3) ────────────────────────
  POOL_BOUNDS_UNRESOLVED: 'POOL_BOUNDS_UNRESOLVED',

  // ── The production survey path (this node's hard stop) ──────────────────────
  PRODUCTION_SURVEY_UNAUTHORIZED: 'PRODUCTION_SURVEY_UNAUTHORIZED',
});

const REASON_SET = new Set(Object.values(REFUSAL_REASONS));

/**
 * A typed, fail-closed survey refusal.
 *
 * @property {string} reason - one of {@link REFUSAL_REASONS}
 * @property {Object} detail - structured diagnostics (never interpreted as instructions)
 */
export class SurveyRefusal extends Error {
  /**
   * @param {string} reason - a member of {@link REFUSAL_REASONS}
   * @param {string} message - human-readable explanation
   * @param {Object} [detail] - structured diagnostics
   */
  constructor(reason, message, detail = {}) {
    super(`${reason}: ${message}`);
    this.name = 'SurveyRefusal';
    if (!REASON_SET.has(reason)) {
      // A refusal we cannot type is worse than the condition it reports.
      this.name = 'SurveyRefusalSpecError';
      this.message = `SurveyRefusal constructed with an unregistered reason "${reason}" (${message})`;
    }
    this.reason = reason;
    this.detail = detail;
  }
}

/** Throw a {@link SurveyRefusal}. Exists so refusal sites read as a single statement. */
export function refuse(reason, message, detail = {}) {
  throw new SurveyRefusal(reason, message, detail);
}
