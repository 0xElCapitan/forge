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
  buildPreFreezeTerminalRecord, buildSuccessorChainHead, buildCycle006HaltRecord,
  validateTerminalRecord, assertTerminalRecord, validateM5Handoff,
  verifyHistoricalPreservation, verifyC006LedgerProofs,
  writeOneShotRecord, verifyRecordId, buildHaltRecord,
} from '../resolution/evidence.js';
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

/** Arguments for a minimally-complete pre-freeze record (Gate P + survey reached, nothing later). */
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
    contamination_status: 'none detected',
    claim_ceiling_ack: true,
    operator_statement: 'EC accepts the pre-freeze ending.',
    at: AT,
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
  // survey reached ⇒ its digest is mandatory
  assert.throws(() => preFreeze({
    reached_artifacts: { criteria_digest: 'sha256:aa', preregistration_digest: 'sha256:bb', derivations_digest: 'sha256:cc', gate_p_record_id: 'sha256:dd' },
  }), /missing "survey_record_digest"/);
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
