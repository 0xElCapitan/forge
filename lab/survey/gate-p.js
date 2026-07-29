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

/** Repo-relative location of the FIRST-ISSUE Gate-P acceptance record (SDD DR-2.4). */
export const GATE_P_RECORD_REL = 'lab/evidence/cycle-006/gate-p-acceptance.json';
/** Repo-relative location of the revision-2 re-issue record (criteria §16.1). */
export const GATE_P_RECORD_REL_R2 = 'lab/evidence/cycle-006/gate-p-acceptance-2.json';
/**
 * The acceptance chain in issue order. A re-issue NEVER edits or deletes its
 * predecessor (criteria §16): it appends. The GOVERNING record is the last one that
 * exists, and it is the only record that can authorize a survey act — an earlier
 * record accepts criteria bytes that are no longer on disk, so it refuses by
 * digest mismatch. Adding a link is a deliberate one-line edit with reviewer visibility.
 */
export const GATE_P_RECORD_CHAIN = Object.freeze([GATE_P_RECORD_REL, GATE_P_RECORD_REL_R2]);
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

/**
 * Fields a `prior_exposure_disclosure` must carry, and the exact value each must hold.
 * `true`/`false` mean "exactly that boolean"; `'text'` means a non-empty string.
 *
 * These are not decorative. Each one is a claim the operator makes on the record about
 * what a halted earlier attempt did and did not do, and every one of them is a claim a
 * reviewer can check against the preserved evidence. The three `false` entries are the
 * load-bearing ones: they are what makes a re-issue lawful rather than a laundering of
 * an outcome-aware reading.
 */
export const PRIOR_EXPOSURE_DISCLOSURE_FIELDS = Object.freeze({
  occurred: true,
  stopped_during_portal: 'text',
  exposure_scope: 'text',
  documentation_taxonomy_inspected: 'text',
  ambiguity_discovered: 'text',
  criterion_implications_discussed: true,
  canonical_product_family_set_emitted: false,
  survey_record_written: false,
  candidate_disposition_written: false,
  candidate_admitted_rejected_ranked_or_pooled: false,
  measured_value_or_provider_api_accessed: false,
  reissue_rule_basis: 'text',
  complete_re_survey_required: true,
  earlier_evidence_preserved: true,
  evidence_ref: 'text',
});

/** Fields a `supersedes` block must carry to name the record it replaces. */
const SUPERSEDES_DIGEST_FIELDS = Object.freeze(['record_id', 'criteria_digest', 'successor_prereg_digest', 'derivations_digest']);

/** True when the record presents itself as a re-issue (i.e. it names a predecessor). */
export function isReissueRecord(record) {
  return isPlainObject(record) && record.supersedes !== undefined;
}

/**
 * The C6-FR-N4 outcome-blindness attestation, branched by issue kind.
 *
 * A **first issue** must attest `no_prior_enumeration_attestation === true` — nothing was
 * nominated or evaluated before the criteria existed.
 *
 * A **superseding re-issue** may not copy that unqualified attestation forward once an
 * earlier attempt has read anything: doing so would put a false claim on the authority
 * record. It must instead name the record it supersedes and disclose the bounded exposure.
 *
 * @param {Object} record
 * @returns {string[]} problems (empty when the record's attestation surface is lawful)
 */
export function validateOutcomeBlindnessAttestation(record) {
  const problems = [];
  if (!isReissueRecord(record)) {
    if (record.no_prior_enumeration_attestation !== true) {
      problems.push('no_prior_enumeration_attestation must be exactly true (C6-FR-N4)');
    }
    if ('prior_exposure_disclosure' in record) {
      problems.push('a first-issue record must not carry prior_exposure_disclosure — disclosure belongs only to a superseding re-issue that names its predecessor via supersedes (C6-FR-N4)');
    }
    return problems;
  }

  // A re-issue may never carry the unqualified first-issue attestation.
  if ('no_prior_enumeration_attestation' in record) {
    problems.push('a superseding re-issue record must not carry no_prior_enumeration_attestation — the unqualified first-issue attestation is not truthful once an earlier attempt has read documentation; disclose the bounded exposure instead (C6-FR-N4)');
  }

  const s = record.supersedes;
  if (!isPlainObject(s)) {
    problems.push('supersedes must be an object naming the superseded record');
  } else {
    for (const k of SUPERSEDES_DIGEST_FIELDS) {
      if (!isDigest(s[k])) problems.push(`supersedes.${k} must be a "sha256:<64 hex>" digest`);
    }
    if (!isNonEmptyString(s.record_path)) problems.push('supersedes.record_path must name where the superseded record is preserved');
    if (s.preserved !== true) problems.push('supersedes.preserved must be exactly true — a re-issue appends, it never edits or deletes its predecessor');
    if (!isNonEmptyString(s.reason)) problems.push('supersedes.reason is required');
    if (isDigest(s.record_id) && s.record_id === record.record_id) {
      problems.push('supersedes.record_id equals this record — a record cannot supersede itself');
    }
    for (const k of ['criteria_digest', 'successor_prereg_digest', 'derivations_digest']) {
      if (isDigest(s[k]) && s[k] === record[k]) {
        problems.push(`supersedes.${k} equals the accepted ${k} — a re-issue must accept different bytes than the record it supersedes`);
      }
    }
  }

  const d = record.prior_exposure_disclosure;
  if (!isPlainObject(d)) {
    problems.push('prior_exposure_disclosure is required on a superseding re-issue record (C6-FR-N4)');
    return problems;
  }
  for (const [k, expected] of Object.entries(PRIOR_EXPOSURE_DISCLOSURE_FIELDS)) {
    if (expected === 'text') {
      if (!isNonEmptyString(d[k])) problems.push(`prior_exposure_disclosure.${k} must be a non-empty string`);
    } else if (d[k] !== expected) {
      problems.push(`prior_exposure_disclosure.${k} must be exactly ${expected}`);
    }
  }
  return problems;
}

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

  // C6-FR-N4: what the record must attest about what came before it. A first issue owes
  // the strict no-prior-enumeration attestation. A re-issue cannot truthfully make that
  // claim once a halted attempt has read anything, so it owes a disclosure instead —
  // and it may NOT carry the unqualified attestation alongside it.
  problems.push(...validateOutcomeBlindnessAttestation(record));

  if (!isNonEmptyString(record.record_id)) problems.push('record_id is required');
  else if (record.record_id !== computeGatePRecordId(record)) {
    problems.push('record_id does not equal the self-excluded content address');
  }

  return { valid: problems.length === 0, problems };
}

/**
 * Resolve the GOVERNING Gate-P record — the last link of {@link GATE_P_RECORD_CHAIN}
 * that exists on disk. Superseded links stay on disk unedited and are deliberately NOT
 * consulted for authority: they accept criteria bytes that a re-issue has replaced, so
 * routing authority through one would let a stale acceptance authorize a later
 * revision's survey outputs (criteria §16, §16.1).
 *
 * @param {Object} p
 * @param {string} p.repoRoot - absolute repository root
 * @returns {{path:string, rel:string, superseded:string[]}}
 */
export function resolveGoverningGatePRecord({ repoRoot }) {
  const base = String(repoRoot).replace(/\\/g, '/').replace(/\/$/, '');
  const present = GATE_P_RECORD_CHAIN.filter(rel => existsSync(`${base}/${rel}`));
  if (present.length === 0) {
    refuse(R.GATE_P_RECORD_ABSENT,
      'no Gate-P acceptance record exists anywhere in the acceptance chain — criteria are not operator-accepted, so no survey, nomination, evaluation, or enumeration act is lawful (I-3, C6-FR-P6)',
      { chain: [...GATE_P_RECORD_CHAIN] });
  }
  const rel = present[present.length - 1];
  return { path: `${base}/${rel}`, rel, superseded: present.slice(0, -1) };
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
    const disclosureProblem = problems.every(p => /^(supersedes\.|prior_exposure_disclosure)/.test(p)
      || p.includes('no_prior_enumeration_attestation') || p.startsWith('supersedes must be'));
    const reason = idProblem ? R.GATE_P_RECORD_ID_MISMATCH
      : attestationProblem ? R.GATE_P_ATTESTATION_MISSING
        : (isReissueRecord(record) && disclosureProblem) ? R.GATE_P_REISSUE_DISCLOSURE_INVALID
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
