// lab/test/resolution-evidence-c006.spec.js
//
// Cycle-006 S01 LU-1 (PRD C6-FR-E1/E2/E3/T1, C6-FR-A6/A9, NFR-CLAIM; SDD DR-10.1–10.6;
// Sprint Plan T1.1). The branch-aware terminal-authority layer: both authority forms
// constructible for every §10.2-B type; per-form REQUIRED and FORBIDDEN key enforcement
// (neither form may carry, stub, or null-fill the other's fields); the absence
// attestation (enumerated `absent_stages` PLUS structural block absence); the
// historical-preservation and ledger verifiers in the shared core of BOTH forms; the
// M5-handoff schema, completeness, and internal consistency against synthetic
// census/seal fixtures; and the claim-ceiling guard on every write path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  C006_TERMINAL_TYPES, C006_AUTHORITY_FORMS, C006_STAGES, C006_HALT_CLASSES, C006_SEAL_SHAPES,
  C006_SURVEY_PHASES,
  buildPreFreezeTerminalRecord, buildSuccessorChainHead, buildCycle006HaltRecord,
  validateTerminalRecord, assertTerminalRecord, validateM5Handoff,
  verifyHistoricalPreservation, verifyC006LedgerProofs, verifyC006ContaminationStatus,
  writeOneShotRecord, verifyRecordId, buildHaltRecord,
} from '../resolution/evidence.js';
import { SURVEY_PHASES } from '../survey/validate.js';
import { verifyAcquisitionIdentity, AcquisitionRefusal as IdentityRefusal } from '../resolution/identity.js';
import { selfVerifyAcquisitionManifest, AcquisitionRefusal } from '../acquisition/acquire.js';
import { sha256LFNormalized } from '../harness/manifests.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const AT = '2026-07-26T00:00:00Z';

const HISTORICAL = {
  freeze_43: { all_match: true, asset_count: 43, companion_match: true },
  chain_13: { links_verified: 13, all_byte_identical: true },
  superseded_gate_a_record_intact: true,
};
const LEDGERS = {
  trials_line_byte_identical: true,
  trials_sha256: 'sha256:e0e30b3d',
  burn_ledger_bytes: 0,
  burn_empty: true,
  no_successor_ledger: true,
};

/** A 0-byte, clean contamination-ledger observation — the shape `readContaminationLedgerState` returns, plus its digest. */
const EMPTY_LEDGER = {
  rel: 'lab/preregistration/cycle-006/survey-contamination-r2.jsonl',
  exists: true, size: 0, typed_event_count: 0, untyped_lines: 0,
  sha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
};

/**
 * A structured `contamination_status` for a given survey phase (T2.11). The flags are
 * phase-consistent by construction; individual tests override one at a time to prove the
 * validator refuses each inconsistency.
 */
function contaminationStatus(phase, overrides = {}) {
  const started = phase !== C006_SURVEY_PHASES.NOT_STARTED;
  const complete = phase === C006_SURVEY_PHASES.COMPLETE;
  const block = {
    survey_phase: phase,
    summary: 'no contamination event recorded',
    contamination_detected: false,
    adjudication_pending: false,
    measured_value_or_provider_api_accessed: false,
    survey_record_written: complete,
    sweep_completed: complete,
  };
  if (started) block.contamination_ledger = { ...EMPTY_LEDGER };
  return { ...block, ...overrides };
}

/** Arguments for a minimally-complete pre-freeze record (Gate P + a COMPLETE survey, nothing later). */
function preFreezeArgs() {
  return {
    b_type: 'no-lawfully-constitutable-pool',
    reason: 'selection_relevant_count below the Gate-P minimum after a complete sweep',
    stages_reached: ['gate-p', 'survey'],
    reached_artifacts: {
      criteria_digest: 'sha256:aa', preregistration_digest: 'sha256:bb',
      derivations_digest: 'sha256:cc', gate_p_record_id: 'sha256:dd',
      survey_record_digest: 'sha256:ee',
    },
    historical_preservation: HISTORICAL,
    ledger_proofs: LEDGERS,
    contamination_status: contaminationStatus(C006_SURVEY_PHASES.COMPLETE),
    claim_ceiling_ack: true,
    operator_statement: 'EC accepts the pre-freeze ending.',
    at: AT,
  };
}

/** Arguments for the started-but-incomplete shape — the T2.11 terminal's own form. */
function startedIncompleteArgs(overrides = {}) {
  return {
    ...preFreezeArgs(),
    b_type: 'pre-freeze-halt',
    reason: 'the fixed enumeration index cannot produce one unique family set',
    reached_artifacts: {
      criteria_digest: 'sha256:aa', preregistration_digest: 'sha256:bb',
      derivations_digest: 'sha256:cc', gate_p_record_id: 'sha256:dd',
    },
    contamination_status: contaminationStatus(C006_SURVEY_PHASES.STARTED_INCOMPLETE),
    ...overrides,
  };
}

function preFreeze(overrides = {}) {
  return buildPreFreezeTerminalRecord({ ...preFreezeArgs(), ...overrides });
}

/** The full 13-stage reach used by a disposition-A chain head. */
const ALL_REACHED = [...C006_STAGES];
const ALL_STAGE_REFS = Object.fromEntries(C006_STAGES.map(s => [s, `ref:${s}`]));

function m5Complete(overrides = {}) {
  return {
    handoff_basis: 'sealed-m4',
    sealed: { primary: { rank: 1, provider: 'PROV', product: 'PRD' }, reserve: null, shape: 'primary-only' },
    n: { census_n: 87600, fr_a6_class: 'class-1', provenance_ref: 'ref:count-surface' },
    p_star: { value: '0.99', record_ref: 'ref:p-star' },
    census: { cadence: 'h', span: '10y', history_years: 100 },
    permitted_experimental_span_days: 90,
    n_divergence: { census_n: 87600, experimental_n_estimate: 87000, divergence_note: 'census window exceeds the experimental span' },
    runtime_envelope: { constants_provenance_ref: 'ref:criteria-derivations', ci_matrix: { os: ['ubuntu-latest', 'windows-latest'], node: [20, 24] } },
    reserve_runnability_reattestation: { reserve_in_envelope: null, validity_record_ref: 'ref:validity' },
    identities: { historical_freeze_companion: 'sha256:d0c0f0cf', successor_freeze_companion: 'sha256:feed', apparatus_identity: 'sha256:beef' },
    burn_prerequisites: ['fresh operator burn authorization (Cycle-007)'],
    open_operator_decisions: [],
    ...overrides,
  };
}

function chainHead(overrides = {}) {
  const { stage_refs, ...rest } = overrides;
  const reached = rest.stages_reached ?? ALL_REACHED;
  return buildSuccessorChainHead({
    disposition: 'A',
    reason: 'complete M4 with a sealed primary',
    stages_reached: reached,
    stage_refs: stage_refs ?? Object.fromEntries(reached.map(s => [s, `ref:${s}`])),
    chain: [{ path: 'lab/evidence/cycle-006/gate-p-acceptance.json', sha256: 'sha256:1', record_id: 'sha256:1' }],
    pin_invariance_ref: 'ref:pin-invariance-g0',
    historical_preservation: HISTORICAL,
    ledger_proofs: LEDGERS,
    contamination_status: 'none detected',
    claim_ceiling_ack: true,
    operator_statement: 'EC accepts the M4 chain as authoritative.',
    at: AT,
    m5_handoff: m5Complete(),
    ...rest,
  });
}

// ── Terminal typing and the two authority forms ───────────────────────────────

test('DR-10.1: exactly nine §10.2-B terminal type tokens, four inherited + five new', () => {
  assert.equal(C006_TERMINAL_TYPES.length, 9);
  for (const t of ['acquisition-unresolved', 'contamination-halt', 'specification-halt', 'tooling-failure-accepted']) {
    assert.ok(C006_TERMINAL_TYPES.includes(t), `inherited type ${t} kept its name`);
  }
  for (const t of ['no-lawfully-constitutable-pool', 'pre-freeze-halt', 'gate-a-not-achieved', 'g0-declined', 'runnability-violation']) {
    assert.ok(C006_TERMINAL_TYPES.includes(t), `new type ${t} present`);
  }
  assert.deepEqual([...C006_AUTHORITY_FORMS], ['pre-freeze-standalone', 'post-freeze-chain']);
});

test('DR-10.2: BOTH authority forms are constructible for EVERY §10.2-B terminal type', () => {
  for (const b_type of C006_TERMINAL_TYPES) {
    const pre = preFreeze({ b_type });
    assert.equal(pre.authority_form, 'pre-freeze-standalone');
    assert.equal(pre.b_type, b_type);
    assert.equal(pre.record_kind, 'terminal-disposition');

    const post = chainHead({ disposition: 'B', b_type, reason: `disposition B: ${b_type}`, m5_handoff: undefined });
    assert.equal(post.authority_form, 'post-freeze-chain');
    assert.equal(post.b_type, b_type);
    assert.equal(post.record_kind, 'terminal-disposition');
  }
});

test('DR-10.2/10.6: every Cycle-006 record carries the successor literals — no cycle-005 label is reachable', () => {
  const records = [preFreeze(), chainHead(), chainHead({ disposition: 'B', b_type: 'g0-declined', m5_handoff: undefined }),
    buildCycle006HaltRecord({ halt_class: 'fr-d2-bound', evidence: {}, blast_radius: 'rank-1', at: AT })];
  for (const r of records) {
    assert.equal(r.cycle, 'cycle-006');
    assert.equal(r.schema_version, '2.0.0');
  }
  // …and the Cycle-005 builder retained for the historical generation cannot be
  // mistaken for one: it stamps its own literals and rejects the successor classes.
  assert.equal(buildHaltRecord({ halt_class: 'contamination', evidence: {}, blast_radius: 'x', at: AT }).cycle, 'cycle-005');
  assert.throws(() => buildHaltRecord({ halt_class: 'fr-d2-bound', evidence: {}, blast_radius: 'x', at: AT }), /unknown class/);
});

test('DR-10.2: disposition A is m4-acceptance and is unreachable in the pre-freeze form', () => {
  assert.equal(chainHead().record_kind, 'm4-acceptance');
  assert.equal(chainHead().b_type, null);
  const forged = { ...preFreeze(), disposition: 'A', record_kind: 'm4-acceptance', b_type: null };
  const { valid, problems } = validateTerminalRecord(forged);
  assert.equal(valid, false);
  assert.ok(problems.some(p => /cannot carry disposition A/.test(p)));
});

// ── Per-form REQUIRED and FORBIDDEN key enforcement ───────────────────────────

test('DR-10.2: the pre-freeze form FORBIDS every post-freeze field — carried, stubbed, or null-filled', () => {
  const forbidden = ['chain', 'pin_invariance_ref', 'successor_freeze_ref', 'apparatus_identity',
    'supersession_attestation', 'm5_handoff', 'gate_f_ref', 'gate_a_ref', 'g0_ref', 'acquisition_ref',
    'census_ref', 'selection_ref', 'invariance_ref', 'p_star_ref', 'runnability_validity_ref', 'seal_ref'];
  for (const key of forbidden) {
    for (const value of [{ real: true }, null]) {
      const { valid, problems } = validateTerminalRecord({ ...preFreeze(), [key]: value });
      assert.equal(valid, false, `${key}=${JSON.stringify(value)} must be refused`);
      assert.ok(problems.some(p => p.includes(`forbidden key "${key}"`)), `${key} named in the refusal`);
      if (value === null) assert.ok(problems.some(p => /null-filled/.test(p)), 'a null stub is still a refusal');
    }
  }
});

test('DR-10.2: the post-freeze form FORBIDS the pre-freeze `reached_artifacts` block', () => {
  const { valid, problems } = validateTerminalRecord({ ...chainHead(), reached_artifacts: { criteria_digest: 'sha256:aa' } });
  assert.equal(valid, false);
  assert.ok(problems.some(p => p.includes('forbidden key "reached_artifacts"')));
});

test('DR-10.2: each form refuses when one of its own REQUIRED keys is missing', () => {
  for (const key of ['reason', 'stages_reached', 'absent_stages', 'historical_preservation', 'ledger_proofs',
    'contamination_status', 'operator_statement', 'at', 'refs', 'reached_artifacts']) {
    const { [key]: _dropped, ...without } = preFreeze();
    assert.equal(validateTerminalRecord(without).valid, false, `pre-freeze must require ${key}`);
  }
  for (const key of ['chain', 'pin_invariance_ref', 'historical_preservation', 'ledger_proofs']) {
    const { [key]: _dropped, ...without } = chainHead();
    assert.equal(validateTerminalRecord(without).valid, false, `post-freeze must require ${key}`);
  }
});

test('DR-10.4: the ledger AND historical-preservation proofs sit in the shared core of BOTH forms', () => {
  for (const rec of [preFreeze(), chainHead()]) {
    assert.equal(rec.historical_preservation.freeze_43.asset_count, 43);
    assert.equal(rec.historical_preservation.chain_13.links_verified, 13);
    assert.equal(rec.historical_preservation.superseded_gate_a_record_intact, true);
    assert.equal(rec.ledger_proofs.burn_ledger_bytes, 0);
    assert.equal(rec.ledger_proofs.no_successor_ledger, true);
  }
  // an incomplete proof block is refused in either form
  for (const rec of [preFreeze(), chainHead()]) {
    const { no_successor_ledger: _dropped, ...thin } = rec.ledger_proofs;
    assert.equal(validateTerminalRecord({ ...rec, ledger_proofs: thin }).valid, false);
    assert.equal(validateTerminalRecord({ ...rec, historical_preservation: { freeze_43: {}, chain_13: {} } }).valid, false);
  }
});

// ── The absence attestation ───────────────────────────────────────────────────

test('DR-10.2: stages_reached and absent_stages PARTITION the fixed vocabulary', () => {
  const rec = preFreeze();
  assert.deepEqual([...rec.stages_reached, ...rec.absent_stages].sort(), [...C006_STAGES].sort());
  assert.equal(rec.stages_reached.filter(s => rec.absent_stages.includes(s)).length, 0);

  assert.equal(validateTerminalRecord({ ...rec, absent_stages: rec.absent_stages.slice(1) }).valid, false, 'an unaccounted stage is refused');
  assert.equal(validateTerminalRecord({ ...rec, absent_stages: [...rec.absent_stages, 'gate-p'] }).valid, false, 'an overlap is refused');
  assert.equal(validateTerminalRecord({ ...rec, absent_stages: [...rec.absent_stages, 'not-a-stage'] }).valid, false, 'an unknown stage is refused');
  assert.equal(validateTerminalRecord({ ...rec, absent_stages: [...rec.absent_stages, ...rec.absent_stages] }).valid, false, 'duplicates are refused');
});

test('DR-10.2: absence is attested BOTH by enumeration AND by structural block absence', () => {
  const partial = chainHead({
    disposition: 'B', b_type: 'runnability-violation', reason: 'the envelope check restricted the seal',
    stages_reached: ['gate-p', 'survey', 'pool', 'gate-f', 'apparatus-gate-a', 'g0', 'acquisition', 'census', 'selection', 'invariance', 'p-star', 'runnability-validity'],
    m5_handoff: undefined,
  });
  assert.deepEqual(partial.absent_stages, ['seal']);
  assert.equal('seal_ref' in partial, false, 'the unreached stage has NO block, not a null one');
  assert.ok('runnability_validity_ref' in partial, 'the reached stage carries its block');

  // a null-filled block for an unreached stage is an absence-attestation breach
  const nulled = validateTerminalRecord({ ...partial, seal_ref: null });
  assert.equal(nulled.valid, false);
  assert.ok(nulled.problems.some(p => /absence attestation breach/.test(p)));

  // a reached stage whose block is missing is equally refused
  const { p_star_ref: _dropped, ...missing } = partial;
  const r = validateTerminalRecord(missing);
  assert.equal(r.valid, false);
  assert.ok(r.problems.some(p => /structurally absent/.test(p)));
});

test('DR-10.2: the pre-freeze form cannot reach a post-freeze stage, and reached_artifacts is strictly as-reached', () => {
  assert.throws(() => preFreeze({ stages_reached: ['gate-p', 'gate-f'] }), /cannot have reached: gate-f/);
  // pool not reached ⇒ pool_digest may not appear
  assert.throws(() => preFreeze({
    reached_artifacts: { criteria_digest: 'sha256:aa', preregistration_digest: 'sha256:bb', derivations_digest: 'sha256:cc', gate_p_record_id: 'sha256:dd', survey_record_digest: 'sha256:ee', pool_digest: 'sha256:ff' },
  }), /unreached stage \(strictly as-reached\)/);
  // survey reached AND COMPLETE ⇒ its digest is mandatory. (Reaching `survey` alone no
  // longer implies it — that obligation is phase-governed as of T2.11.)
  assert.throws(() => preFreeze({
    reached_artifacts: { criteria_digest: 'sha256:aa', preregistration_digest: 'sha256:bb', derivations_digest: 'sha256:cc', gate_p_record_id: 'sha256:dd' },
  }), /a complete survey requires reached_artifacts\.survey_record_digest/);
});

// ── T2.11: the phase-governed survey obligation ───────────────────────────────
//
// The landed shape coupled `survey` ∈ stages_reached → `survey_record_digest`
// unconditionally, so a survey that lawfully STARTED and halted mid-sweep had no
// truthful form. Two shapes were probed and both are refusals, permanently: a null
// `survey_record_digest` (a placeholder is not evidence) and moving `survey` into
// `absent_stages` (the 0-byte ledger mechanically proves the survey began). The phase
// discriminator is the fix.

test('T2.11: the terminal layer and the survey lane share ONE survey-phase vocabulary', () => {
  assert.deepEqual(
    Object.values(C006_SURVEY_PHASES).sort(),
    Object.values(SURVEY_PHASES).sort(),
    'the re-declared tokens must stay identical to lab/survey/validate.js::SURVEY_PHASES',
  );
  assert.deepEqual(
    [C006_SURVEY_PHASES.NOT_STARTED, C006_SURVEY_PHASES.STARTED_INCOMPLETE, C006_SURVEY_PHASES.COMPLETE],
    [SURVEY_PHASES.PRE_AUTHORIZATION, SURVEY_PHASES.SURVEY_STARTED, SURVEY_PHASES.SURVEY_COMPLETE],
    'and must map state-for-state, not merely as a set',
  );
});

test('T2.11 (1): a STARTED-INCOMPLETE survey with exact ledger evidence and NO survey record is lawful', () => {
  const rec = buildPreFreezeTerminalRecord(startedIncompleteArgs());
  assert.equal(validateTerminalRecord(rec).valid, true);
  assert.ok(rec.stages_reached.includes('survey'), 'the survey began, so it is reached');
  assert.ok(!rec.absent_stages.includes('survey'), 'and is never reported absent');
  assert.equal(rec.contamination_status.survey_phase, C006_SURVEY_PHASES.STARTED_INCOMPLETE);
  assert.ok(!('survey_record_digest' in rec.reached_artifacts), 'structurally absent — not null, not stubbed');
  assert.equal(rec.contamination_status.sweep_completed, false, 'no completed-sweep claim');
});

test('T2.11 (2): P1 — a started survey WITHOUT ledger evidence is refused', () => {
  const cs = contaminationStatus(C006_SURVEY_PHASES.STARTED_INCOMPLETE);
  delete cs.contamination_ledger;
  assert.throws(() => buildPreFreezeTerminalRecord(startedIncompleteArgs({ contamination_status: cs })),
    /a started survey requires the contamination-ledger evidence block/);
});

test('T2.11 (3): P3 — a null (or empty, or stub) survey_record_digest is refused, never accepted as a placeholder', () => {
  for (const [label, value] of [['null', null], ['empty string', ''], ['stub object', {}], ['undefined', undefined]]) {
    const args = startedIncompleteArgs();
    args.reached_artifacts = { ...args.reached_artifacts, survey_record_digest: value };
    assert.throws(() => buildPreFreezeTerminalRecord(args), /survey_record_digest/,
      `a ${label} survey_record_digest must be refused`);
  }
  // The same universal refusal applies to every reached artifact, not just this one.
  const nulled = preFreezeArgs();
  nulled.reached_artifacts = { ...nulled.reached_artifacts, criteria_digest: null };
  assert.throws(() => buildPreFreezeTerminalRecord(nulled),
    /reached_artifacts\["criteria_digest"\] must be a non-empty string/);
});

test('T2.11 (4): P4 — declaring `survey` ABSENT is refused when the phase proves it started', () => {
  const args = startedIncompleteArgs({ stages_reached: ['gate-p'] });
  assert.throws(() => buildPreFreezeTerminalRecord(args),
    /must be in stages_reached, never absent_stages/);
});

test('T2.11 (5): a COMPLETE survey without a survey record is refused', () => {
  const args = preFreezeArgs();
  delete args.reached_artifacts.survey_record_digest;
  assert.throws(() => buildPreFreezeTerminalRecord(args),
    /a complete survey requires reached_artifacts\.survey_record_digest/);
});

test('T2.11 (6): a COMPLETE survey with both a survey record and ledger evidence is lawful', () => {
  const rec = buildPreFreezeTerminalRecord(preFreezeArgs());
  assert.equal(validateTerminalRecord(rec).valid, true);
  assert.equal(rec.contamination_status.survey_phase, C006_SURVEY_PHASES.COMPLETE);
  assert.equal(rec.contamination_status.sweep_completed, true);
  assert.equal(rec.reached_artifacts.survey_record_digest, 'sha256:ee');
});

test('T2.11 (7): a NOT-STARTED survey may carry neither survey artifact', () => {
  const base = {
    ...startedIncompleteArgs(),
    stages_reached: ['gate-p'],
    contamination_status: contaminationStatus(C006_SURVEY_PHASES.NOT_STARTED),
  };
  assert.equal(validateTerminalRecord(buildPreFreezeTerminalRecord(base)).valid, true);

  assert.throws(() => buildPreFreezeTerminalRecord({
    ...base,
    contamination_status: contaminationStatus(C006_SURVEY_PHASES.NOT_STARTED, { contamination_ledger: { ...EMPTY_LEDGER } }),
  }), /a survey that never started has no contamination ledger to reference/);

  assert.throws(() => buildPreFreezeTerminalRecord({
    ...base,
    reached_artifacts: { ...base.reached_artifacts, survey_record_digest: 'sha256:ee' },
  }), /carries "survey_record_digest" for an unreached stage/);
});

test('T2.11 (8): a STARTED-INCOMPLETE survey carrying a survey-record digest is refused', () => {
  const args = startedIncompleteArgs();
  args.stages_reached = ['gate-p', 'survey'];
  args.reached_artifacts = { ...args.reached_artifacts, survey_record_digest: 'sha256:ee' };
  assert.throws(() => buildPreFreezeTerminalRecord(args),
    /"survey_record_digest" must be structurally absent/);

  // …and a completed-sweep claim is equally unavailable to it.
  assert.throws(() => buildPreFreezeTerminalRecord(startedIncompleteArgs({
    contamination_status: contaminationStatus(C006_SURVEY_PHASES.STARTED_INCOMPLETE, { sweep_completed: true }),
  })), /sweep_completed must be false for a started-but-incomplete survey/);
});

test('T2.11 (9): declared ledger evidence is checked against the bytes on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c006-contam-'));
  mkdirSync(join(dir, 'lab/preregistration/cycle-006'), { recursive: true });
  writeFileSync(join(dir, EMPTY_LEDGER.rel), '');

  const truthful = contaminationStatus(C006_SURVEY_PHASES.STARTED_INCOMPLETE);
  assert.deepEqual(verifyC006ContaminationStatus({ repoRoot: dir, contamination_status: truthful }),
    { valid: true, problems: [] });

  const wrongDigest = contaminationStatus(C006_SURVEY_PHASES.STARTED_INCOMPLETE, {
    contamination_ledger: { ...EMPTY_LEDGER, sha256: 'sha256:deadbeef' },
  });
  const d = verifyC006ContaminationStatus({ repoRoot: dir, contamination_status: wrongDigest });
  assert.equal(d.valid, false);
  assert.ok(d.problems.some(p => /digests to/.test(p)));

  const wrongBytes = contaminationStatus(C006_SURVEY_PHASES.STARTED_INCOMPLETE, {
    contamination_ledger: { ...EMPTY_LEDGER, size: 84 },
  });
  const b = verifyC006ContaminationStatus({ repoRoot: dir, contamination_status: wrongBytes });
  assert.equal(b.valid, false);
  assert.ok(b.problems.some(p => /is 0 bytes on disk/.test(p)));

  // A ledger claimed present but absent on disk is equally a refusal.
  const missing = verifyC006ContaminationStatus({
    repoRoot: join(dir, 'nowhere'), contamination_status: truthful,
  });
  assert.equal(missing.valid, false);
  assert.ok(missing.problems.some(p => /does not exist on disk/.test(p)));
});

test('T2.11 (13): TC-2 — pre-authorization is checked against the canonical ledger path, not just the record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c006-contam-preauth-'));
  mkdirSync(join(dir, 'lab/preregistration/cycle-006'), { recursive: true });
  const ledgerAbs = join(dir, EMPTY_LEDGER.rel);
  const notStarted = contaminationStatus(C006_SURVEY_PHASES.NOT_STARTED);

  // No ledger on disk: the pre-authorization claim is truthful and passes.
  assert.deepEqual(verifyC006ContaminationStatus({ repoRoot: dir, contamination_status: notStarted }),
    { valid: true, problems: [] });

  // An existing 0-byte ledger refuses the claim outright — existence alone is the proof.
  writeFileSync(ledgerAbs, '');
  const zeroByte = verifyC006ContaminationStatus({ repoRoot: dir, contamination_status: notStarted });
  assert.equal(zeroByte.valid, false);
  assert.ok(zeroByte.problems.some(p => /already exists on disk/.test(p)));

  // A non-empty ledger refuses it too — the byte count does not matter to this claim.
  writeFileSync(ledgerAbs, '{"typed":true}\n');
  const nonEmpty = verifyC006ContaminationStatus({ repoRoot: dir, contamination_status: notStarted });
  assert.equal(nonEmpty.valid, false);
  assert.ok(nonEmpty.problems.some(p => /already exists on disk/.test(p)));
});

test('T2.11 (14): TC-2 — survey-complete disk truth, and a record-supplied alternate ledger path cannot bypass the canonical check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c006-contam-complete-'));
  mkdirSync(join(dir, 'lab/preregistration/cycle-006'), { recursive: true });
  const canonicalAbs = join(dir, EMPTY_LEDGER.rel);
  writeFileSync(canonicalAbs, '');

  // survey-complete with the exact ledger evidence passes (the survey-record digest
  // obligation is a `reached_artifacts` concern the structural validator checks — T2.11 (6)).
  const complete = contaminationStatus(C006_SURVEY_PHASES.COMPLETE);
  assert.deepEqual(verifyC006ContaminationStatus({ repoRoot: dir, contamination_status: complete }),
    { valid: true, problems: [] });

  // A record declaring an alternate `contamination_ledger.rel` cannot redirect the disk
  // check away from the canonical path — a decoy file elsewhere with different bytes is
  // irrelevant; the canonical 0-byte file is still what gets compared.
  mkdirSync(join(dir, 'decoy'), { recursive: true });
  writeFileSync(join(dir, 'decoy/alternate.jsonl'), 'not the real ledger\n');
  const steered = contaminationStatus(C006_SURVEY_PHASES.STARTED_INCOMPLETE, {
    contamination_ledger: { ...EMPTY_LEDGER, rel: 'decoy/alternate.jsonl', sha256: 'sha256:decoy-digest', size: 999 },
  });
  const result = verifyC006ContaminationStatus({ repoRoot: dir, contamination_status: steered });
  assert.equal(result.valid, false, 'the canonical path is checked regardless of the declared rel');
  assert.ok(result.problems.some(p => /survey-contamination-r2\.jsonl is 0 bytes on disk/.test(p)),
    'the mismatch is reported against the CANONICAL path bytes, not the decoy');
});

test('T2.11 (10): the stage partition stays exact in every survey phase', () => {
  for (const args of [preFreezeArgs(), startedIncompleteArgs(),
    { ...startedIncompleteArgs(), stages_reached: ['gate-p'], contamination_status: contaminationStatus(C006_SURVEY_PHASES.NOT_STARTED) }]) {
    const rec = buildPreFreezeTerminalRecord(args);
    assert.deepEqual([...rec.stages_reached, ...rec.absent_stages].sort(), [...C006_STAGES].sort());
    assert.equal(rec.stages_reached.filter(s => rec.absent_stages.includes(s)).length, 0,
      'every fixed stage occurs exactly once across the two arrays');
  }
});

test('T2.11 (11): post-freeze-chain behavior is unchanged — the prose contamination_status still validates', () => {
  const head = chainHead();
  assert.equal(validateTerminalRecord(head).valid, true);
  assert.equal(head.contamination_status, 'none detected', 'the string form is untouched in the chain form');
  assert.equal(validateTerminalRecord({ ...head, contamination_status: '' }).valid, false);
  // The chain form neither requires nor gains a survey phase.
  assert.ok(!('survey_phase' in Object(head.contamination_status)));

  // TC-1: pristine-HEAD strictness recovered — the chain form refuses EVERY plain-object
  // shape, including ones the pre-freeze structured block would accept outright.
  for (const cs of [{}, { survey_phase: 'totally-made-up' },
    contaminationStatus(C006_SURVEY_PHASES.COMPLETE)]) {
    const { valid, problems } = validateTerminalRecord({ ...head, contamination_status: cs });
    assert.equal(valid, false, `post-freeze-chain must refuse ${JSON.stringify(cs)}`);
    assert.ok(problems.some(p => p.includes('post-freeze-chain: contamination_status must be a non-empty string')));
  }

  // Changing ONLY the runtime type of contamination_status cannot switch which per-form
  // contract applies — `authority_form` alone governs branching, never the value's shape.
  assert.equal(validateTerminalRecord({ ...preFreeze(), contamination_status: 'a string' }).valid, false,
    'a pre-freeze-standalone record with a string value is still judged as pre-freeze-standalone, and refused');
  assert.equal(validateTerminalRecord({ ...head, contamination_status: contaminationStatus(C006_SURVEY_PHASES.COMPLETE) }).valid, false,
    'a post-freeze-chain record with a structured object is still judged as post-freeze-chain, and refused');
});

test('T2.11 (15): pre-freeze-standalone refuses the legacy prose string — the structured block is mandatory', () => {
  const { valid, problems } = validateTerminalRecord({ ...preFreeze(), contamination_status: 'none detected' });
  assert.equal(valid, false);
  assert.ok(problems.some(p => /contamination_status must be the structured block/.test(p)));
});

test('T2.11 (12): the LIVE Cycle-006 terminal record self-verifies against the repository', () => {
  const rel = 'lab/evidence/cycle-006/terminal-disposition.json';
  const rec = JSON.parse(readFileSync(join(REPO_ROOT, rel), 'utf8'));

  assert.deepEqual(validateTerminalRecord(rec), { valid: true, problems: [] });
  assert.ok(verifyRecordId(rec), 'record_id equals its self-excluded content address');

  // The accepted terminal, unchanged by the schema correction.
  assert.equal(rec.record_kind, 'terminal-disposition');
  assert.equal(rec.schema_version, '2.0.0');
  assert.equal(rec.cycle, 'cycle-006');
  assert.equal(rec.disposition, 'B');
  assert.equal(rec.b_type, 'pre-freeze-halt');
  assert.equal(rec.authority_form, 'pre-freeze-standalone');
  assert.equal(rec.at, '2026-07-29T02:21:31.163Z', 'the original terminal-acceptance timestamp, not a new one');

  // The started-but-incomplete survey, represented truthfully.
  assert.deepEqual(rec.stages_reached, ['gate-p', 'survey']);
  assert.deepEqual(rec.absent_stages, ['pool', 'gate-f', 'apparatus-gate-a', 'g0', 'acquisition',
    'census', 'selection', 'invariance', 'p-star', 'runnability-validity', 'seal']);
  assert.equal(rec.contamination_status.survey_phase, C006_SURVEY_PHASES.STARTED_INCOMPLETE);
  assert.ok(!('survey_record_digest' in rec.reached_artifacts), 'no survey record exists, so the key is absent');
  assert.ok(!('pool_digest' in rec.reached_artifacts), 'no pool exists either');
  for (const [k, v] of Object.entries(rec.reached_artifacts)) {
    assert.equal(typeof v, 'string'); assert.ok(v.length > 0, `${k} is a real reference, not a placeholder`);
  }

  // The declared ledger evidence still matches the bytes on disk.
  assert.deepEqual(verifyC006ContaminationStatus({ repoRoot: REPO_ROOT, contamination_status: rec.contamination_status }),
    { valid: true, problems: [] });
  assert.equal(rec.contamination_status.contamination_ledger.size, 0);
  assert.equal(rec.contamination_status.contamination_ledger.sha256,
    'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

  // Nothing later than the survey was reached, and no forbidden key crept in.
  for (const k of ['chain', 'pin_invariance_ref', 'successor_freeze_ref', 'apparatus_identity', 'm5_handoff',
    'gate_f_ref', 'gate_a_ref', 'g0_ref', 'seal_ref']) {
    assert.ok(!(k in rec), `${k} must be structurally absent from a pre-freeze ending`);
  }
});

test('T2.11 (16): TC-2 — the LIVE record cloned to pre-authorization is refused because the real ledger exists on disk', () => {
  const rel = 'lab/evidence/cycle-006/terminal-disposition.json';
  const rec = JSON.parse(readFileSync(join(REPO_ROOT, rel), 'utf8'));
  assert.notEqual(rec.contamination_status.survey_phase, C006_SURVEY_PHASES.NOT_STARTED,
    'sanity: the live record is NOT pre-authorization to begin with');

  const clonedNotStarted = contaminationStatus(C006_SURVEY_PHASES.NOT_STARTED);
  const result = verifyC006ContaminationStatus({ repoRoot: REPO_ROOT, contamination_status: clonedNotStarted });
  assert.equal(result.valid, false, 'the real 0-byte ledger on disk refutes a pre-authorization claim');
  assert.ok(result.problems.some(p => /already exists on disk/.test(p)));
});

// ── T2.11 AC-1 remediation: typed_event_count/untyped_lines re-derived from disk ──
//
// The exact-tree audit found that `verifyC006ContaminationStatus` recomputed disk
// existence, byte count, and digest, but TRUSTED the record's declared
// typed_event_count/untyped_lines outright — a non-empty ledger with three typed
// events could declare typed_event_count: 1 or 999 and still pass. These tests
// prove the counts are now derived from the canonical bytes already read for the
// digest check, and any declared value the derivation cannot reproduce is refused.

function writeLedger(dir, text) {
  mkdirSync(join(dir, 'lab/preregistration/cycle-006'), { recursive: true });
  writeFileSync(join(dir, EMPTY_LEDGER.rel), text);
}

/** Ledger evidence TRUE to `text`'s real size/digest, with counts overridden to the declared value under test. */
function ledgerEvidence(text, counts) {
  return {
    rel: EMPTY_LEDGER.rel,
    exists: true,
    size: Buffer.byteLength(text, 'utf8'),
    sha256: sha256LFNormalized(text),
    ...counts,
  };
}

const THREE_TYPED_TEXT = '{"type":"a"}\n{"type":"b"}\n{"type":"c"}\n';
const ONE_TYPED_ONE_MALFORMED_TEXT = '{"type":"a"}\nnot json\n';

test('T2.11 AC-1 (1): a 0-byte ledger derives typed_event_count=0 / untyped_lines=0 and the truthful claim passes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c006-ac1-empty-'));
  writeLedger(dir, '');
  const cs = contaminationStatus(C006_SURVEY_PHASES.STARTED_INCOMPLETE, {
    contamination_ledger: ledgerEvidence('', { typed_event_count: 0, untyped_lines: 0 }),
  });
  assert.deepEqual(verifyC006ContaminationStatus({ repoRoot: dir, contamination_status: cs }),
    { valid: true, problems: [] });
});

test('T2.11 AC-1 (2): three typed events declared 3/0 pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c006-ac1-3of3-'));
  writeLedger(dir, THREE_TYPED_TEXT);
  const cs = contaminationStatus(C006_SURVEY_PHASES.STARTED_INCOMPLETE, {
    contamination_ledger: ledgerEvidence(THREE_TYPED_TEXT, { typed_event_count: 3, untyped_lines: 0 }),
  });
  assert.deepEqual(verifyC006ContaminationStatus({ repoRoot: dir, contamination_status: cs }),
    { valid: true, problems: [] });
});

test('T2.11 AC-1 (3)/(4): the same three typed events under-declared (1/0) or over-declared (999/0) both refuse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c006-ac1-mismatch-'));
  writeLedger(dir, THREE_TYPED_TEXT);

  for (const declared of [1, 999]) {
    const cs = contaminationStatus(C006_SURVEY_PHASES.STARTED_INCOMPLETE, {
      contamination_ledger: ledgerEvidence(THREE_TYPED_TEXT, { typed_event_count: declared, untyped_lines: 0 }),
    });
    const result = verifyC006ContaminationStatus({ repoRoot: dir, contamination_status: cs });
    assert.equal(result.valid, false, `declared typed_event_count=${declared} must refuse`);
    assert.ok(result.problems.some(p => p.includes(`typed_event_count=${declared}`) && p.includes('derives 3 typed event')),
      `problem names both the declared (${declared}) and derived (3) count`);
  }
});

test('T2.11 AC-1 (5)/(6): one typed + one malformed line — the disk-truth check passes a true 1/1 declaration (DR-4.8 policy refuses it separately); a false 2/0 declaration is refused as a disk-truth mismatch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c006-ac1-mixed-'));
  writeLedger(dir, ONE_TYPED_ONE_MALFORMED_TEXT);

  // Disk truth: the declared 1/1 exactly reproduces what's on disk, so the TC-2
  // disk-verifier alone passes it. "Every append must be typed" is a separate,
  // upstream policy (validateContaminationStatusBlock / DR-4.8) — not this
  // function's job, and this remediation does not fold that policy in.
  const trueShape = contaminationStatus(C006_SURVEY_PHASES.STARTED_INCOMPLETE, {
    contamination_ledger: ledgerEvidence(ONE_TYPED_ONE_MALFORMED_TEXT, { typed_event_count: 1, untyped_lines: 1 }),
  });
  assert.deepEqual(verifyC006ContaminationStatus({ repoRoot: dir, contamination_status: trueShape }),
    { valid: true, problems: [] });
  // ...yet building a full record around that same truthful shape still hits the
  // existing DR-4.8 refusal — the two checks are independent and both stand.
  assert.throws(() => buildPreFreezeTerminalRecord(startedIncompleteArgs({ contamination_status: trueShape })),
    /every ledger append must be a typed event object/);

  // Declaring 2/0 against the SAME bytes is a disk-truth mismatch and the TC-2
  // verifier refuses it directly, independent of the DR-4.8 policy question.
  const wrongShape = contaminationStatus(C006_SURVEY_PHASES.STARTED_INCOMPLETE, {
    contamination_ledger: ledgerEvidence(ONE_TYPED_ONE_MALFORMED_TEXT, { typed_event_count: 2, untyped_lines: 0 }),
  });
  const result = verifyC006ContaminationStatus({ repoRoot: dir, contamination_status: wrongShape });
  assert.equal(result.valid, false);
  assert.ok(result.problems.some(p => /typed_event_count=2/.test(p) && /derives 1 typed event/.test(p)));
  assert.ok(result.problems.some(p => /untyped_lines=0/.test(p) && /derives 1 untyped line/.test(p)));
});

test('T2.11 AC-1 (7): a matching digest and byte count cannot mask an event-count mismatch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c006-ac1-digest-match-'));
  writeLedger(dir, THREE_TYPED_TEXT);
  const cs = contaminationStatus(C006_SURVEY_PHASES.STARTED_INCOMPLETE, {
    // size and sha256 are TRUE to the bytes on disk; only the event counts lie.
    contamination_ledger: ledgerEvidence(THREE_TYPED_TEXT, { typed_event_count: 1, untyped_lines: 0 }),
  });
  const result = verifyC006ContaminationStatus({ repoRoot: dir, contamination_status: cs });
  assert.equal(result.valid, false);
  assert.ok(!result.problems.some(p => /digests to|is \d+ bytes on disk/.test(p)),
    'size and digest are truthful — only the count mismatch should be reported');
});

test('T2.11 AC-1 (8): a JSON value that is not a plain object counts as untyped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c006-ac1-nonobject-'));
  const text = '[1,2,3]\n"a string"\n42\n';
  writeLedger(dir, text);
  const cs = contaminationStatus(C006_SURVEY_PHASES.STARTED_INCOMPLETE, {
    contamination_ledger: ledgerEvidence(text, { typed_event_count: 0, untyped_lines: 3 }),
  });
  assert.deepEqual(verifyC006ContaminationStatus({ repoRoot: dir, contamination_status: cs }),
    { valid: true, problems: [] });
});

test('T2.11 AC-1 (9): blank-line handling follows the existing convention and cannot be used to falsify counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c006-ac1-blank-'));
  const text = '{"type":"a"}\n\n   \n{"type":"b"}\n';
  writeLedger(dir, text);
  const cs = contaminationStatus(C006_SURVEY_PHASES.STARTED_INCOMPLETE, {
    contamination_ledger: ledgerEvidence(text, { typed_event_count: 2, untyped_lines: 0 }),
  });
  assert.deepEqual(verifyC006ContaminationStatus({ repoRoot: dir, contamination_status: cs }),
    { valid: true, problems: [] });

  // Padding the blank-line count cannot buy a higher declared total — blank lines
  // are not "relevant lines" under the existing convention, so they cannot inflate
  // untyped_lines either.
  const inflated = contaminationStatus(C006_SURVEY_PHASES.STARTED_INCOMPLETE, {
    contamination_ledger: ledgerEvidence(text, { typed_event_count: 2, untyped_lines: 2 }),
  });
  const result = verifyC006ContaminationStatus({ repoRoot: dir, contamination_status: inflated });
  assert.equal(result.valid, false);
  assert.ok(result.problems.some(p => /untyped_lines=2/.test(p) && /derives 0 untyped line/.test(p)));
});

test('T2.11 AC-1 (10): negative, fractional, string, null, and unsafe-integer declarations all refuse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c006-ac1-badtype-'));
  writeLedger(dir, '');
  const bad = [-1, 1.5, '0', null, Number.MAX_SAFE_INTEGER + 1];
  for (const v of bad) {
    const cs = contaminationStatus(C006_SURVEY_PHASES.STARTED_INCOMPLETE, {
      contamination_ledger: ledgerEvidence('', { typed_event_count: v, untyped_lines: 0 }),
    });
    const result = verifyC006ContaminationStatus({ repoRoot: dir, contamination_status: cs });
    assert.equal(result.valid, false, `typed_event_count=${JSON.stringify(v)} must refuse`);
    assert.ok(result.problems.some(p => /typed_event_count must be a non-negative safe integer/.test(p)));
  }
});

test('T2.11 AC-1 (11): the verifier derives counts only from the canonical ledger path — a record-supplied rel cannot steer derivation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c006-ac1-decoy-'));
  writeLedger(dir, THREE_TYPED_TEXT);
  mkdirSync(join(dir, 'decoy'), { recursive: true });
  writeFileSync(join(dir, 'decoy/alternate.jsonl'), '{"only":"one"}\n');

  const cs = contaminationStatus(C006_SURVEY_PHASES.STARTED_INCOMPLETE, {
    contamination_ledger: {
      ...ledgerEvidence(THREE_TYPED_TEXT, { typed_event_count: 3, untyped_lines: 0 }),
      rel: 'decoy/alternate.jsonl',
    },
  });
  assert.deepEqual(verifyC006ContaminationStatus({ repoRoot: dir, contamination_status: cs }),
    { valid: true, problems: [] },
    'the canonical 3-event ledger is what gets derived and compared, regardless of the declared rel');
});

test('T2.11 AC-1 (12): the accepted LIVE terminal record still self-verifies after remediation', () => {
  const rel = 'lab/evidence/cycle-006/terminal-disposition.json';
  const rec = JSON.parse(readFileSync(join(REPO_ROOT, rel), 'utf8'));
  assert.equal(rec.contamination_status.contamination_ledger.typed_event_count, 0);
  assert.equal(rec.contamination_status.contamination_ledger.untyped_lines, 0);
  assert.deepEqual(verifyC006ContaminationStatus({ repoRoot: REPO_ROOT, contamination_status: rec.contamination_status }),
    { valid: true, problems: [] });
  assert.deepEqual(validateTerminalRecord(rec), { valid: true, problems: [] });
  assert.ok(verifyRecordId(rec));
});

test('DR-10.2: buildSuccessorChainHead refuses a ref for a stage that was never reached', () => {
  assert.throws(() => chainHead({ stages_reached: ['gate-p', 'gate-f'], stage_refs: { 'gate-p': 'x', 'gate-f': 'y', seal: 'z' }, disposition: 'B', b_type: 'pre-freeze-halt', m5_handoff: undefined }), /unreached stage "seal"/);
  assert.throws(() => chainHead({ stage_refs: { 'not-a-stage': 'x' } }), /unknown stage/);
  assert.throws(() => chainHead({ stages_reached: ['gate-p'], stage_refs: { 'gate-p': 'x' }, disposition: 'B', b_type: 'pre-freeze-halt', m5_handoff: undefined }), /requires the gate-f stage/);
});

// ── The M5-handoff block ──────────────────────────────────────────────────────

test('DR-10.5: disposition A REQUIRES a complete m5_handoff; every required field is enforced', () => {
  assert.throws(() => chainHead({ m5_handoff: undefined }), /requires the m5_handoff block/);
  for (const key of ['sealed', 'n', 'p_star', 'census', 'permitted_experimental_span_days', 'n_divergence',
    'runtime_envelope', 'reserve_runnability_reattestation', 'identities', 'burn_prerequisites', 'open_operator_decisions']) {
    const { [key]: _dropped, ...thin } = m5Complete();
    const { valid, problems } = validateM5Handoff(thin, { disposition: 'A' });
    assert.equal(valid, false, `m5_handoff must require ${key}`);
    assert.ok(problems.some(p => p.includes(key)));
  }
});

test('DR-10.5: all three seal shapes validate, and shape/member consistency is enforced', () => {
  const shapes = {
    'primary-only': { primary: { rank: 1, provider: 'P', product: 'Q' }, reserve: null, shape: 'primary-only' },
    'primary+reserve': { primary: { rank: 1, provider: 'P', product: 'Q' }, reserve: { rank: 2, provider: 'R', product: 'S' }, shape: 'primary+reserve' },
    'none-eligible': { primary: null, reserve: null, shape: 'none-eligible' },
  };
  for (const shape of C006_SEAL_SHAPES) {
    const extra = shape === 'primary+reserve' ? { reserve_runnability_reattestation: { reserve_in_envelope: true, validity_record_ref: 'ref:v' } } : {};
    assert.equal(validateM5Handoff(m5Complete({ sealed: shapes[shape], ...extra }), { disposition: 'A' }).valid, true, `${shape} is a complete M4 success`);
  }
  assert.equal(validateM5Handoff(m5Complete({ sealed: { ...shapes['primary-only'], reserve: { rank: 2, provider: 'R', product: 'S' } } }), { disposition: 'A' }).valid, false);
  assert.equal(validateM5Handoff(m5Complete({ sealed: { ...shapes['none-eligible'], primary: { rank: 1, provider: 'P', product: 'Q' } } }), { disposition: 'A' }).valid, false);
  assert.equal(validateM5Handoff(m5Complete({ sealed: { ...shapes['primary+reserve'], reserve: null } }), { disposition: 'A' }).valid, false);
});

test('AC-B7: a disposition-B record may echo the block as-applicable but NEVER as a seal handoff', () => {
  const asApplicable = { handoff_basis: 'as-applicable-no-seal', n: { census_n: 10, fr_a6_class: 'class-3', provenance_ref: 'ref:n' }, burn_prerequisites: ['fresh operator burn authorization (Cycle-007)'] };
  const b = chainHead({ disposition: 'B', b_type: 'runnability-violation', reason: 'restricted by the validity condition', m5_handoff: asApplicable });
  assert.equal(b.m5_handoff.handoff_basis, 'as-applicable-no-seal');
  // a seal block in a disposition-B record is refused…
  assert.throws(() => chainHead({ disposition: 'B', b_type: 'runnability-violation', reason: 'x', m5_handoff: { ...asApplicable, sealed: m5Complete().sealed } }), /may never carry `sealed`/);
  // …as is a sealed-m4 basis without a seal, or an as-applicable basis on disposition A
  assert.throws(() => chainHead({ disposition: 'B', b_type: 'g0-declined', reason: 'x', m5_handoff: m5Complete() }), /handoff_basis must be "as-applicable-no-seal"/);
  assert.throws(() => chainHead({ m5_handoff: asApplicable }), /handoff_basis must be "sealed-m4"/);
});

test('DR-10.5: p* is EITHER a resolved value OR a lawful block — never both, never neither', () => {
  assert.equal(validateM5Handoff(m5Complete({ p_star: { lawful_block_ref: 'ref:block' } }), { disposition: 'A' }).valid, true);
  assert.equal(validateM5Handoff(m5Complete({ p_star: { value: '0.99', record_ref: 'r', lawful_block_ref: 'b' } }), { disposition: 'A' }).valid, false);
  assert.equal(validateM5Handoff(m5Complete({ p_star: {} }), { disposition: 'A' }).valid, false);
});

test('DR-10.5: the runtime envelope must name all four CI legs (NFR-C6-RUNTIME provenance)', () => {
  assert.equal(validateM5Handoff(m5Complete({ runtime_envelope: { constants_provenance_ref: 'r', ci_matrix: { os: ['ubuntu-latest'], node: [20, 24] } } }), { disposition: 'A' }).valid, false);
  assert.equal(validateM5Handoff(m5Complete({ runtime_envelope: { constants_provenance_ref: 'r', ci_matrix: { os: ['ubuntu-latest', 'windows-latest'], node: [20] } } }), { disposition: 'A' }).valid, false);
});

test('DR-10.5: M5-handoff internal consistency against synthetic census + seal fixtures', () => {
  // Synthetic upstream records the handoff must agree with.
  const censusFixture = { record_kind: 'census-result', n: 87600, cadence: 'h', span: '10y', history_years: 100 };
  const sealFixture = { record_kind: 'selection-outcome', real_run: { primary: { rank: 1, provider: 'PROV', product: 'PRD' }, reserve: null } };

  const derived = m5Complete({
    sealed: { primary: sealFixture.real_run.primary, reserve: sealFixture.real_run.reserve, shape: 'primary-only' },
    n: { census_n: censusFixture.n, fr_a6_class: 'class-1', provenance_ref: 'ref:count-surface' },
    census: { cadence: censusFixture.cadence, span: censusFixture.span, history_years: censusFixture.history_years },
    n_divergence: { census_n: censusFixture.n, experimental_n_estimate: 87000, divergence_note: 'window shorter than the census history' },
  });
  assert.equal(validateM5Handoff(derived, { disposition: 'A' }).valid, true);
  assert.equal(derived.sealed.primary.provider, sealFixture.real_run.primary.provider);
  assert.equal(derived.census.cadence, censusFixture.cadence);

  // the divergence disclosure may not silently restate a different census n
  const inconsistent = validateM5Handoff({ ...derived, n_divergence: { ...derived.n_divergence, census_n: 1 } }, { disposition: 'A' });
  assert.equal(inconsistent.valid, false);
  assert.ok(inconsistent.problems.some(p => /internal inconsistency/.test(p)));
});

// ── Shared-core verifiers over the real repository ────────────────────────────

test('C6-FR-E2/E3: verifyHistoricalPreservation proves 43/43, 13/13, and the superseded Gate-A record', () => {
  const { block, mismatches } = verifyHistoricalPreservation({ repoRoot: REPO_ROOT });
  assert.deepEqual(mismatches, [], 'no historical drift');
  assert.equal(block.freeze_43.asset_count, 43);
  assert.equal(block.freeze_43.all_match, true);
  assert.equal(block.freeze_43.companion_match, true);
  assert.equal(block.chain_13.links_verified, 13);
  assert.equal(block.chain_13.all_byte_identical, true);
  assert.equal(block.superseded_gate_a_record_intact, true);
});

test('C6-FR-E2: verifyHistoricalPreservation DETECTS a mutated chain-linked byte (synthetic tree)', () => {
  const root = mkdtempSync(join(tmpdir(), 'c006-hist-'));
  mkdirSync(join(root, 'lab/evidence/cycle-005'), { recursive: true });
  mkdirSync(join(root, 'lab/freeze'), { recursive: true });
  const linked = join(root, 'lab/evidence/cycle-005/contact-log.jsonl');
  writeFileSync(linked, '{"seq":0}\n');
  const head = { record_kind: 'terminal-disposition', chain: [{ path: 'lab/evidence/cycle-005/contact-log.jsonl', sha256: sha256LFNormalized('{"seq":0}\n'), record_id: null }] };
  writeFileSync(join(root, 'lab/evidence/cycle-005/terminal-disposition.json'), JSON.stringify(head));
  assert.equal(verifyHistoricalPreservation({ repoRoot: root }).block.chain_13.all_byte_identical, true);

  writeFileSync(linked, '{"seq":0}\n{"seq":1}\n'); // plant drift
  const drifted = verifyHistoricalPreservation({ repoRoot: root });
  assert.equal(drifted.block.chain_13.all_byte_identical, false);
  assert.ok(drifted.mismatches.some(m => /digest mismatch/.test(m.reason)));
});

test('C6-FR-A9/E4: verifyC006LedgerProofs confirms the baselines and that no successor ledger exists', () => {
  const trials = sha256LFNormalized(readFileSync(join(REPO_ROOT, 'lab/ledgers/trials-ledger.jsonl'), 'utf8'));
  const { block, unexpected_ledger_files } = verifyC006LedgerProofs({ repoRoot: REPO_ROOT, baselines: { trials_sha256: trials, burn_bytes: 0 } });
  assert.equal(block.trials_line_byte_identical, true);
  assert.equal(block.burn_ledger_bytes, 0);
  assert.equal(block.burn_empty, true);
  assert.equal(block.no_successor_ledger, true);
  assert.deepEqual(unexpected_ledger_files, []);

  const root = mkdtempSync(join(tmpdir(), 'c006-ledg-'));
  mkdirSync(join(root, 'lab/ledgers'), { recursive: true });
  writeFileSync(join(root, 'lab/ledgers/successor-trials.jsonl'), '');
  const seen = verifyC006LedgerProofs({ repoRoot: root, baselines: { trials_sha256: null, burn_bytes: 0 } });
  assert.equal(seen.block.no_successor_ledger, false, 'a third ledger file is detected');
});

// ── Halt classes, write paths, and the claim ceiling ──────────────────────────

test('DR-10.3: the successor halt classes extend the inherited five with fr-d2-bound + survey-contamination', () => {
  assert.equal(C006_HALT_CLASSES.length, 7);
  for (const c of C006_HALT_CLASSES) {
    const h = buildCycle006HaltRecord({ halt_class: c, evidence: { probe: 1 }, blast_radius: 'rank-1', at: AT });
    assert.equal(h.class, c);
    assert.equal(h.cycle, 'cycle-006');
    assert.equal(h.schema_version, '2.0.0');
  }
  assert.throws(() => buildCycle006HaltRecord({ halt_class: 'not-a-class', at: AT }), /unknown class/);
  assert.throws(() => buildCycle006HaltRecord({ halt_class: 'spec-error', at: '' }), /wall-clock/);
});

test('NFR-CLAIM: the claim-ceiling guard fires on every Cycle-006 build and write path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c006-ev-'));
  assert.throws(() => preFreeze({ reason: 'x', contamination_status: 'none detected', operator_statement: 'y', refs: { scoring: 1 } }), /forbidden claim-ceiling key/);
  assert.throws(() => chainHead({ refs: { deep: { calibration: 1 } } }), /forbidden claim-ceiling key/);
  assert.throws(() => buildCycle006HaltRecord({ halt_class: 'spec-error', evidence: { certified: true }, blast_radius: 'x', at: AT }), /forbidden claim-ceiling key/);
  assert.throws(() => writeOneShotRecord(join(dir, 'bad.json'), { ...preFreeze(), refs: { certificate: 'x' } }), /forbidden claim-ceiling key/);
});

test('DR-10.6: a written terminal record is canonical, content-addressed, and re-validates from its bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c006-ev-'));
  for (const [name, body] of [['terminal-disposition.json', preFreeze()], ['m4-acceptance.json', chainHead()]]) {
    const written = writeOneShotRecord(join(dir, name), body);
    assert.ok(verifyRecordId(written), 'record_id is the self-excluded content address');
    const reread = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    const { valid, problems } = validateTerminalRecord(reread);
    assert.equal(valid, true, problems.join('; '));
  }
  // a tampered record_id is caught on re-validation
  const rec = { ...preFreeze(), record_id: 'sha256:' + 'f'.repeat(64) };
  assert.equal(validateTerminalRecord(rec).valid, false);
});

// ── LU-1 mixed-literal safety (Sprint Plan §5.4 cross-cutting exit check) ─────
//
// After LU-1 the apparatus is deliberately in a mixed cycle-literal state: the evidence
// layer is Cycle-006-aware while `acquire.js`, `seal.js`, and the driver still carry
// `cycle-005` (their wholesale migration is T3.1's, in LU-3). The two properties below
// are what make that intermediate state inert.

test('§5.4 exit check: the superseded Cycle-005 identity REFUSES against the α-mutated live tree', () => {
  const manifestPath = join(REPO_ROOT, 'lab/evidence/cycle-005/acquisition-manifest.json');
  // Both lanes re-hash the live apparatus against the Cycle-005 record and refuse: the
  // α edit to lab/resolution/evidence.js is exactly the drift they exist to catch
  // (C6-FR-A4/B5). This refusal is the supersession property — the accepted Cycle-005
  // identity authorizes nothing against a Cycle-006 tree.
  assert.throws(() => selfVerifyAcquisitionManifest({ repoRoot: REPO_ROOT, manifestPath }), AcquisitionRefusal, 'Lane A refuses');
  assert.throws(() => verifyAcquisitionIdentity({ repoRoot: REPO_ROOT, manifestPath }), IdentityRefusal, 'Lane B refuses');
  // …while the historical record's own bytes remain intact (C6-FR-E2).
  assert.equal(sha256LFNormalized(readFileSync(manifestPath, 'utf8')), 'sha256:073c7ff2d5acb6db548bddd34e34de4e65eaeaaff31a6051cdc05ccfddb8e4c6');
});

test('§5.4 exit check / C6-FR-A2: no Cycle-006 record path can be steered to a cycle-005 label', () => {
  // The literals are hard-coded in each builder — never a parameter, flag, or
  // environment value — so an attempt to pass a cycle label is simply not a knob.
  const steered = [
    buildPreFreezeTerminalRecord({ ...preFreezeArgs(), cycle: 'cycle-005', schema_version: '1.0.0', authority_form: 'post-freeze-chain' }),
    buildCycle006HaltRecord({ halt_class: 'survey-contamination', evidence: {}, blast_radius: 'x', at: AT, cycle: 'cycle-005' }),
  ];
  for (const r of steered) {
    assert.equal(r.cycle, 'cycle-006');
    assert.equal(r.schema_version, '2.0.0');
  }
  assert.equal(steered[0].authority_form, 'pre-freeze-standalone', 'the builder fixes its own form');
  // …and a hand-assembled cycle-005-labelled record is refused by the validator.
  assert.equal(validateTerminalRecord({ ...preFreeze(), cycle: 'cycle-005', schema_version: '1.0.0' }).valid, false);
});

test('DR-10.2: assertTerminalRecord reports EVERY problem at once (a record review reads as one report)', () => {
  let err = null;
  try { assertTerminalRecord({ authority_form: 'post-freeze-chain', disposition: 'B' }); } catch (e) { err = e; }
  assert.ok(err, 'an invalid record is refused');
  assert.match(err.message, /Cycle-006 terminal record refused/);
  assert.ok(err.message.split('\n').length > 3, 'multiple problems surfaced together');
  assert.equal(validateTerminalRecord({ ...preFreeze(), authority_form: 'neither' }).valid, false);
  assert.equal(validateTerminalRecord({ ...preFreeze(), schema_version: '1.0.0' }).valid, false);
  assert.equal(validateTerminalRecord({ ...preFreeze(), cycle: 'cycle-005' }).valid, false);
  assert.equal(validateTerminalRecord({ ...preFreeze(), claim_ceiling_ack: false }).valid, false);
});
