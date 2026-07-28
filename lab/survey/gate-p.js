/**
 * lab/survey/gate-p.js
 *
 * Cycle-006 S01 LU-2A (PRD C6-FR-P6/N4; SDD DR-2.4, DR-4.1; Sprint Plan T2.3;
 * standing invariant I-3). The mechanical Gate-P authority check — "criteria before
 * enumeration", made refusable rather than merely stated.
 *
 * ── What this module is ──────────────────────────────────────────────────────
 *
 * The single door every survey act passes through. It answers exactly one question:
 * *does a persisted, self-verifying Gate-P acceptance record exist whose accepted
 * criteria digest equals the criteria bytes on disk?* Anything else — absent record,
 * malformed record, `record_id` that does not self-verify, digest that does not match
 * the criteria file, missing no-prior-enumeration attestation — is a typed refusal.
 *
 * ── What this module is NOT ──────────────────────────────────────────────────
 *
 * It does not create, sign, or approve a Gate-P record. Gate P is an operator act
 * (Sprint Plan §10 O-1) and the record is materialized by a later task under operator
 * authority. This module only ever READS. While no such record exists — the state at
 * the time of writing — every production survey entry point refuses, visibly.
 *
 * @module lab/survey/gate-p
 */

import { readFileSync, existsSync } from 'node:fs';

import { contentAddress, sha256LFNormalized } from '../harness/manifests.js';
import { REFUSAL_REASONS as R, refuse } from './refusal.js';
import { criteriaDigest } from './criteria.js';

/** Repo-relative default location of the Gate-P acceptance record (SDD DR-2.4). */
export const GATE_P_RECORD_REL = 'lab/evidence/cycle-006/gate-p-acceptance.json';
/** Repo-relative default location of the criteria document (SDD DR-1). */
export const CRITERIA_DOC_REL = 'lab/preregistration/cycle-006/pool-entry-criteria.md';
/** Repo-relative default location of the successor preregistration (SDD DR-1). */
export const PREREGISTRATION_REL = 'lab/preregistration/cycle-006/preregistration.md';
/** Repo-relative default location of the CI-line derivation worksheet (SDD DR-1/DR-3.4). */
export const DERIVATIONS_REL = 'lab/preregistration/cycle-006/criteria-derivations.json';

export const GATE_P_RECORD_KIND = 'gate-p-acceptance';

/** The three digests Gate P accepts as ONE unit (DR-2.3). */
export const ACCEPTED_DIGEST_KEYS = Object.freeze(['criteria_digest', 'successor_prereg_digest', 'derivations_digest']);

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
function isDigest(v) { return typeof v === 'string' && /^sha256:[0-9a-f]{64}$/.test(v); }

/** `record_id` = content address of the record with `record_id` removed (repo convention). */
export function computeGatePRecordId(record) {
  const { record_id, ...rest } = record;
  void record_id;
  return contentAddress(rest);
}

/**
 * Fail-closed shape + self-consistency validation of a Gate-P acceptance record.
 * PURE (no throw, no I/O) — the caller decides to refuse.
 *
 * @param {Object} record
 * @returns {{valid:boolean, problems:string[]}}
 */
export function validateGatePRecord(record) {
  const problems = [];
  if (!isPlainObject(record)) return { valid: false, problems: ['Gate-P record must be an object'] };

  if (record.record_kind !== GATE_P_RECORD_KIND) problems.push(`record_kind must be "${GATE_P_RECORD_KIND}"`);
  if (record.gate !== 'P') problems.push('gate must be "P"');
  if (record.cycle !== 'cycle-006') problems.push('cycle must be "cycle-006"');
  if (!isNonEmptyString(record.schema_version)) problems.push('schema_version is required');

  for (const k of ACCEPTED_DIGEST_KEYS) {
    if (!isDigest(record[k])) problems.push(`${k} must be a "sha256:<64 hex>" digest`);
  }

  if (!isNonEmptyString(record.credential_posture)) problems.push('credential_posture is required (UD-C6-4, fixed at Gate P)');

  const pb = record.pool_bounds;
  if (!isPlainObject(pb)) {
    problems.push('pool_bounds is required');
  } else {
    for (const k of ['min_pool_selection_relevant', 'max_pool', 'k_max']) {
      if (!Number.isInteger(pb[k]) || pb[k] < 1) problems.push(`pool_bounds.${k} must be an integer >= 1`);
    }
    if (Number.isInteger(pb.min_pool_selection_relevant) && Number.isInteger(pb.max_pool)
      && pb.min_pool_selection_relevant > pb.max_pool) {
      problems.push('pool_bounds.min_pool_selection_relevant exceeds pool_bounds.max_pool');
    }
  }

  if (!isNonEmptyString(record.source_universe_ref)) problems.push('source_universe_ref is required');
  if (!isNonEmptyString(record.survey_procedure_ref)) problems.push('survey_procedure_ref is required');
  if (!isNonEmptyString(record.operator_statement)) problems.push('operator_statement is required');
  if (!isNonEmptyString(record.at)) problems.push('at (operator-act wall clock) is required');

  const refs = record.refs;
  if (!isPlainObject(refs)) problems.push('refs is required');
  else {
    if (!isDigest(refs.historical_freeze_companion)) problems.push('refs.historical_freeze_companion must be a digest');
    if (!isDigest(refs.trials_ledger_digest)) problems.push('refs.trials_ledger_digest must be a digest');
  }

  // C6-FR-N4: the operator's statement that nothing was nominated or evaluated first.
  if (record.no_prior_enumeration_attestation !== true) {
    problems.push('no_prior_enumeration_attestation must be exactly true (C6-FR-N4)');
  }

  if (!isNonEmptyString(record.record_id)) problems.push('record_id is required');
  else if (record.record_id !== computeGatePRecordId(record)) {
    problems.push('record_id does not equal the self-excluded content address');
  }

  return { valid: problems.length === 0, problems };
}

/**
 * Load and verify the Gate-P record, then verify it accepts the criteria bytes that
 * are actually on disk. Every failure path is a typed {@link SurveyRefusal}.
 *
 * @param {Object} p
 * @param {string} p.gatePRecordPath - absolute path to the Gate-P acceptance record
 * @param {string} p.criteriaDocumentPath - absolute path to the criteria document
 * @returns {{record:Object, criteria_digest:string, record_id:string}}
 */
export function verifyGatePAuthority({ gatePRecordPath, criteriaDocumentPath }) {
  if (!existsSync(gatePRecordPath)) {
    refuse(R.GATE_P_RECORD_ABSENT,
      'no Gate-P acceptance record exists — criteria are not operator-accepted, so no survey, nomination, evaluation, or enumeration act is lawful (I-3, C6-FR-P6)',
      { expected_at: GATE_P_RECORD_REL });
  }
  let record;
  try {
    record = JSON.parse(readFileSync(gatePRecordPath, 'utf8'));
  } catch (e) {
    refuse(R.GATE_P_RECORD_INVALID, `Gate-P record is not readable JSON: ${e.message}`, { expected_at: GATE_P_RECORD_REL });
  }

  const { valid, problems } = validateGatePRecord(record);
  if (!valid) {
    const idProblem = problems.some(p => p.includes('self-excluded content address'));
    const attestationProblem = problems.length === 1 && problems[0].includes('no_prior_enumeration_attestation');
    const reason = idProblem ? R.GATE_P_RECORD_ID_MISMATCH
      : attestationProblem ? R.GATE_P_ATTESTATION_MISSING
        : R.GATE_P_RECORD_INVALID;
    refuse(reason, `Gate-P record failed validation (${problems.length} problem(s))`, { problems });
  }

  if (!existsSync(criteriaDocumentPath)) {
    refuse(R.CRITERIA_BLOCK_ABSENT, 'the criteria document named by the Gate-P record is not on disk', { expected_at: CRITERIA_DOC_REL });
  }
  const onDisk = criteriaDigest(readFileSync(criteriaDocumentPath));
  if (onDisk !== record.criteria_digest) {
    refuse(R.GATE_P_CRITERIA_DIGEST_MISMATCH,
      'the criteria document on disk is not the document Gate P accepted — an amendment is a full re-issue (new Gate-P record, complete re-survey), never an edit under a standing acceptance (DR-2.5)',
      { accepted: record.criteria_digest, on_disk: onDisk });
  }

  return { record, criteria_digest: onDisk, record_id: record.record_id };
}

/**
 * Verify that the OTHER two accepted digests still match their files. Separated from
 * {@link verifyGatePAuthority} because the criteria-digest match is the survey's
 * authority gate, whereas these two are the unit-acceptance integrity check the
 * enumeration and freeze stages additionally owe (DR-2.3).
 *
 * @returns {{valid:boolean, problems:string[]}}
 */
export function verifyAcceptedDigestUnit({ record, preregistrationPath, derivationsPath }) {
  const problems = [];
  const check = (label, path, accepted) => {
    if (!existsSync(path)) { problems.push(`${label}: file absent at ${path}`); return; }
    const actual = sha256LFNormalized(readFileSync(path));
    if (actual !== accepted) problems.push(`${label}: on-disk digest ${actual} != accepted ${accepted}`);
  };
  check('successor_prereg_digest', preregistrationPath, record?.successor_prereg_digest);
  check('derivations_digest', derivationsPath, record?.derivations_digest);
  return { valid: problems.length === 0, problems };
}
