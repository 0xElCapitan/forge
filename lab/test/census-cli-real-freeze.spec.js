// lab/test/census-cli-real-freeze.spec.js
//
// Cycle-005 S01 (PRD FR-A2, FR-C1; SDD DR-9; Sprint Plan T1.8). The FR-A2 closure:
// exercise the frozen census main()/parseArgs CLI path against the REAL freeze-manifest
// reference with fixture metadata — 6/6 census self-asset re-hash + companion (implied
// by exit 0), aggregate report shape, exit 0, DOUBLE-RUN byte identity, and the refusal
// paths (missing manifest / bad companion). Doubles as a standing pinned-asset canary.
// Plus DR-9 census-exec.js subprocess-wrapper coverage (real spawn + injected refusal).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main } from '../census/census.js';
import { runCensusCapture, executeCensus, buildCensusExecutionRecord, metadataFileDigests, CensusExecRefusal } from '../resolution/census-exec.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FREEZE = join(REPO_ROOT, 'lab/freeze/freeze-manifest.json');
const FIXTURE_META = join(REPO_ROOT, 'lab/acquisition/fixtures/census-input-rehearsal');

function runMain(args) {
  let out = ''; let err = '';
  const code = main(args, { stdout: (s) => (out += s), stderr: (s) => (err += s) });
  return { code, out, err };
}

test('FR-A2: frozen census CLI against the REAL freeze + fixture metadata → exit 0, aggregate report', () => {
  const { code, out } = runMain(['--freeze-manifest', FREEZE, '--metadata', FIXTURE_META]);
  assert.equal(code, 0, 'real 6/6 self-integrity + companion passed (exit 0)');
  const report = JSON.parse(out);
  assert.equal(report.report_kind, 'aggregate-census');
  assert.equal(report.candidate_count, 2);
  assert.ok(report.candidates.every(c => typeof c.provider === 'string'));
  // aggregate-only: never a value-level array
  assert.ok(report.candidates.every(c => !('values' in c) && !('data' in c) && !('series' in c)));
});

test('FR-C3: the census CLI output is byte-identical on a double run (determinism)', () => {
  const a = runMain(['--freeze-manifest', FREEZE, '--metadata', FIXTURE_META]).out;
  const b = runMain(['--freeze-manifest', FREEZE, '--metadata', FIXTURE_META]).out;
  assert.equal(a, b, 'double-run byte identity');
});

test('FR-C1 refusal: a missing freeze manifest → exit 1, no stdout', () => {
  const { code, out } = runMain(['--freeze-manifest', join(REPO_ROOT, 'lab/freeze/does-not-exist.json'), '--metadata', FIXTURE_META]);
  assert.equal(code, 1);
  assert.equal(out, '', 'no partial output on refusal');
});

test('FR-C1 refusal: a bad companion digest → exit 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c005-badfreeze-'));
  const badManifest = join(dir, 'freeze-manifest.json');
  copyFileSync(FREEZE, badManifest);
  writeFileSync(join(dir, 'freeze-manifest.sha256'), 'sha256:0000000000000000000000000000000000000000000000000000000000000000\n');
  const { code } = runMain(['--freeze-manifest', badManifest, '--metadata', FIXTURE_META]);
  assert.equal(code, 1, 'companion mismatch refuses');
});

test('DR-9: census-exec runCensusCapture with an injected spawn captures Buffers (no shell)', () => {
  const fakeSpawn = (cmd, args) => ({ status: 0, stdout: Buffer.from('{"report_kind":"aggregate-census"}'), stderr: Buffer.from('') });
  const cap = runCensusCapture({ repoRoot: REPO_ROOT, freezeManifestPath: FREEZE, metadataDir: FIXTURE_META, spawn: fakeSpawn });
  assert.equal(cap.status, 0);
  assert.ok(Buffer.isBuffer(cap.stdout));
  assert.ok(cap.argv.some(a => a.includes('census.js')));
  // No shell redirection tokens are ever constructed.
  assert.ok(!cap.argv.some(a => a.includes('>') || a.includes('|')));
});

test('DR-9: census-exec executeCensus over the REAL subprocess writes verbatim census-result.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c005-cexec-'));
  const resultPath = join(dir, 'census-result.json');
  const { execution, stdout } = executeCensus({
    repoRoot: REPO_ROOT, freezeManifestPath: FREEZE, metadataDir: FIXTURE_META,
    censusResultPath: resultPath, freezeCompanionDigest: 'sha256:anchor',
  });
  assert.equal(execution.exit_code, 0);
  assert.equal(execution.stderr_empty, true);
  assert.equal(readFileSync(resultPath, 'utf8'), stdout.toString('utf8'), 'census-result.json is the verbatim stdout');
  assert.equal(execution.metadata_files.length, 2, 'both fixture metadata files digested');
});

test('DR-9/NFR-HALT: a non-zero census exit is a HALT (never fixed forward)', () => {
  const failSpawn = () => ({ status: 1, stdout: Buffer.from(''), stderr: Buffer.from('CensusRefusal: bad\n') });
  assert.throws(() => executeCensus({
    repoRoot: REPO_ROOT, freezeManifestPath: FREEZE, metadataDir: FIXTURE_META,
    censusResultPath: join(tmpdir(), 'never.json'), freezeCompanionDigest: 'x', spawn: failSpawn,
  }), CensusExecRefusal);
});

test('DR-9: metadataFileDigests + buildCensusExecutionRecord shape', () => {
  const digs = metadataFileDigests(FIXTURE_META);
  assert.equal(digs.length, 2);
  assert.ok(digs.every(d => d.sha256.startsWith('sha256:')));
  const rec = buildCensusExecutionRecord({ argv: ['node'], exit_code: 0, stderr_empty: true, stdout_sha256: 'sha256:x', freeze_companion_digest: 'sha256:y', metadata_files: digs });
  assert.equal(rec.record_kind, 'census-execution');
  assert.equal(rec.exit_code, 0);
});
