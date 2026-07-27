// lab/test/resolution-identity.spec.js
//
// Cycle-005 S01 (PRD FR-A3/FR-A4, FR-E1; SDD DR-2; Sprint Plan T1.8). DR-2
// acquisition-manifest build determinism + the self-verify-before-contact refusal on
// planted drift (temp-copy mutation), and the committed Gate-A identity self-verifies
// against the live apparatus tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAcquisitionManifest, serializeAcquisitionManifest, verifyAcquisitionIdentity, companionDigestPath, AcquisitionRefusal } from '../resolution/identity.js';
import { buildAssetInventory, sha256LFNormalized } from '../harness/manifests.js';
import { canonicalize } from '../../src/receipt/canonicalize.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('DR-2: buildAcquisitionManifest is deterministic (byte-identical over the real tree)', () => {
  const a = serializeAcquisitionManifest(buildAcquisitionManifest({ repoRoot: REPO_ROOT }));
  const b = serializeAcquisitionManifest(buildAcquisitionManifest({ repoRoot: REPO_ROOT }));
  assert.equal(a, b, 'two builds over the same tree are byte-identical');
});

test('DR-2: the manifest enumerates both namespaces + anchors the freeze + ledger baselines', () => {
  const m = buildAcquisitionManifest({ repoRoot: REPO_ROOT });
  assert.equal(m.manifest_kind, 'acquisition');
  assert.ok(m.assets.some(a => a.path.startsWith('lab/acquisition/')), 'acquisition assets enumerated');
  assert.ok(m.assets.some(a => a.path.startsWith('lab/resolution/')), 'resolution assets enumerated');
  assert.ok(m.method_set && m.method_set.candidates, 'method set embedded (DR-8/DR-7)');
  assert.match(m.freeze_ref.companion_digest, /^sha256:d0c0f0cf/, 'anchored to the Cycle-004 freeze companion');
  assert.equal(m.ledger_baselines.burn_bytes, 0, 'burn ledger 0-byte baseline');
  assert.ok(m.ledger_baselines.trials_sha256.startsWith('sha256:'), 'trials baseline digest recorded');
  // assets never include the manifest pair itself (self-exclusion).
  assert.ok(!m.assets.some(a => a.path.includes('acquisition-manifest')));
});

// Build a small synthetic apparatus tree in a temp repo and exercise verify + drift.
function synthRepo() {
  const root = mkdtempSync(join(tmpdir(), 'c005-ident-'));
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
  return { root, manifestPath };
}

test('DR-2: verifyAcquisitionIdentity passes on an untouched apparatus', () => {
  const { root, manifestPath } = synthRepo();
  const v = verifyAcquisitionIdentity({ repoRoot: root, manifestPath });
  assert.equal(v.asset_count, 2);
});

test('DR-2/FR-A4: verifyAcquisitionIdentity REFUSES on planted asset drift', () => {
  const { root, manifestPath } = synthRepo();
  appendFileSync(join(root, 'sub', 'a.js'), '// drift\n'); // mutate a hashed asset
  assert.throws(() => verifyAcquisitionIdentity({ repoRoot: root, manifestPath }), AcquisitionRefusal);
});

test('DR-2: verifyAcquisitionIdentity REFUSES on a corrupted companion', () => {
  const { root, manifestPath } = synthRepo();
  writeFileSync(companionDigestPath(manifestPath), 'sha256:deadbeef\n');
  assert.throws(() => verifyAcquisitionIdentity({ repoRoot: root, manifestPath }), AcquisitionRefusal);
});

// FR-A4 STALE-AUTHORITY-BY-DESIGN (Cycle-006 α supersession; Sprint Plan SP-F2, SDD
// DR-12.3). This canary formerly recomputed the apparatus identity over the LIVE tree
// and asserted equality with the committed Cycle-005 manifest. Cycle-006 edits the
// apparatus IN PLACE under shape α to a NEW identity, so that equality is FALSE BY
// DESIGN from the first α edit onward: the Cycle-005 identity is deliberately STALE for
// the α tree, and its refusal there is the safety property (C6-FR-A4/B5), not a defect.
// Authority over the HISTORICAL record is therefore asserted from COMMITTED BYTES — the
// manifest file's own digest, its companion file, and the digest the Cycle-005 evidence
// chain records — never from a live-tree recompute. Supersession is only ever by a new
// artifact at a new path (C6-FR-E2); these bytes stay byte-identical forever.
test('DR-2/FR-A4: the COMMITTED Gate-A identity verifies from its own BYTES (byte-form canary)', () => {
  const manifestPath = join(REPO_ROOT, 'lab/evidence/cycle-005/acquisition-manifest.json');
  if (!existsSync(manifestPath)) return; // generated by Task 1.7; skip if not yet present
  const bytes = readFileSync(manifestPath, 'utf8');

  // (a) the committed companion FILE digests exactly the committed manifest FILE bytes
  const companion = readFileSync(companionDigestPath(manifestPath), 'utf8').trim();
  assert.equal(companion, sha256LFNormalized(bytes), 'the committed companion digests the committed manifest bytes');
  // (b) …and that digest IS the accepted Cycle-005 apparatus identity
  assert.equal(companion, 'sha256:073c7ff2d5acb6db548bddd34e34de4e65eaeaaff31a6051cdc05ccfddb8e4c6');
  // (c) the Cycle-005 evidence chain records the same bytes for the same path
  const head = JSON.parse(readFileSync(join(REPO_ROOT, 'lab/evidence/cycle-005/terminal-disposition.json'), 'utf8'));
  const link = head.chain.find(l => l.path === 'lab/evidence/cycle-005/acquisition-manifest.json');
  assert.equal(link.sha256, sha256LFNormalized(bytes), 'the chain link is byte-identical to the committed manifest');
  // (d) the accepted apparatus is the recorded 23-asset set over both namespaces
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.assets.length, 23);
  assert.ok(manifest.assets.some(a => a.path.startsWith('lab/acquisition/')) && manifest.assets.some(a => a.path.startsWith('lab/resolution/')));
});

test('C6-FR-E2: unauthorized mutation of the committed historical manifest is still detected', () => {
  const manifestPath = join(REPO_ROOT, 'lab/evidence/cycle-005/acquisition-manifest.json');
  if (!existsSync(manifestPath)) return;
  const original = readFileSync(manifestPath, 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'c005-hist-'));
  const copy = join(dir, 'acquisition-manifest.json');
  writeFileSync(copy, original);
  writeFileSync(companionDigestPath(copy), sha256LFNormalized(original) + '\n');
  assert.equal(readFileSync(companionDigestPath(copy), 'utf8').trim(), sha256LFNormalized(readFileSync(copy, 'utf8')));

  // plant a byte-level edit in the copy — the companion no longer digests it
  writeFileSync(copy, original.replace('"assets"', '"assets "'));
  assert.notEqual(readFileSync(companionDigestPath(copy), 'utf8').trim(), sha256LFNormalized(readFileSync(copy, 'utf8')));
  // …and the real committed pair is untouched by this test
  assert.equal(readFileSync(manifestPath, 'utf8'), original);
});
