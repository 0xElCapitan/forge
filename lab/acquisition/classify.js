/**
 * lab/acquisition/classify.js
 *
 * Cycle-005 S01 (PRD FR-A6/FR-A7, §9.1; SDD DR-3, DR-7, DR-8; Sprint Plan T1.4).
 *
 * FR-A6 measurement-status classification per measured field, plus the FR-A7
 * acquisition-provenance line writer. PURE classification; the only I/O is the
 * append-only provenance JSONL writer (via the frozen `appendLedgerLine`).
 *
 * The FR-A6 realized class for a measured field is a function of (a) the intended
 * class fixed at Gate A, (b) whether a lawful value was actually obtained, and
 * (c) whether the operator ACCEPTED the intended class-(ii) derivation for that
 * candidate (UD-1). Only class (i), and class (ii) WITH operator acceptance, are
 * lawful gate inputs (PRD FR-A6). A value-bearing/contamination outcome is NEVER
 * routed through here to class 3 — the DR-3 contamination procedure owns it and
 * types the candidate §9.1 class 4.
 *
 * @module lab/acquisition/classify
 */

import { appendLedgerLine, readLedger } from '../harness/ledgers.js';

/** The FR-A6 classes (measured fields only; authored fields carry `authored-input`). */
export const FR_A6 = Object.freeze({
  EXACT: 'i',
  DERIVATION: 'ii',
  APPROXIMATION: 'iii',
  UNAVAILABLE: 'iv',
  SPEC_PROBLEM: 'v',
  AUTHORED: 'authored-input',
});

/**
 * Classify one measured field (FR-A6). Returns
 * `{ classification, gate_eligible, effect_9_1, reason }`.
 *
 * @param {Object} p
 * @param {string} p.field                 - e.g. "n_observations" | "history_years" | "span"
 * @param {*} p.value                       - the extracted value (null when no lawful path)
 * @param {"i"|"ii"|"iii"|"iv"|"v"} p.intended_class - the Gate-A intended class
 * @param {boolean} [p.operator_accepted]   - operator UD-1 acceptance of the intended class-(ii) method
 * @param {boolean} [p.spec_problem]        - the frozen contract is insufficient for this field (class v)
 * @returns {{classification:string, gate_eligible:boolean, effect_9_1:("input-eligible"|"class3"|"class5"), reason:string}}
 */
export function classifyField({ field, value, intended_class, operator_accepted = false, spec_problem = false }) {
  if (spec_problem) {
    return { classification: FR_A6.SPEC_PROBLEM, gate_eligible: false, effect_9_1: 'class5', reason: `${field}: frozen-contract meaning cannot be established (FR-A6 v)` };
  }
  const hasValue = value !== null && value !== undefined;
  if (!hasValue) {
    return { classification: FR_A6.UNAVAILABLE, gate_eligible: false, effect_9_1: 'class3', reason: `${field}: no lawful path to a value (FR-A6 iv) -> acquisition-unresolved` };
  }
  if (intended_class === FR_A6.EXACT) {
    return { classification: FR_A6.EXACT, gate_eligible: true, effect_9_1: 'input-eligible', reason: `${field}: exact lawful measurement (FR-A6 i)` };
  }
  if (intended_class === FR_A6.DERIVATION) {
    if (operator_accepted) {
      return { classification: FR_A6.DERIVATION, gate_eligible: true, effect_9_1: 'input-eligible', reason: `${field}: operator-accepted compatible derivation (FR-A6 ii)` };
    }
    // Intended (ii) without BOTH compatibility demonstration AND operator acceptance
    // is an approximation — NOT a lawful gate input (FR-A6 iii) -> §9.1 class 3.
    return { classification: FR_A6.APPROXIMATION, gate_eligible: false, effect_9_1: 'class3', reason: `${field}: intended derivation not yet operator-accepted (FR-A6 iii; UD-1) -> acquisition-unresolved` };
  }
  // Any other intended class with a value present but not lawful = approximation.
  return { classification: FR_A6.APPROXIMATION, gate_eligible: false, effect_9_1: 'class3', reason: `${field}: not a lawful gate input (FR-A6 iii)` };
}

/**
 * Assemble an FR-A7 acquisition-provenance line. `at` is a wall-clock ISO-8601 UTC
 * string (DR-10.3 governance record — NOT re-derivable, excluded from byte-identity
 * claims). Never carries a value-level series — only the recorded aggregate value.
 *
 * @param {Object} p
 * @returns {Object}
 */
export function buildProvenanceLine({ seq, candidate_rank, provider, product, field, method_id, classification, value_recorded, contact_refs = [], at, notes = '' }) {
  if (!Number.isInteger(seq) || seq < 0) throw new Error('buildProvenanceLine: seq must be a non-negative integer');
  if (typeof at !== 'string' || at.length === 0) throw new Error('buildProvenanceLine: at (wall-clock ISO-8601) required');
  return {
    record_kind: 'acquisition-provenance',
    seq,
    candidate_rank,
    provider,
    product,
    field,
    method_id,
    classification,
    value_recorded,
    contact_refs,
    at,
    notes,
  };
}

/**
 * Append one provenance line to the append-only JSONL, computing the next `seq`
 * from the current file length (single-writer; DR-4.5 append-only). Returns the
 * written record.
 *
 * @param {string} provenancePath - lab/evidence/cycle-005/acquisition-provenance.jsonl
 * @param {Object} fields - buildProvenanceLine inputs WITHOUT `seq`
 * @returns {Object}
 */
export function appendProvenance(provenancePath, fields) {
  const existing = readLedger(provenancePath);
  const seq = existing.length;
  const record = buildProvenanceLine({ ...fields, seq });
  appendLedgerLine(provenancePath, record);
  return record;
}
