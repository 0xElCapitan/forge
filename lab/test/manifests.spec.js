// lab/test/manifests.spec.js
//
// Cycle-004 S02 (FR-9a/9c + freeze primitives + BI-5; SDD Lane L4/DR-8; Sprint
// Plan §7.2 T2.9). Enumeration vector + content addressing + run_id + BI-5
// canonical projection + data/freeze shapes + atomic writes + F-7 hard
// failures. Fabricated/local; zero network; temp-scoped writes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalize } from '../../src/receipt/canonicalize.js';
import { sha256 } from '../../src/receipt/hash.js';
import {
  contentAddress, environmentBlock, buildRunManifest, computeRunId, withRunId, verifyRunId,
  writeRunManifest, validateRunManifest, canonicalProjection, projectForBI5,
  buildDataManifestShape, validateDataManifestShape,
  sha256LFNormalized, normalizePosixPath, assertSafeAssetPath, sortAssetPaths,
  buildAssetInventory, validateFreezeManifestShape,
} from '../harness/manifests.js';
import { writeCanonicalJsonAtomic } from '../harness/slice-fixtures.js';

const SPEC = JSON.parse(readFileSync(fileURLToPath(new URL('../../spec/derive-vectors.json', import.meta.url)), 'utf8'));
const enumVectors = SPEC.vectors.filter(v => v.consumer === 'lab' && v.category === 'manifest-enumeration');

function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-man-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** A minimal but schema-valid run manifest (without run_id). */
function stubManifest(env) {
  return buildRunManifest({
    freeze: null,
    data: { fixture: 'lab/test/fixtures/x.json', data_sha256: 'sha256:00', span: { start_ms: 0, end_ms: 10 }, n: 5 },
    config: { p: '0.5', alpha: '0.05', window: { min_days: 1, n_min: 6 }, H_days: 30, purge_gap_ms: 2592000000 },
    origins: [{ origin_ms: 100, training_cutoff_ms: 90, purge_gap_ms: 10, evaluation_start_ms: 100, evaluation_end_ms: 110, outcome_count: 3, method: { state: 'RANKED_CANDIDATES', value: 4, lo: 3, hi: 5, reason_code: null }, scores: { pinball: { method: 1, naive: 2 } } }],
    rejection_metrics: { eligible_origins: 1, candidate_emitting_origins: 1, rejected_origins: 0, numeric_comparison_coverage: 1, reason_code_distribution: {}, included_origin_ids: [100] },
    environment: env,
  });
}

test('manifest-enumeration vector recomputes to exact deep + digest equality (F-5, F-7)', () => {
  assert.ok(enumVectors.length >= 1);
  for (const v of enumVectors) {
    const computed = sortAssetPaths(v.input.paths);
    assert.deepStrictEqual(computed, v.expected, `${v.id}: sortAssetPaths ordering`);
    assert.equal(sha256(canonicalize(computed)), v.expected_digest, `${v.id}: expected_digest`);
    const { entry_digest, ...rest } = v;
    assert.equal(sha256(canonicalize(rest)), v.entry_digest, `${v.id}: entry_digest`);
  }
});

test('content addressing = sha256(canonicalize(obj)); run_id is the self-excluded digest', () => {
  const m0 = stubManifest({ os: 'linux', node: 'v20', arch: 'x64' });
  const m = withRunId(m0);
  assert.equal(m.run_id, contentAddress(m0), 'run_id = digest of manifest WITHOUT run_id');
  assert.equal(m.run_id, computeRunId(m), 'computeRunId strips run_id first');
  assert.ok(verifyRunId(m), 'run_id verifies');
  const tampered = { ...m, data: { ...m.data, n: 999 } };
  assert.ok(!verifyRunId(tampered), 'mutating a scientific field breaks the run_id');
});

test('BI-5: canonical projection excludes run_id + environment + work paths; identical config ⇒ identical projection', () => {
  const a = withRunId(stubManifest({ os: 'linux', node: 'v20.20.2', arch: 'x64' }));
  const b = withRunId(stubManifest({ os: 'win32', node: 'v24.0.0', arch: 'arm64' }));
  assert.notEqual(canonicalize(a), canonicalize(b), 'full manifests differ by environment + run_id');
  assert.equal(canonicalProjection(a), canonicalProjection(b), 'BI-5 canonical projections are byte-identical');
  const proj = projectForBI5(a);
  assert.ok(!('run_id' in proj) && !('environment' in proj), 'projection excludes run_id + environment');
  // A machine-local work path in a ref is stripped from the projection.
  const withPath = withRunId({ ...stubManifest({ os: 'linux' }), replay_ref: 'lab/out/deadbeef/run-manifest.json' });
  assert.ok(!canonicalProjection(withPath).includes('lab/out/'), 'work paths excluded from the projection');
});

test('validateRunManifest enforces shape and rejects forbidden claim-ceiling keys', () => {
  const m = withRunId(stubManifest({ os: 'linux' }));
  assert.ok(validateRunManifest(m));
  assert.throws(() => validateRunManifest({ ...m, manifest_kind: 'nope' }), /kind must be/);
  assert.throws(() => validateRunManifest({ ...m, run_id: 'sha256:wrong' }), /self-excluded content digest/);
  const forbidden = withRunId({ ...stubManifest({ os: 'linux' }), scoring: { x: 1 } });
  assert.throws(() => validateRunManifest(forbidden), /forbidden claim-ceiling key/);
});

test('BI-5 double run: writeRunManifest is byte-deterministic under identical inputs', () => {
  withTemp((dir) => {
    const m = withRunId(stubManifest(environmentBlock()));
    const p1 = join(dir, 'a', 'run-manifest.json');
    const p2 = join(dir, 'b', 'run-manifest.json');
    writeRunManifest(p1, m);
    writeRunManifest(p2, m);
    assert.equal(readFileSync(p1, 'utf8'), readFileSync(p2, 'utf8'), 'identical manifest ⇒ identical bytes');
    assert.equal(readFileSync(p1, 'utf8'), canonicalize(m) + '\n', 'canonical + explicit LF');
  });
});

test('data manifest is a schema-valid empty shape (nothing populated this cycle)', () => {
  const d = buildDataManifestShape();
  assert.deepStrictEqual(d, { manifest_kind: 'data', url: '', fetched_at: null, sha256: null, span: null, n: null, vintage_note: null });
  assert.ok(validateDataManifestShape(d));
  assert.ok(validateDataManifestShape({ ...d, url: 'https://example/fabricated', n: 42 }), 'validates against fabricated values (shape only)');
});

test('atomic write: canonical + LF; no leftover temp files; overwrite replaces completely', () => {
  withTemp((dir) => {
    const p = join(dir, 'sub', 'm.json');
    writeCanonicalJsonAtomic(p, { b: 2, a: 1 });
    assert.equal(readFileSync(p, 'utf8'), '{"a":1,"b":2}\n', 'sorted keys + LF');
    writeCanonicalJsonAtomic(p, { z: 9 });
    assert.equal(readFileSync(p, 'utf8'), '{"z":9}\n', 'atomic overwrite replaces completely');
    assert.deepStrictEqual(readdirSync(join(dir, 'sub')), ['m.json'], 'no leftover .tmp-* file (rename-into-place)');
  });
});

test('sha256LFNormalized normalizes CRLF→LF before hashing; empty-string known answer', () => {
  assert.equal(sha256LFNormalized(''), 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'known sha256 of empty input');
  assert.equal(sha256LFNormalized('a\r\nb\r\n'), sha256LFNormalized('a\nb\n'), 'CRLF and LF hash identically');
  assert.notEqual(sha256LFNormalized('a\nb'), sha256LFNormalized('a\nb\n'), 'content differences still distinguished');
});

test('F-7 asset enumeration: sorted {path, sha256}; symlink / .. / absolute / colliding are hard failures', () => {
  const entries = [
    { path: 'src/derive/quantile.js', content: 'q' },
    { path: 'lab\\harness\\run.js', content: 'r' },
    { path: 'README.md', content: '# readme' },
  ];
  const inv = buildAssetInventory(entries);
  assert.deepStrictEqual(inv.map(e => e.path), ['README.md', 'lab/harness/run.js', 'src/derive/quantile.js'], 'lexicographic POSIX order');
  assert.ok(inv.every(e => /^sha256:[0-9a-f]{64}$/.test(e.sha256)), 'per-file LF-normalized digests');

  assert.throws(() => buildAssetInventory([{ path: 'x', content: 'a', isSymlink: true }]), /symlink forbidden/);
  assert.throws(() => buildAssetInventory([{ path: '../escape.js', content: 'a' }]), /escaping/);
  assert.throws(() => buildAssetInventory([{ path: '/abs.js', content: 'a' }]), /absolute/);
  assert.throws(() => buildAssetInventory([{ path: 'a/b.js', content: '1' }, { path: 'a\\b.js', content: '2' }]), /duplicate\/colliding/);
  assert.throws(() => buildAssetInventory([{ path: 'C:/win.js', content: 'a' }]), /absolute/);
  assert.throws(() => assertSafeAssetPath(normalizePosixPath('a/../b')), /escaping/);
});

test('freeze-manifest shape validation requires a lexicographically-sorted asset array', () => {
  const good = { manifest_kind: 'freeze', assets: [{ path: 'a.js', sha256: 'sha256:00' }, { path: 'b.js', sha256: 'sha256:01' }], grammar_version: '0.1.0', algorithm_version: '1.0.0' };
  assert.ok(validateFreezeManifestShape(good));
  assert.throws(() => validateFreezeManifestShape({ ...good, assets: [{ path: 'b.js', sha256: 'x' }, { path: 'a.js', sha256: 'y' }] }), /lexicographically sorted/);
  assert.throws(() => validateFreezeManifestShape({ ...good, manifest_kind: 'run' }), /kind must be "freeze"/);
});
