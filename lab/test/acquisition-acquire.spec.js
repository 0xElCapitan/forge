// lab/test/acquisition-acquire.spec.js
//
// Cycle-005 S01 review-remediation (closes review finding F1 —
// grimoires/loa/a2a/cycle-005/07-cycle-005-s01-review-feedback.md). PRD
// FR-A3/FR-A4/FR-B1; SDD DR-2, DR-3. The Lane A contact-side self-verify
// seatbelt (`acquire.js`) is a deliberate re-implementation of the Lane B
// `identity.js` verifier (G9 forbids importing it) — this spec proves the
// seatbelt REFUSES on the same drift/corruption cases as its Lane B twin,
// that `main()` refuses when Gate-A/G0 records are missing, and that the two
// verifiers are behaviorally equivalent (same companion digest, same
// refusal behavior) so a future edit to either cannot silently diverge
// unnoticed. Temporary synthetic apparatus copies only — the real tree is
// never mutated.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { selfVerifyAcquisitionManifest, assertGateRecordsPresent, main, sha256LF, AcquisitionRefusal } from '../acquisition/acquire.js';
import { verifyAcquisitionIdentity, buildAcquisitionManifest, computeAcquisitionCompanion, companionDigestPath, AcquisitionRefusal as IdentityRefusal } from '../resolution/identity.js';
import { buildAssetInventory, sha256LFNormalized } from '../harness/manifests.js';
import { canonicalize } from '../../src/receipt/canonicalize.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

// Build a small synthetic apparatus tree (mirrors resolution-identity.spec.js's
// synthRepo) and exercise the Lane A seatbelt against it — a temp copy only.
function synthRepo() {
  const root = mkdtempSync(join(tmpdir(), 'c005-acquire-'));
  mkdirSync(join(root, 'sub'), { recursive: true });
  writeFileSync(join(root, 'sub', 'a.js'), 'export const a = 1;\n');
  writeFileSync(join(root, 'sub', 'b.json'), '{"b":2}\n');
  const entries = [
    { path: 'sub/a.js', content: 'export const a = 1;\n' },
    { path: 'sub/b.json', content: '{"b":2}\n' },
  ];
  const manifest = { manifest_kind: 'acquisition', schema_version: '1.0.0', cycle: 'cycle-005', assets: buildAssetInventory(entries), method_set: {}, freeze_ref: { companion_digest: 'sha256:x' }, ledger_baselines: { trials_sha256: null, burn_bytes: 0 } };
  const bytes = canonicalize(manifest) + '\n';
  mkdirSync(join(root, 'evidence'), { recursive: true });
  const manifestPath = join(root, 'evidence', 'acquisition-manifest.json');
  writeFileSync(manifestPath, bytes);
  writeFileSync(companionDigestPath(manifestPath), sha256LFNormalized(bytes) + '\n');
  return { root, manifestPath, evidenceDir: join(root, 'evidence') };
}

// Same synthetic tree, additionally seeded with gate records for main() tests.
function synthMainFixture({ withGateA = true, withG0 = true, drift = false } = {}) {
  const { root, evidenceDir } = synthRepo();
  if (drift) appendFileSync(join(root, 'sub', 'a.js'), '// drift\n');
  if (withGateA) writeFileSync(join(evidenceDir, 'gate-a-acceptance.json'), '{}\n');
  if (withG0) writeFileSync(join(evidenceDir, 'g0-authorization.json'), '{}\n');
  return { root, evidenceDir };
}

// ─── selfVerifyAcquisitionManifest: drift / corruption / absence ──────────────

test('F1/DR-2: selfVerifyAcquisitionManifest passes on an untouched apparatus', () => {
  const { root, manifestPath } = synthRepo();
  const v = selfVerifyAcquisitionManifest({ repoRoot: root, manifestPath });
  assert.equal(v.asset_count, 2);
});

test('F1/DR-2/FR-A4: selfVerifyAcquisitionManifest REFUSES on planted asset drift', () => {
  const { root, manifestPath } = synthRepo();
  appendFileSync(join(root, 'sub', 'a.js'), '// drift\n'); // mutate a hashed asset
  assert.throws(() => selfVerifyAcquisitionManifest({ repoRoot: root, manifestPath }), AcquisitionRefusal);
});

test('F1/DR-2: selfVerifyAcquisitionManifest REFUSES on a corrupted companion', () => {
  const { root, manifestPath } = synthRepo();
  writeFileSync(companionDigestPath(manifestPath), 'sha256:deadbeef\n');
  assert.throws(() => selfVerifyAcquisitionManifest({ repoRoot: root, manifestPath }), AcquisitionRefusal);
});

test('F1/DR-2: selfVerifyAcquisitionManifest REFUSES when the manifest is absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'c005-acquire-nomanifest-'));
  assert.throws(() => selfVerifyAcquisitionManifest({ repoRoot: root, manifestPath: join(root, 'evidence', 'acquisition-manifest.json') }), AcquisitionRefusal);
});

// ─── assertGateRecordsPresent (FR-B1) ─────────────────────────────────────────

test('F1/FR-B1: assertGateRecordsPresent REFUSES when gate-a-acceptance.json is absent', () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), 'c005-acquire-gate-'));
  writeFileSync(join(evidenceDir, 'g0-authorization.json'), '{}\n');
  assert.throws(() => assertGateRecordsPresent(evidenceDir), AcquisitionRefusal);
});

test('F1/FR-B1: assertGateRecordsPresent REFUSES when g0-authorization.json is absent', () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), 'c005-acquire-gate-'));
  writeFileSync(join(evidenceDir, 'gate-a-acceptance.json'), '{}\n');
  assert.throws(() => assertGateRecordsPresent(evidenceDir), AcquisitionRefusal);
});

test('F1/FR-B1: assertGateRecordsPresent passes when both gate records exist', () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), 'c005-acquire-gate-'));
  writeFileSync(join(evidenceDir, 'gate-a-acceptance.json'), '{}\n');
  writeFileSync(join(evidenceDir, 'g0-authorization.json'), '{}\n');
  assert.doesNotThrow(() => assertGateRecordsPresent(evidenceDir));
});

// ─── main() CLI refusal surface ────────────────────────────────────────────────

test('F1: main() refuses (exit 1) when the Gate-A record is absent', async () => {
  const { root, evidenceDir } = synthMainFixture({ withGateA: false, withG0: true });
  let err = '';
  const code = await main([], { repoRoot: root, evidenceDir, stderr: (s) => { err += s; } });
  assert.equal(code, 1);
  assert.match(err, /gate-a-acceptance\.json/);
});

test('F1: main() refuses (exit 1) when the G0 record is absent', async () => {
  const { root, evidenceDir } = synthMainFixture({ withGateA: true, withG0: false });
  let err = '';
  const code = await main([], { repoRoot: root, evidenceDir, stderr: (s) => { err += s; } });
  assert.equal(code, 1);
  assert.match(err, /g0-authorization\.json/);
});

test('F1: main() refuses (exit 1) on apparatus drift even with both gate records present', async () => {
  const { root, evidenceDir } = synthMainFixture({ withGateA: true, withG0: true, drift: true });
  let err = '';
  const code = await main([], { repoRoot: root, evidenceDir, stderr: (s) => { err += s; } });
  assert.equal(code, 1);
  assert.match(err, /drift/i);
});

test('F1: main() passes (exit 0) when self-verify passes and both gate records exist', async () => {
  const { root, evidenceDir } = synthMainFixture({ withGateA: true, withG0: true });
  let err = '';
  const code = await main([], { repoRoot: root, evidenceDir, stderr: (s) => { err += s; } });
  assert.equal(code, 0);
  assert.match(err, /self-verify \+ gate records present/);
});

// ─── Behavioral equivalence: Lane A seatbelt vs Lane B authoritative verifier ──

test('F1: Lane-A and Lane-B verifiers agree on a synthetic apparatus (untouched)', () => {
  const { root, manifestPath } = synthRepo();
  const laneA = selfVerifyAcquisitionManifest({ repoRoot: root, manifestPath });
  const laneB = verifyAcquisitionIdentity({ repoRoot: root, manifestPath });
  assert.equal(laneA.companion_digest, laneB.companion_digest, 'identical companion digest');
  assert.equal(laneA.asset_count, laneB.asset_count);
});

test('F1: Lane-A and Lane-B verifiers both REFUSE the same drifted synthetic apparatus', () => {
  const { root, manifestPath } = synthRepo();
  appendFileSync(join(root, 'sub', 'a.js'), '// drift\n');
  assert.throws(() => selfVerifyAcquisitionManifest({ repoRoot: root, manifestPath }), AcquisitionRefusal);
  assert.throws(() => verifyAcquisitionIdentity({ repoRoot: root, manifestPath }), IdentityRefusal);
});

test('F1: Lane-A seatbelt and Lane-B verifier are equivalent over the accepted Gate-A manifest', () => {
  const manifestPath = join(REPO_ROOT, 'lab/evidence/cycle-005/acquisition-manifest.json');
  if (!existsSync(manifestPath)) return; // generated by Task 1.7; skip if not yet present
  const laneA = selfVerifyAcquisitionManifest({ repoRoot: REPO_ROOT, manifestPath });
  const laneB = verifyAcquisitionIdentity({ repoRoot: REPO_ROOT, manifestPath });
  assert.equal(laneA.companion_digest, laneB.companion_digest, 'Lane A and Lane B compute the identical companion digest');
  assert.equal(laneA.asset_count, laneB.asset_count);
  // and both match a fresh recompute over the current tree (the accepted identity is current).
  assert.equal(laneA.companion_digest, computeAcquisitionCompanion(buildAcquisitionManifest({ repoRoot: REPO_ROOT })));
});

test('F1: sha256LF (acquire.js) and sha256LFNormalized (manifests.js) are the identical primitive', () => {
  const probes = ['', 'a', 'a\r\nb', 'a\rb', 'a\nb', 'µ—✓\r\n', '{"x":1}\n', 'trailing\n'];
  for (const probe of probes) {
    assert.equal(sha256LF(probe), sha256LFNormalized(probe), `divergence on ${JSON.stringify(probe)}`);
  }
  const buf = Buffer.from('x\r\ny');
  assert.equal(sha256LF(buf), sha256LFNormalized(buf), 'Buffer input parity');
});
