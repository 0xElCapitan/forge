// lab/test/resolution-evidence.spec.js
//
// Cycle-005 S01 (PRD FR-E1/FR-E2/FR-E4, FR-D5, NFR-CLAIM; SDD DR-4, DR-10; Sprint Plan
// T1.8). Record envelopes + content-address stability; append-only + invalidation-by-
// record mechanics; the §3 forbidden-key guard on every record; chain-head enumeration
// completeness; and the ledger-baseline verifier (trials byte-identical, burn 0 bytes).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeRecordId, verifyRecordId, writeOneShotRecord, appendJsonlRecord,
  buildHaltRecord, buildInvalidationRecord, buildChainHead, verifyChainConnectivity,
  verifyLedgerBaselines, readJsonl,
} from '../resolution/evidence.js';
import { sealSelection, assertSealPreconditions, SealHalt } from '../resolution/seal.js';
import { canonicalize } from '../../src/receipt/canonicalize.js';
import { sha256LFNormalized } from '../harness/manifests.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FREEZE = join(REPO_ROOT, 'lab/freeze/freeze-manifest.json');
const STANDINS = {
  eligible: JSON.parse(readFileSync(join(REPO_ROOT, 'lab/resolution/fixtures/hypothetical-eligible.json'), 'utf8')),
  ineligible: JSON.parse(readFileSync(join(REPO_ROOT, 'lab/resolution/fixtures/hypothetical-ineligible.json'), 'utf8')),
};
const POOL = { candidates: [{ rank: 1, provider: 'USGS', product: 'a' }, { rank: 2, provider: 'NOAA', product: 'b' }, { rank: 3, provider: 'EIA', product: 'c' }] };
const eligAgg = (p, pr) => ({ provider: p, product: pr, n_observations: 87600, history_years: 100, span: null, cadence: 'h', authority_published: true, public: true, machine_readable: true, free: true, exogeneity_judgment: 'x', exogenous: true, mechanical_outcome_declared: true, revision_vintage_documented: true });

test('DR-4.3: record_id is the self-excluded content address; verifyRecordId round-trips', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c005-ev-'));
  const rec = { record_kind: 'selection-outcome', schema_version: '1.0.0', cycle: 'cycle-005', real_run: { primary: null } };
  const written = writeOneShotRecord(join(dir, 'selection-outcome.json'), rec);
  assert.ok(written.record_id.startsWith('sha256:'));
  assert.ok(verifyRecordId(written));
  // the file bytes are canonical + LF
  const bytes = readFileSync(join(dir, 'selection-outcome.json'), 'utf8');
  assert.equal(bytes, canonicalize(written) + '\n');
});

test('DR-4.3: content-address stability — same record → same id; a changed field → different id', () => {
  const a = { record_kind: 'x', cycle: 'cycle-005', v: 1 };
  const b = { record_kind: 'x', cycle: 'cycle-005', v: 1 };
  const c = { record_kind: 'x', cycle: 'cycle-005', v: 2 };
  assert.equal(computeRecordId(a), computeRecordId(b));
  assert.notEqual(computeRecordId(a), computeRecordId(c));
  // record_id is self-excluded: including a prior id does not change the computed id
  assert.equal(computeRecordId({ ...a, record_id: 'sha256:whatever' }), computeRecordId(a));
});

test('NFR-CLAIM §3: the forbidden-key guard rejects a claim-ceiling key on write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c005-ev-'));
  assert.throws(() => writeOneShotRecord(join(dir, 'bad.json'), { record_kind: 'x', cycle: 'cycle-005', scoring: { certified: true } }), /forbidden claim-ceiling key/);
  // nested forbidden key is caught too
  assert.throws(() => appendJsonlRecord(join(dir, 'bad.jsonl'), { record_kind: 'x', deep: { calibration: 1 } }), /forbidden claim-ceiling key/);
});

test('DR-4.5: append-only JSONL accumulates; nothing is edited', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c005-ev-'));
  const p = join(dir, 'contact-log.jsonl');
  appendJsonlRecord(p, { record_kind: 'contact-log', seq: 0, outcome_class: 'ok' });
  appendJsonlRecord(p, { record_kind: 'contact-log', seq: 1, outcome_class: 'ok' });
  const rows = readJsonl(p);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].seq, 1);
});

test('DR-4.5: invalidation-by-record marks a provisional seal non-authoritative by reference', () => {
  const inv = buildInvalidationRecord({ invalidates: 'sha256:abc', terminal_reason_ref: 'terminal-disposition', at: '2026-01-01T00:00:00Z' });
  assert.equal(inv.record_kind, 'invalidation');
  assert.equal(inv.invalidates, 'sha256:abc');
  assert.throws(() => buildInvalidationRecord({ invalidates: '', at: 'x' }));
});

test('§6.5 HALT record: class validation + wall-clock requirement', () => {
  const h = buildHaltRecord({ halt_class: 'contamination', evidence: {}, blast_radius: 'rank-5', at: '2026-01-01T00:00:00Z' });
  assert.equal(h.class, 'contamination');
  assert.throws(() => buildHaltRecord({ halt_class: 'not-a-class', at: 'x' }));
});

test('FR-E1 chain head: disposition A/B validation + connectivity', () => {
  const headA = buildChainHead({ disposition: 'A', classification_table: {}, contamination_status: 'none detected', chain: [{ path: 'a.json', sha256: 'sha256:1', record_id: 'sha256:1' }], ledger_proofs: { trials_line_byte_identical: true, burn_ledger_bytes: 0 }, pin_invariance_ref: 'x', claim_ceiling_ack: true, operator_statement: '...', at: '2026-01-01T00:00:00Z' });
  assert.equal(headA.record_kind, 'm4-acceptance');
  assert.ok(verifyChainConnectivity(headA).connected);
  const headB = buildChainHead({ disposition: 'B', b_type: 'acquisition-unresolved', classification_table: {}, contamination_status: 'none detected', chain: [], ledger_proofs: {}, pin_invariance_ref: 'x', claim_ceiling_ack: true, operator_statement: '...', at: '2026-01-01T00:00:00Z' });
  assert.equal(headB.record_kind, 'terminal-disposition');
  assert.equal(headB.b_type, 'acquisition-unresolved');
  assert.throws(() => buildChainHead({ disposition: 'B', b_type: 'bogus', chain: [], at: 'x' }));
  assert.throws(() => buildChainHead({ disposition: 'C', chain: [], at: 'x' }));
});

test('FR-D5/FR-E4: verifyLedgerBaselines confirms the trials line byte-identical + burn 0 bytes', () => {
  const trialsAbs = join(REPO_ROOT, 'lab/ledgers/trials-ledger.jsonl');
  const trials_sha256 = sha256LFNormalized(readFileSync(trialsAbs, 'utf8'));
  const good = verifyLedgerBaselines({ repoRoot: REPO_ROOT, baselines: { trials_sha256, burn_bytes: 0 } });
  assert.equal(good.trials_line_byte_identical, true);
  assert.equal(good.burn_empty, true);
  assert.equal(good.burn_ledger_bytes, 0);
  // a wrong baseline is detected
  const bad = verifyLedgerBaselines({ repoRoot: REPO_ROOT, baselines: { trials_sha256: 'sha256:wrong', burn_bytes: 0 } });
  assert.equal(bad.trials_line_byte_identical, false);
});

test('seal.js orchestrator: invariant → provisional selection-outcome + p* written (never confers authority)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c005-seal-'));
  const censusReport = { report_kind: 'aggregate-census', candidates: [{ source_file: 'r1.json', ...eligAgg('USGS', 'a') }, { source_file: 'r2.json', ...eligAgg('NOAA', 'b') }] };
  const statusByRank = { 1: { status: 'resolved', class: 'class1' }, 2: { status: 'resolved', class: 'class1' }, 3: { status: 'unresolved', class: 'class3' } };
  const r = sealSelection({ repoRoot: REPO_ROOT, evidenceDir: dir, freezeManifestPath: FREEZE, censusReport, pool: POOL, burnedList: { entries: [] }, statusByRank, standIns: STANDINS, primaryN: { n: 87600, classification: 'i' }, write: true });
  assert.equal(r.sealed, true);
  assert.equal(r.fr_d2.invariant, true);
  assert.equal(r.selection_outcome.real_run.primary.rank, 1);
  assert.equal(r.p_star.p_star, '0.99');
  // selection-outcome.json carries NO authority flag (DR-4.5); authority is the chain head's alone
  const outcome = JSON.parse(readFileSync(join(dir, 'selection-outcome.json'), 'utf8'));
  assert.equal('sealed_as_authoritative' in outcome, false);
  assert.equal(outcome.trial_ref, 'c005-e1-primary-001');
});

test('seal.js orchestrator: a blocking unresolved candidate → §9.2-B acquisition-unresolved (no authoritative seal)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c005-seal-'));
  // rank 3 resolved primary-only; rank 1 unresolved ABOVE → blocks
  const censusReport = { report_kind: 'aggregate-census', candidates: [{ source_file: 'r3.json', ...eligAgg('EIA', 'c') }] };
  const statusByRank = { 1: { status: 'unresolved', class: 'class3' }, 2: { status: 'unresolved', class: 'class3' }, 3: { status: 'resolved', class: 'class1' } };
  const r = sealSelection({ repoRoot: REPO_ROOT, evidenceDir: dir, freezeManifestPath: FREEZE, censusReport, pool: POOL, burnedList: { entries: [] }, statusByRank, standIns: STANDINS, write: false });
  assert.equal(r.sealed, false);
  assert.equal(r.disposition_b, 'acquisition-unresolved');
  assert.ok(r.blocking_candidates.length >= 1);
});

test('seal.js: assertSealPreconditions refuses without the Gate-A/G0 records (DR-2)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c005-nogate-'));
  assert.throws(() => assertSealPreconditions({ repoRoot: REPO_ROOT, evidenceDir: dir }), SealHalt);
});
