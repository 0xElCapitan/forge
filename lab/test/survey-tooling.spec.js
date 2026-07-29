// lab/test/survey-tooling.spec.js
//
// Cycle-006 S01 LU-2A (PRD C6-FR-P4/P5/P6, C6-FR-N3/N4/N5/N8; SDD DR-2.1–2.4, DR-4.1–4.6;
// Sprint Plan T2.1/T2.2/T2.3/T2.3a). The survey lane's behavioural surface:
//
//   §1  criteria machine-block parsing, canonicality, and schema refusals
//   §2  derivation-reference completeness against the CI-line worksheet
//   §3  Gate-P authority — recognized when landed, refused without it or on digest mismatch
//   §4  admission as the criteria conjunction; identity and duplicate refusal
//   §5  the C6-FR-N8 probe, and its agreement with the frozen invariance layer
//   §6  deterministic rank, terminal tie-break, contiguous 1..N
//   §7  validator re-derivation, divergence refusal, and the A-3 fail-closed pool bounds
//   §8  deterministic serialization and the write-root fence
//   §9  the Gate-P-fixed criteria document and the accepted successor preregistration
//   §10 outcome-blindness: no provider-product nominated, evaluated, scored, or ranked
//   §11 historical preservation and ledger baselines, unchanged by LU-2A
//   §12 the landed Gate-P acceptance record: self-verification and digest fidelity
//
// Every fixture under lab/survey/fixtures/ is synthetic. No real or prospective
// provider-product identity appears in this file or in any fixture it reads. The federal
// publishing authorities named in §9/§10 are the Gate-P-declared SOURCE UNIVERSE — places
// a later survey will read — and are never candidates (C6-FR-P4(e)).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalize } from '../../src/receipt/canonicalize.js';
import { contentAddress, sha256LFNormalized } from '../harness/manifests.js';
import { runInvarianceTest } from '../resolution/invariance.js';
import { verifyHistoricalPreservation, C006_TERMINAL_TYPES, C006_HALT_CLASSES } from '../resolution/evidence.js';

import { SurveyRefusal, REFUSAL_REASONS as R } from '../survey/refusal.js';
import {
  parseCriteriaDocument, extractMachineBlock, validateCriteriaBlock, assertGatePFixed,
  validateAgainstWorksheet, findUnprovenancedNumbers, findOperatorSentinels,
  criteriaDigest, CRITERIA_STATUS, CANDIDATE_CRITERION_IDS, AUTHORED_GATE_VALUE_KEYS,
  RANK_ATTRIBUTES, TERMINAL_TIE_BREAK,
} from '../survey/criteria.js';
import {
  verifyGatePAuthority, validateGatePRecord, computeGatePRecordId, verifyAcceptedDigestUnit,
  GATE_P_RECORD_REL, GATE_P_RECORD_REL_R2, CRITERIA_DOC_REL, PREREGISTRATION_REL, DERIVATIONS_REL,
} from '../survey/gate-p.js';
import {
  deriveAdmission, deriveAdmissions, probeSelectionRelevance, candidateKey,
  FAVORABLE_CENSUS_STANDIN,
} from '../survey/admit.js';
import { assignRanks, buildComparator, deriveRankAttributes, validateRankSequence } from '../survey/rank.js';
import {
  rederiveFromSurveyRecord, validatePoolAgainstSurvey, requireSurveyAuthority,
  serializeSurveyArtifact, writeSurveyArtifact, checkPoolBounds, validateSurveyRecordShape,
  readContaminationLedgerState, validateContaminationLedgerPhase, SURVEY_PHASES,
} from '../survey/validate.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIX = join(REPO_ROOT, 'lab/survey/fixtures');
const PREREG_DIR = join(REPO_ROOT, 'lab/preregistration/cycle-006');

const readFix = (n) => readFileSync(join(FIX, n), 'utf8');
const readFixJson = (n) => JSON.parse(readFix(n));

const CRITERIA_FIXED = readFix('synthetic-criteria-gate-p-fixed.md');
const CRITERIA_PENDING = readFix('synthetic-criteria-pending.md');
const GATE_P = readFixJson('synthetic-gate-p-acceptance.json');
const BURNED = readFixJson('synthetic-burned-list.json');
const SURVEY = readFixJson('synthetic-survey-record.json');
const POOL = readFixJson('synthetic-successor-pool.json');

const FIXED_BLOCK = parseCriteriaDocument(CRITERIA_FIXED).block;
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Assert a call refuses with a specific typed reason. */
function refusesWith(reason, fn, label) {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof SurveyRefusal, `${label}: expected a SurveyRefusal, got ${e?.name}: ${e?.message}`);
    assert.equal(e.reason, reason, `${label}: expected reason ${reason}, got ${e.reason} (${e.message})`);
    return e;
  }
  assert.fail(`${label}: expected a ${reason} refusal, but the call returned`);
}

// ── §1 Criteria machine block ────────────────────────────────────────────────

test('DR-2.1: the criteria document carries exactly one canonical machine block', () => {
  const { raw, parsed } = extractMachineBlock(CRITERIA_FIXED);
  assert.equal(raw, canonicalize(parsed), 'the block bytes are byte-identical to their own canonicalization');
  assert.equal(parsed.record_kind, 'pool-entry-criteria');
});

test('DR-2.1: absent, duplicated, and non-canonical machine blocks all refuse', () => {
  refusesWith(R.CRITERIA_BLOCK_ABSENT, () => extractMachineBlock('# no block here\n'), 'absent block');

  const twice = CRITERIA_FIXED + '\n```json\n{"a":1}\n```\n';
  refusesWith(R.CRITERIA_BLOCK_NOT_UNIQUE, () => extractMachineBlock(twice), 'two blocks');

  const pretty = '# x\n\n```json\n' + JSON.stringify(JSON.parse(extractMachineBlock(CRITERIA_FIXED).raw), null, 2) + '\n```\n';
  refusesWith(R.CRITERIA_BLOCK_NOT_CANONICAL, () => extractMachineBlock(pretty), 'pretty-printed block');

  refusesWith(R.CRITERIA_SCHEMA_INVALID, () => extractMachineBlock('```json\n{not json\n```\n'), 'malformed JSON');
});

test('C6-FR-P5: a bare number anywhere in the block is a schema refusal', () => {
  assert.deepEqual(findUnprovenancedNumbers(FIXED_BLOCK), [], 'the fixture carries no unprovenanced number');

  const bad = clone(FIXED_BLOCK);
  bad.cadence_classes[0].obs_interval_seconds = 900;             // bare number, no derivation_ref
  const { valid, problems } = validateCriteriaBlock(bad);
  assert.equal(valid, false);
  assert.ok(problems.some(p => p.includes('derivation_ref')), problems.join('; '));

  // `revision` is the single structural exception.
  assert.deepEqual(findUnprovenancedNumbers({ revision: 3 }), []);
  assert.deepEqual(findUnprovenancedNumbers({ min_pool: 3 }), ['$.min_pool']);
});

test('DR-2.1: the criterion registry is exact — no omission, no extra, no repeat', () => {
  const missing = clone(FIXED_BLOCK);
  missing.criteria = missing.criteria.filter(c => c.criterion_id !== 'C-D-reserve-runnability');
  assert.ok(validateCriteriaBlock(missing).problems.some(p => p.includes('C-D-reserve-runnability')));

  const extra = clone(FIXED_BLOCK);
  extra.criteria.push({ ...extra.criteria[0], criterion_id: 'C-Z-invented' });
  assert.ok(validateCriteriaBlock(extra).problems.some(p => p.includes('C-Z-invented')));

  const admission = clone(FIXED_BLOCK);
  admission.admission.criterion_ids = admission.admission.criterion_ids.slice(1);
  assert.ok(validateCriteriaBlock(admission).problems.some(p => p.includes('admission.criterion_ids')));
});

test('C6-FR-P5: every criterion is mechanical or a citation standard — never a judgment call', () => {
  for (const c of FIXED_BLOCK.criteria) {
    assert.ok(['mechanical', 'citation-standard'].includes(c.kind), `${c.criterion_id} kind`);
  }
  const judgy = clone(FIXED_BLOCK);
  judgy.criteria[0].kind = 'judgment';
  assert.ok(validateCriteriaBlock(judgy).problems.some(p => p.includes('never a judgment call')));
});

test('DR-2.1(k): the nine authored gate standards are exact and each carries a standard_ref', () => {
  assert.deepEqual(Object.keys(FIXED_BLOCK.authored_gate_standards).sort(), [...AUTHORED_GATE_VALUE_KEYS].sort());
  const dropped = clone(FIXED_BLOCK);
  delete dropped.authored_gate_standards.exogenous;
  assert.ok(validateCriteriaBlock(dropped).problems.some(p => p.includes('authored_gate_standards.exogenous')));

  const noRef = clone(FIXED_BLOCK);
  delete noRef.authored_gate_standards.free.standard_ref;
  assert.ok(validateCriteriaBlock(noRef).problems.some(p => p.includes('standard_ref')));
});

test('C6-FR-P4(d): a cadence class cannot be admissible with an empty runnability band', () => {
  const bad = clone(FIXED_BLOCK);
  const empty = bad.cadence_classes.find(c => c.band_margin_days.value < 0);
  assert.ok(empty, 'the fixture includes at least one mechanically inadmissible class');
  empty.admissible = true;
  assert.ok(validateCriteriaBlock(bad).problems.some(p => p.includes('runnability band is empty')));
});

test('DR-2.1: GATE_P_FIXED with an undecided operator slot refuses; PENDING with sentinels is lawful', () => {
  const pendingBlock = parseCriteriaDocument(CRITERIA_PENDING).block;
  assert.equal(pendingBlock.status, CRITERIA_STATUS.PENDING_GATE_P);
  assert.ok(findOperatorSentinels(pendingBlock).length >= 5, 'the pending fixture leaves every operator slot undecided');

  const half = clone(FIXED_BLOCK);
  half.credential_posture = { operator_decision_required: true, decision_id: 'P-4' };
  const { valid, problems } = validateCriteriaBlock(half);
  assert.equal(valid, false);
  assert.ok(problems.some(p => p.includes('GATE_P_FIXED but')), problems.join('; '));

  refusesWith(R.CRITERIA_NOT_GATE_P_FIXED, () => assertGatePFixed(pendingBlock), 'pending criteria');
  assert.doesNotThrow(() => assertGatePFixed(FIXED_BLOCK));
});

test('DR-4.4: the rank registry is closed and the terminal tie-break is not negotiable', () => {
  const unknown = clone(FIXED_BLOCK);
  unknown.rank_function.sort_keys = [{ attribute: 'operator_preference', direction: 'asc' }];
  assert.ok(validateCriteriaBlock(unknown).problems.some(p => p.includes('rank-attribute registry')));
  refusesWith(R.RANK_ATTRIBUTE_UNKNOWN, () => buildComparator(unknown), 'unknown rank attribute');

  const identityKey = clone(FIXED_BLOCK);
  identityKey.rank_function.sort_keys = [{ attribute: 'provider', direction: 'asc' }];
  assert.ok(validateCriteriaBlock(identityKey).problems.some(p => p.includes('TERMINAL tie-break')));

  const tampered = clone(FIXED_BLOCK);
  tampered.rank_function.terminal_tie_break = { attributes: ['product', 'provider'], comparator: 'lexicographic', direction: 'asc' };
  assert.ok(validateCriteriaBlock(tampered).problems.some(p => p.includes('terminal_tie_break')));
  refusesWith(R.RANK_TIE_BREAK_INVALID, () => buildComparator(tampered), 'reordered tie-break');

  assert.deepEqual([...TERMINAL_TIE_BREAK.attributes], ['provider', 'product']);
});

// ── §2 Derivation references ─────────────────────────────────────────────────

test('AC-C8: every derivation_ref in the LANDED criteria resolves into the CI-line worksheet', () => {
  const worksheet = JSON.parse(readFileSync(join(PREREG_DIR, 'criteria-derivations.json'), 'utf8'));
  const { block } = parseCriteriaDocument(readFileSync(join(PREREG_DIR, 'pool-entry-criteria.md'), 'utf8'));
  const { valid, problems, resolved } = validateAgainstWorksheet(block, worksheet);
  assert.equal(valid, true, problems.join('; '));
  assert.ok(resolved.length >= 30, `expected a substantial provenance surface, got ${resolved.length}`);
});

test('AC-C8: an unresolvable derivation_ref is reported, not silently accepted', () => {
  const worksheet = JSON.parse(readFileSync(join(PREREG_DIR, 'criteria-derivations.json'), 'utf8'));
  const bad = clone(FIXED_BLOCK);
  bad.cadence_classes[0].obs_interval_seconds = { value: 60, derivation_ref: 'invented_constant' };
  const { valid, problems } = validateAgainstWorksheet(bad, worksheet);
  assert.equal(valid, false);
  assert.ok(problems.some(p => p.includes('invented_constant')), problems.join('; '));
});

test('AC-C8: an operator-decided bound resolves only to a DECLARED operator decision', () => {
  const worksheet = JSON.parse(readFileSync(join(PREREG_DIR, 'criteria-derivations.json'), 'utf8'));
  assert.equal(validateAgainstWorksheet(FIXED_BLOCK, worksheet).valid, true);

  const orphan = clone(FIXED_BLOCK);
  orphan.pool_bounds.min_pool_selection_relevant = { value: 3, derivation_ref: 'gate_p_decision.P-99' };
  const { valid, problems } = validateAgainstWorksheet(orphan, worksheet);
  assert.equal(valid, false);
  assert.ok(problems.some(p => p.includes('P-99')), problems.join('; '));
});

// ── §3 Gate-P authority ──────────────────────────────────────────────────────

test('I-3: the production survey path recognizes the LANDED Gate-P authority, and still refuses without one', () => {
  // T2.3a materialized a real Gate-P record. The production path now resolves — which is
  // the only mechanical proof that the record, the criteria bytes, and the tooling agree.
  const gatePPath = join(REPO_ROOT, GATE_P_RECORD_REL);
  assert.equal(existsSync(gatePPath), true, 'the Gate-P acceptance record is materialized at this node');

  const auth = requireSurveyAuthority({ repoRoot: REPO_ROOT });
  assert.equal(auth.criteria.status, CRITERIA_STATUS.GATE_P_FIXED);
  assert.equal(auth.criteria_digest, auth.gate_p_record.criteria_digest, 'the accepted digest IS the on-disk criteria digest');
  assert.equal(auth.gate_p_record_id, auth.gate_p_record.record_id);
  assert.ok(auth.burnedList, 'the frozen burned-list authority loads');

  // The refusal is not gone — it is conditional on the record, proven over a bare tree.
  const empty = mkdtempSync(join(tmpdir(), 'survey-no-gatep-'));
  try {
    mkdirSync(join(empty, 'lab/preregistration/cycle-006'), { recursive: true });
    writeFileSync(join(empty, CRITERIA_DOC_REL), readFileSync(join(PREREG_DIR, 'pool-entry-criteria.md')));
    const e = refusesWith(R.GATE_P_RECORD_ABSENT, () => requireSurveyAuthority({ repoRoot: empty }), 'tree with no Gate-P record');
    assert.match(e.message, /no survey, nomination, evaluation, or enumeration act is lawful/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('DR-2.4: a Gate-P record self-verifies, and a tampered one refuses', () => {
  assert.deepEqual(validateGatePRecord(GATE_P), { valid: true, problems: [] });
  assert.equal(GATE_P.record_id, computeGatePRecordId(GATE_P));

  const tampered = { ...GATE_P, credential_posture: 'credentialed' };
  assert.ok(validateGatePRecord(tampered).problems.some(p => p.includes('self-excluded content address')));

  const noAttestation = { ...GATE_P };
  delete noAttestation.no_prior_enumeration_attestation;
  assert.ok(validateGatePRecord(noAttestation).problems.some(p => p.includes('no_prior_enumeration_attestation')));

  const badBounds = { ...GATE_P, pool_bounds: { min_pool_selection_relevant: 9, max_pool: 8, k_max: 8 } };
  assert.ok(validateGatePRecord(badBounds).problems.some(p => p.includes('exceeds')));
});

test('DR-4.1 / AC-A1: Gate-P verification refuses when the criteria bytes are not the accepted bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'survey-gatep-'));
  try {
    const gatePPath = join(dir, 'gate-p-acceptance.json');
    const criteriaPath = join(dir, 'pool-entry-criteria.md');
    writeFileSync(gatePPath, canonicalize(GATE_P) + '\n');
    writeFileSync(criteriaPath, CRITERIA_FIXED);

    const ok = verifyGatePAuthority({ gatePRecordPath: gatePPath, criteriaDocumentPath: criteriaPath });
    assert.equal(ok.criteria_digest, GATE_P.criteria_digest);
    assert.equal(ok.record_id, GATE_P.record_id);

    // One byte of drift in the accepted document is enough.
    writeFileSync(criteriaPath, CRITERIA_FIXED + '\n');
    const e = refusesWith(R.GATE_P_CRITERIA_DIGEST_MISMATCH,
      () => verifyGatePAuthority({ gatePRecordPath: gatePPath, criteriaDocumentPath: criteriaPath }), 'drifted criteria');
    assert.match(e.message, /full re-issue/);

    // A missing record is its own reason, distinct from an invalid one.
    rmSync(gatePPath);
    refusesWith(R.GATE_P_RECORD_ABSENT,
      () => verifyGatePAuthority({ gatePRecordPath: gatePPath, criteriaDocumentPath: criteriaPath }), 'deleted record');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── §4 Admission, identity, duplicates ───────────────────────────────────────

test('DR-4.3: identity is the exact (provider, product) pair; a mismatched key refuses', () => {
  assert.equal(candidateKey({ provider: 'SYNTH-AUTH-A', product: 'synthetic-series-1' }), 'SYNTH-AUTH-A/synthetic-series-1');
  refusesWith(R.CANDIDATE_IDENTITY_INVALID, () => candidateKey({ provider: '', product: 'x' }), 'empty provider');

  const entry = clone(SURVEY.surveyed[0]);
  entry.candidate_key = 'SOMETHING/ELSE';
  refusesWith(R.CANDIDATE_IDENTITY_INVALID, () => deriveAdmission({ entry, burnedList: BURNED }), 'key/identity mismatch');
});

test('DR-4.3: a duplicate candidate identity refuses — never merged, never last-wins', () => {
  const dup = [clone(SURVEY.surveyed[0]), clone(SURVEY.surveyed[0])];
  const e = refusesWith(R.DUPLICATE_CANDIDATE_KEY, () => deriveAdmissions({ surveyed: dup, burnedList: BURNED }), 'duplicate');
  assert.equal(e.detail.candidate_key, 'SYNTH-AUTH-B/synthetic-series-1');
});

test('DR-4.4: admission is the conjunction — one failed criterion rejects, naming it', () => {
  const { admissions } = deriveAdmissions({ surveyed: SURVEY.surveyed, burnedList: BURNED });
  const byKey = Object.fromEntries(admissions.map(a => [a.candidate_key, a]));

  assert.equal(byKey['SYNTH-AUTH-A/synthetic-series-1'].survey_status, 'SURVEYED_ADMITTED');
  assert.equal(byKey['SYNTH-AUTH-E/synthetic-series-4'].survey_status, 'SURVEYED_REJECTED');
  assert.equal(byKey['SYNTH-AUTH-E/synthetic-series-4'].rejection_criterion, 'C-A-count-surface');

  // Every candidate criterion, one at a time, must be able to reject on its own.
  for (const id of CANDIDATE_CRITERION_IDS) {
    if (id === 'C-H-burned-list-disjointness') continue;   // covered by its own frozen cross-check below
    const entry = clone(SURVEY.surveyed[0]);
    entry.criteria_verdicts[id].verdict = 'fail';
    const a = deriveAdmission({ entry, burnedList: BURNED });
    assert.equal(a.survey_status, 'SURVEYED_REJECTED', `${id} must be able to reject`);
    assert.equal(a.rejection_criterion, id);
  }
});

test('C6-FR-N3: a missing verdict, a missing citation, or an unknown criterion refuses', () => {
  const noVerdict = clone(SURVEY.surveyed[0]);
  delete noVerdict.criteria_verdicts['C-B-no-value-contact-route'];
  refusesWith(R.CRITERION_VERDICT_MISSING, () => deriveAdmission({ entry: noVerdict, burnedList: BURNED }), 'missing verdict');

  const noCitation = clone(SURVEY.surveyed[0]);
  delete noCitation.criteria_verdicts['C-C-cadence-history-band'].citation;
  refusesWith(R.CRITERION_VERDICT_MISSING, () => deriveAdmission({ entry: noCitation, burnedList: BURNED }), 'missing citation');

  const unknown = clone(SURVEY.surveyed[0]);
  unknown.criteria_verdicts['C-Z-invented'] = { verdict: 'pass', citation: { document: 'x', section: 'y' } };
  refusesWith(R.CRITERION_VERDICT_MISSING, () => deriveAdmission({ entry: unknown, burnedList: BURNED }), 'unknown criterion');
});

test('C6-FR-P4(k): an authored value without a standard_ref or a citation refuses', () => {
  const noStandard = clone(SURVEY.surveyed[0]);
  delete noStandard.authored_gate_values.exogenous.standard_ref;
  refusesWith(R.AUTHORED_GATE_STANDARD_REF_MISSING, () => deriveAdmission({ entry: noStandard, burnedList: BURNED }), 'no standard_ref');

  const noCitation = clone(SURVEY.surveyed[0]);
  delete noCitation.authored_gate_values.free.citation;
  refusesWith(R.AUTHORED_GATE_STANDARD_REF_MISSING, () => deriveAdmission({ entry: noCitation, burnedList: BURNED }), 'no citation');

  const missing = clone(SURVEY.surveyed[0]);
  delete missing.authored_gate_values.cadence;
  refusesWith(R.AUTHORED_GATE_VALUE_MISSING, () => deriveAdmission({ entry: missing, burnedList: BURNED }), 'missing authored value');
});

test('DR-4.5 §h: a recorded burned-list verdict that disagrees with frozen gate 5 refuses', () => {
  const lying = clone(SURVEY.surveyed.find(e => e.provider === 'SYNTH-AUTH-G'));
  lying.criteria_verdicts['C-H-burned-list-disjointness'].verdict = 'pass';   // but it IS burned
  const e = refusesWith(R.REDERIVATION_DIVERGENCE, () => deriveAdmission({ entry: lying, burnedList: BURNED }), 'lying burned verdict');
  assert.equal(e.detail.frozen_gate_5_burned, true);

  const falseAlarm = clone(SURVEY.surveyed[0]);
  falseAlarm.criteria_verdicts['C-H-burned-list-disjointness'].verdict = 'fail';  // but it is NOT burned
  refusesWith(R.REDERIVATION_DIVERGENCE, () => deriveAdmission({ entry: falseAlarm, burnedList: BURNED }), 'false burned verdict');
});

// ── §5 The N8 probe and its agreement with the frozen invariance layer ───────

test('DR-4.5: the favorable stand-in is byte-equal to the FROZEN invariance stand-in', () => {
  const frozen = JSON.parse(readFileSync(join(REPO_ROOT, 'lab/resolution/fixtures/hypothetical-eligible.json'), 'utf8'));
  const { _label, ...withoutLabel } = frozen;
  assert.ok(_label.includes('HYPOTHETICAL-BRANCH'), 'the frozen fixture is the hypothetical-branch stand-in');
  assert.equal(canonicalize(withoutLabel), canonicalize(FAVORABLE_CENSUS_STANDIN),
    'the admission-time stand-in restatement has drifted from the frozen invariance stand-in');
});

test('C6-FR-N8: the probe truth table — each authored hard gate can force non-relevance', () => {
  const base = {
    authority_published: true, public: true, machine_readable: true, free: true,
    exogeneity_judgment: 'synthetic judgment', exogenous: true,
    mechanical_outcome_declared: true, revision_vintage_documented: true, cadence: 'c3600',
  };
  const id = { provider: 'SYNTH-AUTH-X', product: 'synthetic-series-9' };

  assert.equal(probeSelectionRelevance({ ...id, authored: base }, BURNED).selection_relevant, true);

  const table = [
    ['authority_published', false, 'authority'],
    ['public', false, 'authority'],
    ['machine_readable', false, 'authority'],
    ['free', false, 'authority'],
    ['exogenous', false, 'exogeneity'],
    ['exogeneity_judgment', '', 'exogeneity'],
    ['mechanical_outcome_declared', false, 'mechanical_outcome'],
  ];
  for (const [key, value, expectedGate] of table) {
    const p = probeSelectionRelevance({ ...id, authored: { ...base, [key]: value } }, BURNED);
    assert.equal(p.selection_relevant, false, `${key}=${value} must force non-relevance`);
    assert.ok(p.failed_hard_gates.includes(expectedGate), `${key} should fail the ${expectedGate} gate, got ${p.failed_hard_gates}`);
    assert.equal(p.probe, 'frozen-rule-single-candidate');
  }

  // The gate-6 tie-breaker is NOT a hard gate: it can never force non-relevance.
  assert.equal(probeSelectionRelevance({ ...id, authored: { ...base, revision_vintage_documented: false } }, BURNED).selection_relevant, true);

  // Burned identity forces non-relevance through frozen gate 5, on TRUE identity.
  const burned = probeSelectionRelevance({ provider: 'SYNTH-AUTH-G', product: 'synthetic-series-6', authored: base }, BURNED);
  assert.equal(burned.selection_relevant, false);
  assert.ok(burned.failed_hard_gates.includes('burned'));
});

test('DR-4.5: the admission-time probe and the invariance-time Tier-2 exclusion AGREE on shared fixtures', () => {
  const standIns = {
    eligible: JSON.parse(readFileSync(join(REPO_ROOT, 'lab/resolution/fixtures/hypothetical-eligible.json'), 'utf8')),
    ineligible: JSON.parse(readFileSync(join(REPO_ROOT, 'lab/resolution/fixtures/hypothetical-ineligible.json'), 'utf8')),
  };
  const base = {
    authority_published: true, public: true, machine_readable: true, free: true,
    exogeneity_judgment: 'synthetic judgment', exogenous: true,
    mechanical_outcome_declared: true, revision_vintage_documented: true, cadence: 'c3600',
  };
  const cases = [
    { label: 'all-pass', authored: base },
    { label: 'non-exogenous', authored: { ...base, exogenous: false } },
    { label: 'not-free', authored: { ...base, free: false } },
    { label: 'no-mechanical-outcome', authored: { ...base, mechanical_outcome_declared: false } },
    { label: 'no-judgment-recorded', authored: { ...base, exogeneity_judgment: '   ' } },
    { label: 'vintage-undocumented (tie-breaker only)', authored: { ...base, revision_vintage_documented: false } },
  ];

  for (const { label, authored } of cases) {
    const provider = 'SYNTH-AUTH-X';
    const product = 'synthetic-series-9';

    // Admission time: is the candidate selection-relevant on its authored inputs?
    const probe = probeSelectionRelevance({ provider, product, authored }, BURNED);

    // Invariance time: does Tier-2 prove its "becomes-eligible" branches impossible?
    // A blocking single-unresolved case forces Tier 2 to be consulted.
    const inv = runInvarianceTest({
      resolved: [],
      unresolved: [{ rank: 1, provider, product, class: 'class3', fixed_fields: authored }],
      burnedList: BURNED,
      standIns,
    });
    const forced = inv.tier2_exclusions.some(x => x.provider === provider && x.product === product);

    assert.equal(forced, !probe.selection_relevant,
      `${label}: Tier-2 forced-ineligible (${forced}) must equal NOT selection-relevant (${!probe.selection_relevant})`);
  }
});

// ── §6 Rank ──────────────────────────────────────────────────────────────────

test('DR-4.4: ranks are contiguous 1..N and follow the declared tuple, then identity', () => {
  const { ranked } = rederiveFromSurveyRecord({ surveyRecord: SURVEY, criteria: FIXED_BLOCK, burnedList: BURNED });
  assert.deepEqual(ranked.map(r => r.candidate_key), [
    'SYNTH-AUTH-A/synthetic-series-1',   // count class i, c3600, tie with B broken by provider
    'SYNTH-AUTH-B/synthetic-series-1',
    'SYNTH-AUTH-C/synthetic-series-2',   // count class i, c900 (coarser interval sorts first, desc)
    'SYNTH-AUTH-D/synthetic-series-3',   // count class ii sorts after every class i
  ]);
  assert.deepEqual(ranked.map(r => r.rank), [1, 2, 3, 4]);
  assert.equal(validateRankSequence(ranked).valid, true);
});

test('DR-4.4: the terminal tie-break decides identical attribute tuples, deterministically', () => {
  const attrs = { count_surface_class: 'published-count-field', cadence_obs_interval_seconds: 3600, history_band_margin_days: 5451 };
  const admitted = [
    { candidate_key: 'ZZZ/a', provider: 'ZZZ', product: 'a', rank_attributes: attrs },
    { candidate_key: 'AAA/b', provider: 'AAA', product: 'b', rank_attributes: attrs },
    { candidate_key: 'AAA/a', provider: 'AAA', product: 'a', rank_attributes: attrs },
  ];
  const forward = assignRanks({ admitted, criteria: FIXED_BLOCK });
  const reversed = assignRanks({ admitted: admitted.slice().reverse(), criteria: FIXED_BLOCK });
  assert.deepEqual(forward.map(r => r.candidate_key), ['AAA/a', 'AAA/b', 'ZZZ/a']);
  assert.deepEqual(forward, reversed, 'input order must not affect the assigned ranks');
});

test('DR-4.4: an unresolvable rank attribute refuses rather than defaulting', () => {
  const entry = clone(SURVEY.surveyed[0]);
  entry.authored_gate_values.cadence.value = 'c999999';
  refusesWith(R.RANK_ATTRIBUTE_UNRESOLVABLE, () => deriveRankAttributes({ entry, criteria: FIXED_BLOCK }), 'unknown cadence class');

  const noClass = clone(SURVEY.surveyed[0]);
  noClass.criteria_verdicts['C-A-count-surface'].count_surface_class = 'invented-class';
  refusesWith(R.RANK_ATTRIBUTE_UNRESOLVABLE, () => deriveRankAttributes({ entry: noClass, criteria: FIXED_BLOCK }), 'unknown count class');
});

test('DR-4.4: no per-candidate authored rank exists anywhere in the survey or pool artifacts', () => {
  for (const e of SURVEY.surveyed) {
    assert.equal('rank' in e, false, `${e.candidate_key} carries an authored rank in the survey record`);
    assert.equal('rank' in e.authored_gate_values, false);
  }
  for (const c of POOL.candidates) {
    assert.equal('rank' in c.authored_inputs, false, 'the pool authored_inputs must not carry a rank');
  }
  assert.deepEqual(Object.keys(RANK_ATTRIBUTES).sort(),
    ['cadence_obs_interval_seconds', 'count_surface_class', 'history_band_margin_days']);
});

// ── §7 Re-derivation ─────────────────────────────────────────────────────────

test('AC-A2: the pool re-derives from the survey record alone', () => {
  const r = validatePoolAgainstSurvey({ surveyRecord: SURVEY, poolArtifact: POOL, criteria: FIXED_BLOCK, burnedList: BURNED });
  assert.deepEqual(r, { valid: true, admitted_count: 4, selection_relevant_count: 4 });
});

test('AC-A2: any divergence between the pool and the re-derivation refuses', () => {
  const reordered = clone(POOL);
  [reordered.candidates[0].provider, reordered.candidates[1].provider] = [reordered.candidates[1].provider, reordered.candidates[0].provider];
  refusesWith(R.REDERIVATION_DIVERGENCE,
    () => validatePoolAgainstSurvey({ surveyRecord: SURVEY, poolArtifact: reordered, criteria: FIXED_BLOCK, burnedList: BURNED }), 'reordered pool');

  const padded = clone(POOL);
  padded.candidates.push({ ...clone(POOL.candidates[0]), rank: 5, provider: 'SYNTH-AUTH-Z' });
  refusesWith(R.REDERIVATION_DIVERGENCE,
    () => validatePoolAgainstSurvey({ surveyRecord: SURVEY, poolArtifact: padded, criteria: FIXED_BLOCK, burnedList: BURNED }), 'padded pool');

  const wrongCount = clone(SURVEY);
  wrongCount.admitted_count = 5;
  refusesWith(R.REDERIVATION_DIVERGENCE,
    () => validatePoolAgainstSurvey({ surveyRecord: wrongCount, poolArtifact: POOL, criteria: FIXED_BLOCK, burnedList: BURNED }), 'wrong admitted_count');

  const relabelled = clone(SURVEY);
  relabelled.surveyed.find(e => e.provider === 'SYNTH-AUTH-E').survey_status = 'SURVEYED_ADMITTED';
  refusesWith(R.REDERIVATION_DIVERGENCE,
    () => validatePoolAgainstSurvey({ surveyRecord: relabelled, poolArtifact: POOL, criteria: FIXED_BLOCK, burnedList: BURNED }), 'relabelled rejection');
});

test('C6-FR-N3: an incomplete sweep is not a survey; C6-FR-N1: no measured value may appear', () => {
  const partial = clone(SURVEY);
  partial.source_universe.sweep_completed = false;
  assert.ok(validateSurveyRecordShape(partial).problems.some(p => p.includes('partial sweep')));

  const leaked = clone(SURVEY);
  leaked.surveyed[0].n_observations = 123456;
  const { valid, problems } = validateSurveyRecordShape(leaked);
  assert.equal(valid, false);
  assert.ok(problems.some(p => p.includes('measured value')), problems.join('; '));
});

test('C6-FR-N7: falling below the Gate-P minimum is a typed ending, not an error', () => {
  const short = checkPoolBounds({ selection_relevant_count: 2, pool_bounds: { min_pool_selection_relevant: 3, max_pool: 8 } });
  assert.equal(short.insufficient, true);
  assert.equal(short.within_bounds, false);
  assert.equal(short.terminal_type_if_insufficient, 'no-lawfully-constitutable-pool');

  const over = checkPoolBounds({ selection_relevant_count: 9, pool_bounds: { min_pool_selection_relevant: 3, max_pool: 8 } });
  assert.equal(over.over_max, true);
});

// Gate-P audit residual A-3. Before the correction, every unusable bounds object made both
// comparisons vacuously false and returned `within_bounds: true` — the most permissive
// possible answer for the least usable possible input. The three lawful verdicts below are
// the control: they prove the guard did not simply turn the function off.
test('A-3: checkPoolBounds fails CLOSED on unresolved bounds, and still returns the three lawful verdicts', () => {
  const GOOD = { min_pool_selection_relevant: 3, max_pool: 6 };

  // (a) unusable bounds — every one of these previously returned within_bounds: true
  const unusable = [
    ['missing bounds', undefined],
    ['null bounds', null],
    ['operator sentinel bounds', { operator_decision_required: true, decision_id: 'P-2' }],
    ['derived-value envelope bounds (the criteria machine-block shape)', {
      min_pool_selection_relevant: { value: 3, derivation_ref: 'gate_p_decision.P-2' },
      max_pool: { value: 6, derivation_ref: 'gate_p_decision.P-2' },
    }],
    ['string bounds', { min_pool_selection_relevant: '3', max_pool: '6' }],
    ['non-integer bounds', { min_pool_selection_relevant: 2.5, max_pool: 6 }],
    ['zero minimum', { min_pool_selection_relevant: 0, max_pool: 6 }],
    ['half-decided bounds', { min_pool_selection_relevant: 3 }],
    ['array bounds', []],
    ['invalidly ordered bounds', { min_pool_selection_relevant: 7, max_pool: 6 }],
  ];
  for (const [label, pool_bounds] of unusable) {
    refusesWith(R.POOL_BOUNDS_UNRESOLVED, () => checkPoolBounds({ selection_relevant_count: 4, pool_bounds }), label);
  }

  // An unusable COUNT is the same fail-open shape: NaN < 3 and NaN > 6 are both false.
  for (const bad of [Number.NaN, undefined, null, '4', 4.5, -1]) {
    refusesWith(R.POOL_BOUNDS_UNRESOLVED,
      () => checkPoolBounds({ selection_relevant_count: bad, pool_bounds: GOOD }), `count ${String(bad)}`);
  }

  // (b) the three lawful verdicts, over the REAL Gate-P bounds {3, 6}
  const below = checkPoolBounds({ selection_relevant_count: 2, pool_bounds: GOOD });
  assert.deepEqual(
    { within_bounds: below.within_bounds, insufficient: below.insufficient, over_max: below.over_max },
    { within_bounds: false, insufficient: true, over_max: false });
  assert.equal(below.terminal_type_if_insufficient, 'no-lawfully-constitutable-pool');

  for (const n of [3, 4, 6]) {
    const inside = checkPoolBounds({ selection_relevant_count: n, pool_bounds: GOOD });
    assert.deepEqual(
      { within_bounds: inside.within_bounds, insufficient: inside.insufficient, over_max: inside.over_max },
      { within_bounds: true, insufficient: false, over_max: false }, `count ${n} is within {3, 6}`);
    assert.equal(inside.min_pool_selection_relevant, 3);
    assert.equal(inside.max_pool, 6);
  }

  const above = checkPoolBounds({ selection_relevant_count: 7, pool_bounds: GOOD });
  assert.deepEqual(
    { within_bounds: above.within_bounds, insufficient: above.insufficient, over_max: above.over_max },
    { within_bounds: false, insufficient: false, over_max: true });

  // The load-bearing property, stated directly: no unusable input reports within_bounds.
  for (const [, pool_bounds] of unusable) {
    let verdict = null;
    try { verdict = checkPoolBounds({ selection_relevant_count: 4, pool_bounds }); } catch { /* refused */ }
    assert.equal(verdict, null, 'an unusable bounds object must never yield a verdict at all');
  }
});

// ── §8 Deterministic serialization and the write fence ───────────────────────

test('NFR-DET: survey artifacts serialize deterministically, independent of key order', () => {
  const a = { z: 1, a: { d: [3, 2, 1], b: 'x' } };
  const b = { a: { b: 'x', d: [3, 2, 1] }, z: 1 };
  assert.equal(serializeSurveyArtifact(a), serializeSurveyArtifact(b));
  assert.equal(serializeSurveyArtifact(a), '{"a":{"b":"x","d":[3,2,1]},"z":1}\n');
  assert.equal(serializeSurveyArtifact(a), serializeSurveyArtifact(a), 'repeat runs are byte-identical');

  // Every landed fixture artifact is already canonical + LF-terminated.
  for (const name of ['synthetic-gate-p-acceptance.json', 'synthetic-survey-record.json', 'synthetic-successor-pool.json', 'synthetic-burned-list.json']) {
    const text = readFix(name);
    assert.equal(text, serializeSurveyArtifact(JSON.parse(text)), `${name} is not canonical on disk`);
  }
});

test('DR-4.7: a write outside the survey write root refuses at run time, not only at lint time', () => {
  refusesWith(R.PRODUCTION_SURVEY_UNAUTHORIZED,
    () => writeSurveyArtifact(join(REPO_ROOT, 'lab/evidence/cycle-006/gate-p-acceptance.json'), { x: 1 }), 'evidence path');
  refusesWith(R.PRODUCTION_SURVEY_UNAUTHORIZED,
    () => writeSurveyArtifact(join(REPO_ROOT, 'lab/census/burned-list.json'), { x: 1 }), 'frozen authority path');
});

// §7.1 correction: the run-time guard is a resolved-containment proof, not a substring
// test. Each case below is a real call through the exported `writeSurveyArtifact` entry
// point — the runtime fence itself, not a static lint over source literals.
test('DR-4.7 correction: the run-time write-root guard proves resolved containment, not a substring match', () => {
  // A genuine descendant of the write root is written, and only that file.
  const scratchRel = 'lab/preregistration/cycle-006/.write-boundary-remediation-scratch.json';
  const scratchAbs = join(REPO_ROOT, scratchRel);
  try {
    writeSurveyArtifact(scratchAbs, { probe: true });
    assert.equal(existsSync(scratchAbs), true, 'a genuine descendant of the write root is written');
    assert.equal(readFileSync(scratchAbs, 'utf8'), serializeSurveyArtifact({ probe: true }));
  } finally {
    rmSync(scratchAbs, { force: true });
  }

  // POSIX-style `..` traversal toward the trials ledger refuses.
  refusesWith(R.PRODUCTION_SURVEY_UNAUTHORIZED,
    () => writeSurveyArtifact('lab/preregistration/cycle-006/../../ledgers/trials-ledger.jsonl', { x: 1 }),
    'traversal toward the trials ledger');

  // Traversal toward frozen Cycle-005 evidence refuses.
  refusesWith(R.PRODUCTION_SURVEY_UNAUTHORIZED,
    () => writeSurveyArtifact('lab/preregistration/cycle-006/../../evidence/cycle-005/gate-a-acceptance.json', { x: 1 }),
    'traversal toward frozen Cycle-005 evidence');

  // A sibling directory that merely shares the "cycle-006" text prefix refuses — this is
  // exactly what a substring test (`.includes(SURVEY_WRITE_ROOT)`) would get wrong without
  // the trailing slash, and what a segment-aware containment check gets right regardless.
  refusesWith(R.PRODUCTION_SURVEY_UNAUTHORIZED,
    () => writeSurveyArtifact('lab/preregistration/cycle-006-other/x.json', { x: 1 }),
    'sibling-prefix collision');

  // A Windows-style backslash traversal refuses even on a non-Windows test host: POSIX
  // does not treat "\" as a separator, so only an explicit literal-segment check (not
  // OS path resolution alone) is guaranteed to catch it on every host.
  refusesWith(R.PRODUCTION_SURVEY_UNAUTHORIZED,
    () => writeSurveyArtifact('lab\\preregistration\\cycle-006\\..\\..\\ledgers\\trials-ledger.jsonl', { x: 1 }),
    'Windows-style backslash traversal');

  // An absolute destination entirely outside the repository refuses.
  const outsideDir = mkdtempSync(join(tmpdir(), 'survey-write-boundary-'));
  try {
    refusesWith(R.PRODUCTION_SURVEY_UNAUTHORIZED,
      () => writeSurveyArtifact(join(outsideDir, 'x.json'), { x: 1 }),
      'absolute destination outside the repository');
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// Gate-P audit residual B-2: `writeSurveyArtifact` writes once its two guard layers
// admit, and a pure in-root NTFS alternate-data-stream suffix (no `..` segment) passed
// both the traversal check and the strict-descendant containment check before this
// remediation. Every case below is a real call through the exported entry point, and the
// refusal must be deterministic on Windows and non-Windows hosts alike.
test('B-2: an NTFS alternate-data-stream path segment refuses before any write is attempted', () => {
  const before = readdirSync(PREREG_DIR).sort();

  refusesWith(R.PRODUCTION_SURVEY_UNAUTHORIZED,
    () => writeSurveyArtifact(join(REPO_ROOT, 'lab/preregistration/cycle-006/artifact.json:hidden-stream'), { x: 1 }),
    'ADS suffix on an absolute in-root path');

  refusesWith(R.PRODUCTION_SURVEY_UNAUTHORIZED,
    () => writeSurveyArtifact('lab/preregistration/cycle-006/artifact.json::$DATA', { x: 1 }),
    'the reserved ::$DATA stream-type suffix');

  refusesWith(R.PRODUCTION_SURVEY_UNAUTHORIZED,
    () => writeSurveyArtifact('lab/preregistration/cycle-006/directory/name:stream', { x: 1 }),
    'a nested descendant with an ADS suffix');

  // A Windows-form backslash descendant refuses regardless of the test host's own
  // platform: on win32 this resolves inside the root and trips the new ADS check; on a
  // POSIX host the unsplit backslash string fails strict-descendant containment instead.
  // Either way the same typed reason is raised — the check is not a process.platform
  // branch.
  refusesWith(R.PRODUCTION_SURVEY_UNAUTHORIZED,
    () => writeSurveyArtifact('lab\\preregistration\\cycle-006\\artifact.json:hidden', { x: 1 }),
    'a Windows-form backslash descendant with an ADS suffix');

  // No base file, stream, temporary file, or directory residue from any refused attempt.
  assert.equal(existsSync(join(REPO_ROOT, 'lab/preregistration/cycle-006/artifact.json')), false,
    'the ADS base-file name must not exist after refusal');
  assert.equal(existsSync(join(REPO_ROOT, 'lab/preregistration/cycle-006/directory')), false,
    'no directory residue from the nested ADS attempt');
  assert.deepEqual(readdirSync(PREREG_DIR).sort(), before, 'the write root holds exactly its pre-test contents');

  // The drive-letter separator of an absolute Windows root is lawful, not an ADS suffix:
  // an ordinary authorized descendant still writes successfully through the same guard.
  const scratchRel = 'lab/preregistration/cycle-006/.b2-remediation-scratch.json';
  const scratchAbs = join(REPO_ROOT, scratchRel);
  try {
    writeSurveyArtifact(scratchAbs, { probe: true });
    assert.equal(existsSync(scratchAbs), true, 'an ordinary authorized descendant path still writes successfully');
    assert.equal(readFileSync(scratchAbs, 'utf8'), serializeSurveyArtifact({ probe: true }));
  } finally {
    rmSync(scratchAbs, { force: true });
  }
  assert.deepEqual(readdirSync(PREREG_DIR).sort(), before, 'the write root returns to exactly its pre-test contents');
});

// Gate-P audit residual C-2 (report 19 §10.3, EC-elevated over report 17 §9.2's original
// recommendation): a Windows reserved-device basename in any descendant path segment must
// refuse before any write is attempted, closing the device-name class completely rather
// than special-casing only NUL. Every case below is a real call through the exported
// entry point. None performs a live write to an actual reserved device — the guard
// refuses before any filesystem call is reachable, so there is nothing to write; the
// historical fail-open would only be reproducible outside this write root (report 19
// §5.3's isolated-scratch-directory technique for B-2 applies equally here and is why it
// is intentionally not repeated inside this suite).
test('C-2: a Windows reserved-device basename in any descendant path segment refuses before any write is attempted', () => {
  const before = readdirSync(PREREG_DIR).sort();

  const refusedCases = [
    ['CON', 'the CON device, bare'],
    ['PRN', 'the PRN device, bare'],
    ['AUX', 'the AUX device, bare'],
    ['NUL', 'the NUL device, bare'],
    ['CLOCK$', 'the CLOCK$ device, bare'],
    ['CONIN$', 'the CONIN$ device, bare'],
    ['CONOUT$', 'the CONOUT$ device, bare'],
    ['COM1', 'the COM1 device, bare (boundary low)'],
    ['COM9', 'the COM9 device, bare (boundary high)'],
    ['LPT1', 'the LPT1 device, bare (boundary low)'],
    ['LPT9', 'the LPT9 device, bare (boundary high)'],
    ['NUL.json', 'a reserved basename with an ordinary extension'],
    ['COM1.log', 'a reserved COM basename with an ordinary extension'],
    ['LPT9.txt', 'a reserved LPT basename with an ordinary extension'],
    ['NUL' + '.', 'a reserved basename with a Windows-ignored trailing period'],
    ['NUL' + ' ', 'a reserved basename with a Windows-ignored trailing space'],
    ['nul.json', 'a reserved basename in lower case'],
    ['Con.txt', 'a reserved basename in mixed case'],
    ['com1', 'a reserved COM basename in lower case, no extension'],
    ['directory/AUX/file.json', 'a reserved basename in a non-final "/"-separated segment'],
    ['directory\\PRN\\file.json', 'a reserved basename in a non-final "\\"-separated segment'],
    ['COM¹', 'the COM superscript-1 device alias'],
    ['LPT²', 'the LPT superscript-2 device alias'],
  ];

  for (const [segment, label] of refusedCases) {
    const e = refusesWith(R.PRODUCTION_SURVEY_UNAUTHORIZED,
      () => writeSurveyArtifact(`lab/preregistration/cycle-006/${segment}`, { x: 1 }),
      label);
    assert.equal(e.detail.reason, 'Windows reserved device basename in a descendant path segment',
      `${label}: detail.reason identifies the reserved-device class`);
  }

  assert.deepEqual(readdirSync(PREREG_DIR).sort(), before,
    'the write root holds exactly its pre-test contents after every refused reserved-device attempt');

  // Lawful near-misses: a basename that merely CONTAINS a reserved token as part of a
  // longer name is not a match, and an ordinary authorized descendant write through the
  // same guard still succeeds and is cleaned up.
  for (const name of ['null-data.json', 'console.json', 'auxiliary.json', 'com10.json', 'lpt10.json']) {
    const scratchAbs = join(REPO_ROOT, `lab/preregistration/cycle-006/${name}`);
    try {
      writeSurveyArtifact(scratchAbs, { probe: true });
      assert.equal(existsSync(scratchAbs), true, `${name}: a lawful near-miss basename still writes successfully`);
      assert.equal(readFileSync(scratchAbs, 'utf8'), serializeSurveyArtifact({ probe: true }));
    } finally {
      rmSync(scratchAbs, { force: true });
    }
  }
  assert.deepEqual(readdirSync(PREREG_DIR).sort(), before,
    'the write root returns to exactly its pre-test contents after the lawful near-miss writes');
});

test('NFR-CEIL: a forbidden claim-ceiling key can never be written by the survey lane', () => {
  const target = join(REPO_ROOT, 'lab/preregistration/cycle-006/.nfr-ceil-guard-scratch.json');
  assert.throws(() => writeSurveyArtifact(target, { certified: true }), /forbidden claim-ceiling key/);
  assert.equal(existsSync(target), false, 'nothing is written when the guard fires');
});

// ── §9 The landed T2.1 and T2.2 documents ────────────────────────────────────

test('T2.3a: the landed criteria document is GATE_P_FIXED at revision 2 with ZERO sentinels', () => {
  const text = readFileSync(join(PREREG_DIR, 'pool-entry-criteria.md'), 'utf8');
  const { block, status, gate_p_fixed } = parseCriteriaDocument(text);
  assert.equal(status, CRITERIA_STATUS.GATE_P_FIXED);
  assert.equal(gate_p_fixed, true);
  assert.equal(block.revision, 2, 'the revision-2 re-issue bumped the revision (criteria §16.1)');
  assert.deepEqual(findOperatorSentinels(block), [], 'no operator-reserved slot may remain undecided at GATE_P_FIXED');
  assert.deepEqual(findUnprovenancedNumbers(block), [], 'revision is the ONLY lawful bare number (C6-FR-P5)');
  assert.doesNotThrow(() => assertGatePFixed(block));

  // Every operator-reserved slot still carries its framing AND now carries the decision.
  const ids = new Set(block.operator_decisions.map(d => d.decision_id));
  for (const id of ['P-2', 'P-2b', 'P-3', 'P-4', 'P-5', 'P-6', 'P-7', 'P-8', 'P-9', 'P-10', 'P-11']) {
    assert.ok(ids.has(id), `decision ${id} is preserved in the packet`);
  }
  for (const d of block.operator_decisions) {
    assert.ok(d.lawful_options.length >= 2, `${d.decision_id} must still name at least two lawful options`);
    assert.ok(d.consequence.length > 40, `${d.decision_id} must still state a real downstream consequence`);
    assert.ok(typeof d.decided === 'string' && d.decided.length > 10, `${d.decision_id} must record what EC decided`);
    assert.equal(d.decided_at, 'gate-p');
  }

  // The five named gaming vectors each carry a closure.
  assert.equal(block.gaming_vectors.length, 5);
  for (const g of block.gaming_vectors) assert.ok(g.closed_by.length > 20, `${g.vector} needs a stated closure`);
});

test('T2.3a: the fixed P-2/P-2b/P-3/P-4 values are exactly the accepted ones, each provenanced', () => {
  const { block } = parseCriteriaDocument(readFileSync(join(PREREG_DIR, 'pool-entry-criteria.md'), 'utf8'));

  const envelopes = {
    'pool_bounds.min_pool_selection_relevant': [block.pool_bounds.min_pool_selection_relevant, 3, 'gate_p_decision.P-2'],
    'pool_bounds.max_pool': [block.pool_bounds.max_pool, 6, 'gate_p_decision.P-2'],
    'fr_d2_bounds.k_max': [block.fr_d2_bounds.k_max, 6, 'gate_p_decision.P-2b'],
    'fr_d2_bounds.probe_budget': [block.fr_d2_bounds.probe_budget, 20, 'gate_p_decision.P-2b'],
    'fr_d2_bounds.n_ceiling': [block.fr_d2_bounds.n_ceiling, 24120603015, 'gate_p_decision.P-2b'],
    'fr_d2_bounds.corroboration_budget': [block.fr_d2_bounds.corroboration_budget, 1000, 'gate_p_decision.P-2b'],
    'fr_d2_bounds.wall_clock_target_seconds': [block.fr_d2_bounds.wall_clock_target_seconds, 60, 'gate_p_decision.P-2b'],
  };
  for (const [path, [envelope, value, ref]] of Object.entries(envelopes)) {
    assert.deepEqual(envelope, { value, derivation_ref: ref }, `${path} must be the accepted provenanced value`);
  }
  assert.equal(block.fr_d2_bounds.corroboration_budget_unit, 'milliseconds', 'the budget unit is recorded, not implied');
  assert.equal(block.fr_d2_bounds.probe_budget.value, 2 + 3 * block.fr_d2_bounds.k_max.value, 'probe_budget = 2 + 3k, exactly');
  assert.equal(block.fr_d2_bounds.k_max.value, block.pool_bounds.max_pool.value, 'k_max = max_pool keeps a full-pool unresolved state evaluable');

  // P-3: the accepted tuple, with identity NEVER declared in it.
  assert.deepEqual(block.rank_function.sort_keys, [
    { attribute: 'count_surface_class', direction: 'asc' },
    { attribute: 'cadence_obs_interval_seconds', direction: 'desc' },
    { attribute: 'history_band_margin_days', direction: 'desc' },
  ]);
  assert.deepEqual(block.rank_function.terminal_tie_break, { ...TERMINAL_TIE_BREAK, attributes: [...TERMINAL_TIE_BREAK.attributes] });
  assert.doesNotThrow(() => buildComparator(block), 'the accepted rank function builds a comparator');

  // P-4.
  assert.equal(block.credential_posture.posture, 'uncredentialed-only');
  assert.equal(block.credential_posture.decision_id, 'P-4');

  // P-9: the admissible set is exactly the non-empty-band classes — no further restriction.
  const admissible = block.cadence_classes.filter(c => c.admissible).map(c => c.cadence_class);
  const inadmissible = block.cadence_classes.filter(c => !c.admissible).map(c => c.cadence_class);
  assert.deepEqual(admissible, ['c900', 'c3600', 'c21600', 'c86400']);
  assert.deepEqual(inadmissible, ['c60', 'c300']);
  for (const c of block.cadence_classes) {
    assert.equal(c.admissible, c.band_margin_days.value > 0, `${c.cadence_class}: admissibility IS the non-empty band`);
  }
});

test('T2.3a: the P-5 source universe and seventeen-step procedure are digest-fixed, not prose-only', () => {
  const { block } = parseCriteriaDocument(readFileSync(join(PREREG_DIR, 'pool-entry-criteria.md'), 'utf8'));

  const su = block.source_universe;
  assert.equal(su.declared_ref, 'cycle-006-source-universe-2');
  assert.equal(su.growth_policy, 'never grown mid-survey');
  assert.equal(su.entries.length, 8, 'the universe is exhaustively enumerated');

  // Exactly the four approved keys — never `provider` / `product`. Revision 2 adds
  // `enumeration_index_url`; the other three are byte-preserved from revision 1.
  for (const e of su.entries) {
    assert.deepEqual(Object.keys(e).sort(), ['controlling_authority', 'declared_root', 'enumeration_index_url', 'portal_id']);
    assert.ok(e.portal_id.length > 0 && e.declared_root.length > 0 && e.controlling_authority.length > 0);
    assert.ok(e.enumeration_index_url.length > 0);
  }
  const portals = su.entries.map(e => e.portal_id);
  assert.deepEqual(portals, [...portals].sort(), 'the declared order IS lexicographic portal_id order');
  assert.equal(new Set(portals).size, 8, 'portal ids are unique');

  // Eight portals, six controlling authorities — the arithmetic behind max_pool = 6.
  const authorities = new Set(su.entries.map(e => e.controlling_authority));
  assert.equal(authorities.size, 6);
  assert.equal(block.pool_bounds.max_pool.value, authorities.size,
    'max_pool is the mechanically reachable ceiling of the declared universe under the first independence limb');

  // Same-authority precedence follows from the declared order alone.
  const firstIndex = a => portals.indexOf(su.entries.find(e => e.controlling_authority === a).portal_id);
  assert.ok(portals.indexOf('noaa-coops-web-services') < portals.indexOf('noaa-ndbc-web-data-guide'));
  assert.ok(portals.indexOf('usgs-earthquake-catalog-api') < portals.indexOf('usgs-water-data-apis'));
  assert.equal(firstIndex('NASA'), 0);

  const sp = block.survey_procedure;
  assert.equal(sp.declared_ref, 'cycle-006-survey-procedure-2');
  assert.equal(sp.steps.length, 17, 'all seventeen approved steps are digest-fixed in the machine block');
  for (const s of sp.steps) assert.equal(typeof s, 'string');
  assert.ok(sp.traversal.length > 20 && sp.stopping_rule.length > 20, 'the fixture convention fields are preserved');

  // Items 12 and 14 route to EXISTING paths; no new terminal type is invented.
  assert.match(sp.record_obligations.step_12_route, /pre-freeze-halt/);
  assert.match(sp.record_obligations.step_12_route, /no new terminal type/);
  assert.match(sp.record_obligations.step_14_route, /survey-contamination/);
  assert.match(sp.record_obligations.step_14_route, /no new terminal type/);
  assert.match(sp.record_obligations.index_url_citation, /official product\/service index URL/);

  // Those two terminal/event types must already be declared by the frozen evidence layer.
  assert.ok(C006_TERMINAL_TYPES.includes('pre-freeze-halt'), 'pre-freeze-halt is an EXISTING typed terminal disposition');
  assert.ok(C006_HALT_CLASSES.includes('survey-contamination'), 'survey-contamination is an EXISTING halt class');

  // The seventeen steps carry ordinality by ARRAY POSITION — never as a bare integer field.
  assert.deepEqual(findUnprovenancedNumbers(sp), [], 'no numeric step id may appear (C6-FR-P5 bare-number trap)');
});

test('T2.2: the successor preregistration adopts by reference and supersedes exactly two things', () => {
  const text = readFileSync(join(PREREG_DIR, 'preregistration.md'), 'utf8');

  // Adoption by pinned digest (DR-2.2 i–ii).
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'lab/freeze/freeze-manifest.json'), 'utf8'));
  const pinned = manifest.assets.find(a => a.path === 'lab/preregistration/preregistration.md').sha256;
  const companion = readFileSync(join(REPO_ROOT, 'lab/freeze/freeze-manifest.sha256'), 'utf8').trim();
  assert.ok(text.includes(pinned), 'the frozen preregistration is adopted at its pinned digest');
  assert.ok(text.includes(companion), 'the historical freeze companion digest is cited');

  const trialsDigest = sha256LFNormalized(readFileSync(join(REPO_ROOT, 'lab/ledgers/trials-ledger.jsonl')));
  assert.ok(text.includes(trialsDigest.replace(/^sha256:/, '')), 'the trials-ledger digest is cited');
  assert.ok(text.includes('c005-e1-primary-001'), 'the adopted trial is named by trial_id');
  assert.match(text, /\*\*1, program-wide\*\*|n_trials.*1/, 'n_trials = 1 program-wide is stated');
  assert.match(text, /never opened for write/, 'the no-write trials discipline is stated');

  // Exactly two supersession clauses, and they are labelled as exhaustive.
  const clauses = [...text.matchAll(/^\*\*S-\d+ —/gm)];
  assert.equal(clauses.length, 2, `expected exactly two supersession clauses, found ${clauses.length}`);
  assert.match(text, /exhaustive, exactly two/);

  // Restrict-only posture, the runnability condition, and the FR-D2 bounds are pre-registered.
  assert.match(text, /restrict-only/);
  assert.match(text, /runnability validity condition/i);
  for (const k of ['k_max', 'probe_budget', 'n_ceiling', 'corroboration_budget']) {
    assert.ok(text.includes(k), `${k} must be pre-registered`);
  }

  // Post-Gate-P the companion digests are ACCEPTED identity, and they are the bytes on disk.
  assert.match(text, /ACCEPTED IDENTITY/);
  assert.ok(!text.includes('PROVISIONAL IMPLEMENTATION IDENTITY'), 'the provisional framing is superseded, not left standing alongside');
  const criteriaNow = criteriaDigest(readFileSync(join(PREREG_DIR, 'pool-entry-criteria.md')));
  const worksheetNow = sha256LFNormalized(readFileSync(join(PREREG_DIR, 'criteria-derivations.json')));
  assert.ok(text.includes(criteriaNow), 'the accepted criteria digest matches the bytes on disk');
  assert.ok(text.includes(worksheetNow), 'the accepted worksheet digest matches the bytes on disk');

  // §7 carries the fixed FR-D2 bound VALUES, not the operator-reserved placeholders.
  assert.ok(!text.includes('operator-reserved at Gate P'), '§7 no longer defers the bounds to Gate P');
  for (const v of ['24 120 603 015', '1000 ms']) assert.ok(text.includes(v), `§7 must state ${v}`);
  assert.match(text, /operator-fixed policy value, not a frozen empirical constant/, 'the 60s target is labelled policy, not empirical');

  // Scope and ceiling.
  assert.match(text, /M4│M5 hard stop|M4-scope only/);
  assert.match(text, /ConstructAdmissionBundle producer artifact/);
  assert.match(text, /none-eligible|none eligible/i);
});

test('C6-FR-P2: the successor preregistration restates no frozen threshold in normative form', () => {
  const text = readFileSync(join(PREREG_DIR, 'preregistration.md'), 'utf8');
  // The frozen numeric design must be referenced, never re-stated as a value here.
  for (const restated of ['W ≥ 90', 'W>=90', 'n_min = 59', 'n_min=59', 'H = 30', 'pinball']) {
    assert.ok(!text.includes(restated), `the successor preregistration restates a frozen design value: "${restated}"`);
  }
  assert.match(text, /adopted whole, by reference|adoption of the frozen experimental design/i);
});

// ── §10 Outcome-blindness ────────────────────────────────────────────────────

// The pre-Gate-P standard was "zero provider tokens exist anywhere". Gate P superseded it:
// the accepted source universe LAWFULLY names six publishing authorities and their
// documentation roots, because C6-FR-P4(e) requires the universe to be declared and
// digest-fixed BEFORE any sweep. The surviving standard is narrower and stronger — a
// declared portal is a place, not a candidate.
test('C6-FR-N4 / I-1: no provider-product has been nominated, enumerated, evaluated, scored, or ranked', () => {
  const criteria = readFileSync(join(PREREG_DIR, 'pool-entry-criteria.md'), 'utf8');
  const prereg = readFileSync(join(PREREG_DIR, 'preregistration.md'), 'utf8');
  const { block } = parseCriteriaDocument(criteria);
  const blockText = canonicalize(block);

  // (a) No candidate-bearing, survey, pool, or freeze artifact exists at all — at either
  //     revision. The revision-2 contamination ledger is the ONE exception, and it is
  //     governed by the PHASE guard rather than by absence: the revision-2 survey started
  //     and halted mid-sweep, so the ledger exists at exactly 0 bytes. It carries no
  //     candidate — an empty ledger is the absence of a contamination EVENT, not evidence
  //     of any provider-product having been nominated, evaluated, scored, or ranked.
  for (const rel of ['survey-record.json', 'successor-pool.json', 'survey-contamination.jsonl',
    'survey-record-r2.json', 'successor-pool-r2.json']) {
    assert.equal(existsSync(join(PREREG_DIR, rel)), false, `${rel} must not exist — no survey has completed`);
  }
  const liveLedger = readContaminationLedgerState({ repoRoot: REPO_ROOT });
  assert.deepEqual([liveLedger.exists, liveLedger.size, liveLedger.typed_event_count, liveLedger.untyped_lines],
    [true, 0, 0, 0], 'the revision-2 ledger exists at exactly 0 bytes and carries no event of any kind');
  assert.deepEqual(
    validateContaminationLedgerPhase({ phase: SURVEY_PHASES.SURVEY_STARTED, ledger: liveLedger }),
    { valid: true, problems: [] },
    'the repository is in the survey-started phase and the 0-byte ledger is the lawful state for it',
  );
  assert.equal(existsSync(join(REPO_ROOT, 'lab/freeze/cycle-006')), false, 'no successor freeze exists');

  // (b) The ONLY Cycle-006 evidence artifacts are the two Gate-P acceptance records and
  //     the pre-freeze terminal record, and NONE of them carries a candidate, a product
  //     family, or a ranking. The terminal record is held to the same standard as the
  //     authority records — halting mid-sweep must not become a way to smuggle a
  //     candidate into evidence.
  assert.deepEqual(readdirSync(join(REPO_ROOT, 'lab/evidence/cycle-006')).sort(),
    ['gate-p-acceptance-2.json', 'gate-p-acceptance.json', 'terminal-disposition.json']);
  const recordText = readFileSync(join(REPO_ROOT, GATE_P_RECORD_REL), 'utf8');
  const recordText2 = readFileSync(join(REPO_ROOT, GATE_P_RECORD_REL_R2), 'utf8');
  const terminalText = readFileSync(join(REPO_ROOT, 'lab/evidence/cycle-006/terminal-disposition.json'), 'utf8');
  for (const key of ['candidates', 'candidate_key', 'nominated', 'shortlist', 'surveyed', 'admitted', 'rejected', 'rank', 'score']) {
    assert.ok(!recordText.includes(`"${key}"`), `the Gate-P record carries a "${key}" key`);
    assert.ok(!recordText2.includes(`"${key}"`), `the re-issue record carries a "${key}" key`);
    assert.ok(!terminalText.includes(`"${key}"`), `the terminal record carries a "${key}" key`);
    assert.ok(!blockText.includes(`"${key}"`), `the criteria machine block carries a "${key}" key`);
  }

  // (c) No provider-PRODUCT identity anywhere: the identity key form is <provider>/<product>,
  //     and neither field is ever populated in a landed artifact.
  for (const [label, text] of [['criteria block', blockText], ['Gate-P record', recordText], ['re-issue record', recordText2]]) {
    assert.ok(!/"provider"\s*:\s*"[^"]/.test(text), `${label} names a provider`);
    assert.ok(!/"product"\s*:\s*"[^"]/.test(text), `${label} names a product`);
  }

  // (d) The universe declares PLACES under the three approved keys — never identities.
  //     Every authority named appears solely as a controlling_authority of a declared portal.
  const authorities = new Set(block.source_universe.entries.map(e => e.controlling_authority));
  assert.deepEqual([...authorities].sort(), ['NASA', 'NOAA', 'USACE', 'USBR', 'USDA NRCS', 'USGS']);
  for (const e of block.source_universe.entries) {
    assert.deepEqual(Object.keys(e).sort(), ['controlling_authority', 'declared_root', 'enumeration_index_url', 'portal_id']);
  }

  // (e) No admission, rejection, ranking, or score has been recorded for anything.
  assert.equal('surveyed' in block, false);
  assert.deepEqual(block.admission.statuses, ['SURVEYED_ADMITTED', 'SURVEYED_REJECTED'],
    'the survey statuses appear only as a declared vocabulary, never as an applied verdict');

  // (f) The synthetic fixture identities never leak into a landed scientific artifact.
  for (const synthetic of ['SYNTH-AUTH-', 'synthetic-series-']) {
    assert.ok(!criteria.includes(synthetic), 'fixture identities must not appear in the criteria document');
    assert.ok(!prereg.includes(synthetic), 'fixture identities must not appear in the preregistration');
    assert.ok(!recordText.includes(synthetic), 'fixture identities must not appear in the Gate-P record');
    assert.ok(!recordText2.includes(synthetic), 'fixture identities must not appear in the re-issue record');
  }
});

// ── §11 Historical preservation, unchanged by LU-2A ──────────────────────────

test('I-13 / I-12: the historical freeze, the Cycle-005 chain, and both ledgers are untouched', () => {
  const { block, mismatches } = verifyHistoricalPreservation({ repoRoot: REPO_ROOT });
  assert.deepEqual(mismatches, []);
  assert.equal(block.freeze_43.asset_count, 43);
  assert.equal(block.freeze_43.all_match, true);
  assert.equal(block.freeze_43.companion_match, true);
  assert.equal(block.chain_13.links_verified, 13);
  assert.equal(block.chain_13.all_byte_identical, true);
  assert.equal(block.superseded_gate_a_record_intact, true);

  assert.equal(statSync(join(REPO_ROOT, 'lab/ledgers/burn-ledger.jsonl')).size, 0, 'the burn ledger is 0 bytes');
  assert.equal(
    sha256LFNormalized(readFileSync(join(REPO_ROOT, 'lab/ledgers/trials-ledger.jsonl'))),
    'sha256:e0e30b3d20f4a81cd36d686ccbbb8dd8d34212a9410673ecc727b91e581f2422',
    'the trials-ledger digest is unchanged',
  );
});

test('AC-C8: the landed worksheet preserves BOTH the matrix OS label and the raw harness platform', () => {
  const ws = JSON.parse(readFileSync(join(PREREG_DIR, 'criteria-derivations.json'), 'utf8'));
  const EXPECTED = { 'ubuntu-latest': 'linux', 'windows-latest': 'win32' };
  let legs = 0;
  for (const c of ws.constants) {
    assert.equal(c.legs.length, 4, `${c.constant_id} must carry all four CI legs`);
    for (const l of c.legs) {
      assert.ok(l.os in EXPECTED, `${c.constant_id}: leg.os "${l.os}" is not a GitHub matrix label`);
      assert.equal(l.raw_platform, EXPECTED[l.os], `${c.constant_id}: raw_platform must be the harness-reported process.platform`);
      assert.equal(l.run_id, '30282182103');
      assert.equal(l.commit_sha, 'd825c9f7398add07e6471fe07581de711b2363ba');
      legs++;
    }
  }
  assert.equal(legs, ws.constants.length * 4);
  for (const j of ws.dispatch_provenance.jobs) assert.equal(j.raw_platform, EXPECTED[j.matrix_os]);
  for (const a of ws.artifact_validation) assert.equal(a.raw_platform, EXPECTED[a.matrix_os]);
});

test('DR-2.3: the three Gate-P digests are computable over the landed bytes as one unit', () => {
  const digests = {
    criteria: criteriaDigest(readFileSync(join(PREREG_DIR, 'pool-entry-criteria.md'))),
    preregistration: sha256LFNormalized(readFileSync(join(PREREG_DIR, 'preregistration.md'))),
    derivations: sha256LFNormalized(readFileSync(join(PREREG_DIR, 'criteria-derivations.json'))),
  };
  for (const [k, v] of Object.entries(digests)) {
    assert.match(v, /^sha256:[0-9a-f]{64}$/, `${k} digest shape`);
  }
  assert.equal(new Set(Object.values(digests)).size, 3, 'the three artifacts are distinct');
  // Digest stability: recomputation over the same bytes is identical.
  assert.equal(criteriaDigest(readFileSync(join(PREREG_DIR, 'pool-entry-criteria.md'))), digests.criteria);
  assert.equal(contentAddress({ a: 1, b: 2 }), contentAddress({ b: 2, a: 1 }), 'content addressing is key-order independent');
});

// ── §12 The landed Gate-P acceptance record (T2.3a) ──────────────────────────

// The FIRST-ISSUE record. Revision 2 supersedes it; it stays on disk byte-unchanged, so
// every assertion below still holds over it — that is what preservation means. What it no
// longer does is AUTHORIZE: see the stale-authority assertions in the digest test.
const GATE_P_RECORD = JSON.parse(readFileSync(join(REPO_ROOT, GATE_P_RECORD_REL), 'utf8'));
/** The GOVERNING record after the revision-2 re-issue (criteria §16.1). */
const GATE_P_RECORD_2 = JSON.parse(readFileSync(join(REPO_ROOT, GATE_P_RECORD_REL_R2), 'utf8'));

test('T2.3a: the Gate-P acceptance record self-verifies and carries the accepted decisions', () => {
  assert.deepEqual(validateGatePRecord(GATE_P_RECORD), { valid: true, problems: [] });
  assert.equal(GATE_P_RECORD.record_id, computeGatePRecordId(GATE_P_RECORD), 'record_id is the SELF-EXCLUDED content address');
  assert.equal(GATE_P_RECORD.record_kind, 'gate-p-acceptance');
  assert.equal(GATE_P_RECORD.gate, 'P');
  assert.equal(GATE_P_RECORD.cycle, 'cycle-006');

  assert.equal(GATE_P_RECORD.credential_posture, 'uncredentialed-only');
  assert.deepEqual(GATE_P_RECORD.pool_bounds, { k_max: 6, max_pool: 6, min_pool_selection_relevant: 3 });
  assert.equal(GATE_P_RECORD.source_universe_ref, 'cycle-006-source-universe-1');
  assert.equal(GATE_P_RECORD.survey_procedure_ref, 'cycle-006-survey-procedure-1');
  assert.equal(GATE_P_RECORD.no_prior_enumeration_attestation, true, 'C6-FR-N4 — exactly true, never truthy');

  // The record is byte-canonical and LF-terminated on disk, like every one-shot record here.
  const onDisk = readFileSync(join(REPO_ROOT, GATE_P_RECORD_REL), 'utf8');
  assert.equal(onDisk, serializeSurveyArtifact(GATE_P_RECORD), 'the record on disk is canonical + LF-terminated');

  // The authority boundary the operator statement must preserve, verbatim in substance.
  const s = GATE_P_RECORD.operator_statement;
  assert.match(s, /authorize materialization and verification of the Gate-P-fixed package only/);
  for (const forbidden of ['candidate enumeration', 'survey execution', 'provider contact', 'pool construction',
    'successor freeze', 'commit', 'push', 'landing', 'LU-2B']) {
    assert.ok(s.includes(forbidden), `the operator statement must withhold authority for ${forbidden}`);
  }
  assert.match(s, /I do not authorize/);
});

test('T2.3a: every digest the GOVERNING record accepts equals the EXACT bytes on disk', () => {
  assert.equal(GATE_P_RECORD_2.criteria_digest, criteriaDigest(readFileSync(join(PREREG_DIR, 'pool-entry-criteria.md'))));
  assert.equal(GATE_P_RECORD_2.successor_prereg_digest, sha256LFNormalized(readFileSync(join(PREREG_DIR, 'preregistration.md'))));
  assert.equal(GATE_P_RECORD_2.derivations_digest, sha256LFNormalized(readFileSync(join(PREREG_DIR, 'criteria-derivations.json'))));

  // The two historical refs are the live values, not transcriptions — at BOTH revisions,
  // and they are identical because the re-issue touched no historical artifact.
  for (const rec of [GATE_P_RECORD, GATE_P_RECORD_2]) {
    assert.equal(rec.refs.historical_freeze_companion,
      readFileSync(join(REPO_ROOT, 'lab/freeze/freeze-manifest.sha256'), 'utf8').trim());
    assert.equal(rec.refs.trials_ledger_digest,
      sha256LFNormalized(readFileSync(join(REPO_ROOT, 'lab/ledgers/trials-ledger.jsonl'))));
  }

  // The DR-2.3 unit check: all three accepted digests still match, as one unit.
  assert.deepEqual(verifyAcceptedDigestUnit({
    record: GATE_P_RECORD_2,
    preregistrationPath: join(REPO_ROOT, PREREGISTRATION_REL),
    derivationsPath: join(REPO_ROOT, DERIVATIONS_REL),
  }), { valid: true, problems: [] });

  // And the criteria-side authority gate resolves against the real repository paths.
  const ok = verifyGatePAuthority({
    gatePRecordPath: join(REPO_ROOT, GATE_P_RECORD_REL_R2),
    criteriaDocumentPath: join(REPO_ROOT, CRITERIA_DOC_REL),
  });
  assert.equal(ok.criteria_digest, GATE_P_RECORD_2.criteria_digest);
  assert.equal(ok.record_id, GATE_P_RECORD_2.record_id);

  // STALE AUTHORITY: the superseded record is preserved and still self-verifies as a
  // record, but it accepts criteria bytes that are no longer on disk — so it refuses.
  assert.deepEqual(validateGatePRecord(GATE_P_RECORD), { valid: true, problems: [] });
  assert.notEqual(GATE_P_RECORD.criteria_digest, GATE_P_RECORD_2.criteria_digest);
  const stale = refusesWith(R.GATE_P_CRITERIA_DIGEST_MISMATCH, () => verifyGatePAuthority({
    gatePRecordPath: join(REPO_ROOT, GATE_P_RECORD_REL),
    criteriaDocumentPath: join(REPO_ROOT, CRITERIA_DOC_REL),
  }), 'the superseded revision-1 record');
  assert.match(stale.message, /full re-issue/);
  assert.deepEqual(verifyAcceptedDigestUnit({
    record: GATE_P_RECORD,
    preregistrationPath: join(REPO_ROOT, PREREGISTRATION_REL),
    derivationsPath: join(REPO_ROOT, DERIVATIONS_REL),
  }).valid, false, 'the superseded record no longer accepts the bytes on disk, as one unit');
});

test('T2.3a: one byte of drift in ANY accepted artifact is caught — acceptance is over bytes, not intent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gatep-drift-'));
  try {
    const recPath = join(dir, 'gate-p-acceptance.json');
    const critPath = join(dir, 'pool-entry-criteria.md');
    const preregPath = join(dir, 'preregistration.md');
    const derivPath = join(dir, 'criteria-derivations.json');
    writeFileSync(recPath, serializeSurveyArtifact(GATE_P_RECORD_2));
    for (const [src, dst] of [['pool-entry-criteria.md', critPath], ['preregistration.md', preregPath], ['criteria-derivations.json', derivPath]]) {
      writeFileSync(dst, readFileSync(join(PREREG_DIR, src)));
    }

    // Baseline: the copied unit verifies.
    assert.equal(verifyGatePAuthority({ gatePRecordPath: recPath, criteriaDocumentPath: critPath }).criteria_digest,
      GATE_P_RECORD_2.criteria_digest);
    assert.equal(verifyAcceptedDigestUnit({ record: GATE_P_RECORD_2, preregistrationPath: preregPath, derivationsPath: derivPath }).valid, true);

    // Criteria drift is the AUTHORITY gate: a typed refusal naming the re-issue rule.
    writeFileSync(critPath, readFileSync(join(PREREG_DIR, 'pool-entry-criteria.md'), 'utf8') + '\n');
    const e = refusesWith(R.GATE_P_CRITERIA_DIGEST_MISMATCH,
      () => verifyGatePAuthority({ gatePRecordPath: recPath, criteriaDocumentPath: critPath }), 'drifted criteria');
    assert.match(e.message, /full re-issue/);

    // Preregistration and worksheet drift are the UNIT check: reported, never silent.
    writeFileSync(preregPath, readFileSync(join(PREREG_DIR, 'preregistration.md'), 'utf8') + '\n');
    const u1 = verifyAcceptedDigestUnit({ record: GATE_P_RECORD_2, preregistrationPath: preregPath, derivationsPath: derivPath });
    assert.equal(u1.valid, false);
    assert.ok(u1.problems.some(p => p.startsWith('successor_prereg_digest')), u1.problems.join('; '));

    writeFileSync(derivPath, readFileSync(join(PREREG_DIR, 'criteria-derivations.json'), 'utf8') + ' ');
    const u2 = verifyAcceptedDigestUnit({ record: GATE_P_RECORD_2, preregistrationPath: preregPath, derivationsPath: derivPath });
    assert.ok(u2.problems.some(p => p.startsWith('derivations_digest')), u2.problems.join('; '));

    // A tampered record no longer self-verifies — the content address is the seal.
    for (const patch of [{ credential_posture: 'credentialed' }, { pool_bounds: { k_max: 8, max_pool: 8, min_pool_selection_relevant: 3 } },
      { at: '2026-07-27T23:00:00.000Z' }, { no_prior_enumeration_attestation: false }]) {
      const tampered = { ...GATE_P_RECORD, ...patch };
      assert.equal(validateGatePRecord(tampered).valid, false, `tampering with ${Object.keys(patch)[0]} must not survive`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T2.3a: the operator-act timestamp is a real UTC instant, and is NOT the materialization clock', () => {
  const at = GATE_P_RECORD.at;
  assert.match(at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'ISO-8601 UTC with millisecond precision');
  assert.equal(new Date(at).toISOString(), at, 'the instant round-trips exactly — no placeholder, no truncation');

  // The record is materialized AFTER the operator act it records; it may never be stamped
  // forward to the materializing node's own clock, and never back-dated.
  const actMs = Date.parse(at);
  assert.ok(Number.isFinite(actMs));
  assert.ok(actMs < Date.now(), 'the operator act precedes every later read of this record');
  assert.ok(actMs > Date.parse('2026-07-26T00:00:00.000Z'),
    'the act is not back-dated behind the LU-2A tree it accepts');
  assert.equal(at, '2026-07-27T22:29:39.457Z', 'the exact GATE_P_FINALIZATION instant recovered from the durable session transcript');
});
