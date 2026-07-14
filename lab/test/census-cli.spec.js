// lab/test/census-cli.spec.js
//
// Cycle-004 S03 (FR-11e; AC-5/AC-20; SDD Lane L5:537; DR-8; Sprint Plan T3.5/T3.7).
// Proves the census refuses (non-zero exit, NO partial output) without a valid freeze,
// on a tampered companion digest, and on a tampered pinned asset; that a synthetic run
// over FABRICATED assets in a temp dir + a test-scoped manifest produces AGGREGATE-ONLY
// output; and that no real census-output artifact is ever written (AC-20).
// Fabricated/local; zero network. The real census is NEVER executed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main, runCensus, verifyFreeze, CensusRefusal, CENSUS_SELF_ASSETS, companionDigestPath } from '../census/census.js';
import { sha256LFNormalized } from '../harness/manifests.js';

function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-census-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Build a fabricated temp root: the 6 census self-assets + a valid manifest + companion + metadata dir. */
function scaffold(root, { tamper = null } = {}) {
  const assets = [];
  for (const rel of CENSUS_SELF_ASSETS) {
    const content = `fabricated content of ${rel}\n`;
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    assets.push({ path: rel, sha256: sha256LFNormalized(content) });
  }
  if (tamper === 'asset-digest') assets[0].sha256 = 'sha256:' + '0'.repeat(64);       // pin != actual
  if (tamper === 'asset-missing') { rmSync(join(root, CENSUS_SELF_ASSETS[0])); }        // pinned file gone
  assets.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const manifest = { manifest_kind: 'freeze', assets, grammar_version: '0.1.0', algorithm_version: '1.0.0' };
  const mtext = JSON.stringify(manifest, null, 2);
  const mpath = join(root, 'lab', 'freeze', 'freeze-manifest.json');
  mkdirSync(dirname(mpath), { recursive: true });
  writeFileSync(mpath, tamper === 'malformed-manifest' ? '{ not json' : mtext);
  const companion = tamper === 'bad-companion' ? 'sha256:' + '1'.repeat(64) : sha256LFNormalized(mtext);
  if (tamper !== 'missing-companion') writeFileSync(companionDigestPath(mpath), companion + '\n');
  const mdir = join(root, 'meta');
  mkdirSync(mdir, { recursive: true });
  writeFileSync(join(mdir, 'cand.json'), JSON.stringify({ provider: 'FAB', product: 'fab-series', n_observations: 50000, history_years: 5, span: { start_ms: 0, end_ms: 100 }, cadence: 'fab', values: [1, 2, 3] }));
  return { manifestPath: mpath, metaDir: mdir };
}

test('AC-5: census refuses without --freeze-manifest (non-zero exit, NO partial stdout)', () => {
  let out = '', err = '';
  const code = main([], { stdout: s => (out += s), stderr: s => (err += s) });
  assert.equal(code, 1);
  assert.equal(out, '', 'no partial output on refusal');
  assert.match(err, /--freeze-manifest/);
});

test('AC-5: census refuses when the freeze manifest is absent', () => {
  let out = '';
  const code = main(['--freeze-manifest', '/no/such/manifest.json', '--metadata', '/no/dir'], { stdout: s => (out += s), stderr: () => {} });
  assert.equal(code, 1);
  assert.equal(out, '', 'no partial output');
});

test('AC-5: census refuses on malformed manifest / missing companion / bad companion digest', () => {
  for (const tamper of ['malformed-manifest', 'missing-companion', 'bad-companion']) {
    withTemp((root) => {
      const { manifestPath, metaDir } = scaffold(root, { tamper });
      assert.throws(() => runCensus({ freezeManifest: manifestPath, metadata: metaDir, repoRoot: root }), CensusRefusal, `refuses on ${tamper}`);
    });
  }
});

test('AC-5: census refuses on a missing pinned asset and on a tampered pinned asset digest', () => {
  withTemp((root) => {
    const { manifestPath, metaDir } = scaffold(root, { tamper: 'asset-missing' });
    assert.throws(() => runCensus({ freezeManifest: manifestPath, metadata: metaDir, repoRoot: root }), /pinned census asset missing/);
  });
  withTemp((root) => {
    const { manifestPath, metaDir } = scaffold(root, { tamper: 'asset-digest' });
    assert.throws(() => runCensus({ freezeManifest: manifestPath, metadata: metaDir, repoRoot: root }), /digest mismatch/);
  });
});

test('AC-5: synthetic success over fabricated assets + test-scoped manifest => aggregate-only output', () => {
  withTemp((root) => {
    const { manifestPath, metaDir } = scaffold(root);
    const report = runCensus({ freezeManifest: manifestPath, metadata: metaDir, repoRoot: root });
    assert.equal(report.report_kind, 'aggregate-census');
    assert.equal(report.candidate_count, 1);
    const c = report.candidates[0];
    assert.equal('values' in c, false, 'value-level series stripped (aggregate-only)');
    assert.equal(c.n_observations, 50000);
    assert.ok('span' in c && 'cadence' in c, 'aggregate fields retained');
  });
});

test('AC-20: no real census-output artifact is ever written (the run is in-memory only)', () => {
  withTemp((root) => {
    const { manifestPath, metaDir } = scaffold(root);
    const before = readdirSync(root).sort();
    runCensus({ freezeManifest: manifestPath, metadata: metaDir, repoRoot: root });
    const after = readdirSync(root).sort();
    assert.deepStrictEqual(after, before, 'the census writes no artifact to disk');
  });
  // Structural: census.js source contains no filesystem-WRITE calls.
  const src = readFileSync(fileURLToPath(new URL('../census/census.js', import.meta.url)), 'utf8');
  assert.doesNotMatch(src, /writeFileSync|appendFileSync|writeCanonicalJsonAtomic|writeTextAtomic|createWriteStream/, 'census.js performs no writes');
});

test('verifyFreeze returns the manifest on a valid test-scoped freeze', () => {
  withTemp((root) => {
    const { manifestPath } = scaffold(root);
    const m = verifyFreeze({ freezeManifestPath: manifestPath, repoRoot: root });
    assert.equal(m.manifest_kind, 'freeze');
  });
});
