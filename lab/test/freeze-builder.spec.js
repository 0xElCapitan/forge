// lab/test/freeze-builder.spec.js
//
// Cycle-004 S03 (PR-4/PR-5; FR-9b/FR-13; DR-8; AC-18/AC-19/AC-21; Sprint Plan T3.9/T3.10).
// Proves the freeze-builder functions in lab/harness/manifests.js and the thin CLI in
// lab/freeze/build-freeze.js: deterministic enumeration + manifest construction; companion
// digest + no self-reference; milestone-evidence digest round-trip; the fail-closed refusal
// battery; asset-enumeration anomaly rejection; AC-18 manifest schema; AC-19 preregistration
// verbatim thresholds; AC-21 burn-ledger byte-emptiness; and the exactly-one-primary trials
// invariant. Temp dirs + fabricated evidence. The REAL freeze build is NEVER invoked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FR9B_ASSET_SET, FR9B_EXCLUDED_FROM_ASSETS, REQUIRED_CI_CHECKS, MILESTONE_EVIDENCE_CLASS,
  enumerateFr9bAssetPaths, computeMilestoneEvidenceBlock, validateMilestoneEvidenceBlock,
  assertMilestoneDigestMatches, assembleFreezeManifest, serializeFreezeManifest,
  computeManifestCompanionDigest, assertFreezePreconditions, buildFreezeManifest,
  buildAssetInventory, validateFreezeManifestShape, sha256LFNormalized, FreezeRefusal,
} from '../harness/manifests.js';
import { buildFreeze, isTrackedTreeClean } from '../freeze/build-freeze.js';
import { readLedger, TRIALS_LEDGER_PATH, BURN_LEDGER_PATH } from '../harness/ledgers.js';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SHA = 'a'.repeat(40);
const goodChecks = () => REQUIRED_CI_CHECKS.map(name => ({ name, conclusion: 'success' }));
const goodEvidence = () => ({ citedSha: SHA, m1Present: true, m2Present: true, checks: goodChecks() });
const goodGit = () => ({ headSha: SHA, treeClean: true });
const assetEntries = () => [
  { path: 'src/derive/kernel.js', content: 'kernel\n' },
  { path: 'lab/census/burned-list.json', content: 'bl\n' },
  { path: 'spec/derive-vectors.json', content: 'dv\n' },
];
const milestoneRecord = () => ({ path: 'grimoires/loa/a2a/cycle-004/20-s03-milestone-evidence-record.md', content: '# evidence\n' });
const fullBuildArgs = () => ({ assetEntries: assetEntries(), milestoneRecord: milestoneRecord(), grammar_version: '0.1.0', algorithm_version: '1.0.0', gitState: goodGit(), evidence: goodEvidence(), freezeTargetSha: SHA });

// ─── Enumeration + construction determinism ───────────────────────────────────

test('deterministic FR-9b enumeration: sorted, single-file pins present, exclusions applied', () => {
  const listDirFiles = (dir) => ({
    'lab/census': ['lab/census/census.js', 'lab/census/burned-list.json', 'lab/census/fixtures/pass.json'],
    'lab/harness': ['lab/harness/manifests.js', 'lab/harness/run.js'],
    'src/classifier': ['src/classifier/cadence.js'],
    'src/derive': ['src/derive/kernel.js', 'src/derive/quantile.js'],
  })[dir] || [];
  const a = enumerateFr9bAssetPaths({ listDirFiles });
  const b = enumerateFr9bAssetPaths({ listDirFiles });
  assert.deepStrictEqual(a, b, 'deterministic');
  assert.deepStrictEqual(a, a.slice().sort(), 'lexicographically sorted');
  for (const f of FR9B_ASSET_SET.files) assert.ok(a.includes(f), `single-file pin present: ${f}`);
  assert.ok(a.includes('lab/census/census.js') && a.includes('src/derive/quantile.js'), 'dir pins expanded');
});

test('deterministic manifest construction: identical inputs => byte-identical manifest bytes', () => {
  const m1 = assembleFreezeManifest({ assetEntries: assetEntries(), grammar_version: '0.1.0', algorithm_version: '1.0.0', milestone_evidence: computeMilestoneEvidenceBlock(milestoneRecord()) });
  const m2 = assembleFreezeManifest({ assetEntries: assetEntries(), grammar_version: '0.1.0', algorithm_version: '1.0.0', milestone_evidence: computeMilestoneEvidenceBlock(milestoneRecord()) });
  assert.equal(serializeFreezeManifest(m1), serializeFreezeManifest(m2), 'canonical + deterministic');
  assert.equal(serializeFreezeManifest(m1).endsWith('\n'), true, 'explicit trailing LF');
});

test('companion digest = sha256(LF-normalized manifest bytes); manifest carries NO self-reference', () => {
  const built = buildFreezeManifest(fullBuildArgs());
  assert.equal(built.companionDigest, sha256LFNormalized(built.manifestBytes), 'companion digest over manifest bytes');
  assert.match(built.companionDigest, /^sha256:[0-9a-f]{64}$/, 'prefixed lowercase hex');
  assert.equal('sha256' in built.manifest, false, 'no top-level self-hash');
  assert.ok(!built.manifestBytes.includes(built.companionDigest), 'the manifest never contains its own digest');
  assert.equal(built.companionBytes, built.companionDigest + '\n', 'companion file is one line + LF');
});

// ─── Milestone evidence ───────────────────────────────────────────────────────

test('milestone-evidence digest round-trip (R-5); tampering the record changes the digest', () => {
  const rec = milestoneRecord();
  const block = computeMilestoneEvidenceBlock(rec);
  assert.equal(block.class, MILESTONE_EVIDENCE_CLASS);
  assert.equal(block.sha256, sha256LFNormalized(rec.content));
  assert.ok(validateMilestoneEvidenceBlock(block));
  assert.doesNotThrow(() => assertMilestoneDigestMatches(block, rec.content));
  assert.throws(() => assertMilestoneDigestMatches(block, rec.content + 'tamper'), /milestone-evidence digest mismatch/);
});

test('the milestone_evidence block is NOT part of the runtime-rehashed assets[]', () => {
  const built = buildFreezeManifest(fullBuildArgs());
  assert.ok('milestone_evidence' in built.manifest, 'block present');
  assert.ok(!built.manifest.assets.some(a => a.path.includes('milestone-evidence')), 'evidence record is not an asset entry');
  assert.ok(!built.manifest.assets.some(a => a.path.startsWith('grimoires/')), 'no State-Zone path in assets[]');
});

// ─── Fail-closed refusal battery ──────────────────────────────────────────────

test('builder refuses on dirty tree / HEAD mismatch / missing M1 / missing M2 / wrong commit / failed check / incomplete check', () => {
  const cases = {
    'dirty-tree': { ...fullBuildArgs(), gitState: { headSha: SHA, treeClean: false } },
    'head-mismatch': { ...fullBuildArgs(), gitState: { headSha: 'b'.repeat(40), treeClean: true } },
    'missing-M1': { ...fullBuildArgs(), evidence: { ...goodEvidence(), m1Present: false } },
    'missing-M2': { ...fullBuildArgs(), evidence: { ...goodEvidence(), m2Present: false } },
    'wrong-commit': { ...fullBuildArgs(), evidence: { ...goodEvidence(), citedSha: 'c'.repeat(40) } },
    'failed-check': { ...fullBuildArgs(), evidence: { ...goodEvidence(), checks: goodChecks().map((c, i) => (i === 0 ? { ...c, conclusion: 'failure' } : c)) } },
    'incomplete-check': { ...fullBuildArgs(), evidence: { ...goodEvidence(), checks: goodChecks().slice(1) } },
  };
  for (const [label, args] of Object.entries(cases)) {
    assert.throws(() => buildFreezeManifest(args), FreezeRefusal, `refuses on ${label}`);
  }
});

test('asset-enumeration anomalies are hard failures (missing/duplicate/absolute/escape/collision/symlink)', () => {
  assert.throws(() => buildAssetInventory([{ path: 'a.js' }]), /missing content/);
  assert.throws(() => buildAssetInventory([{ path: 'a.js', content: '1' }, { path: 'a.js', content: '2' }]), /duplicate\/colliding/);
  assert.throws(() => buildAssetInventory([{ path: '/abs.js', content: '1' }]), /absolute/);
  assert.throws(() => buildAssetInventory([{ path: '../escape.js', content: '1' }]), /escaping/);
  assert.throws(() => buildAssetInventory([{ path: 'a/b.js', content: '1' }, { path: 'a\\b.js', content: '2' }]), /duplicate\/colliding/);
  assert.throws(() => buildAssetInventory([{ path: 'x.js', content: '1', isSymlink: true }]), /symlink forbidden/);
});

// ─── AC-18 / AC-19 / AC-21 + trials invariant ─────────────────────────────────

test('AC-18: the built freeze manifest is schema-valid and pins { path, sha256 } assets', () => {
  const built = buildFreezeManifest(fullBuildArgs());
  assert.ok(validateFreezeManifestShape(built.manifest));
  assert.equal(built.manifest.manifest_kind, 'freeze');
  assert.equal(built.manifest.grammar_version, '0.1.0');
  assert.equal(built.manifest.algorithm_version, '1.0.0');
  for (const a of built.manifest.assets) assert.match(a.sha256, /^sha256:[0-9a-f]{64}$/);
});

// AC-19 — PRD §10 pass/fail thresholds must appear VERBATIM in preregistration.md. The
// expected strings are pinned here as \u-escaped literals authored from the binding PRD at
// implementation time (the PRD is gitignored / unavailable in CI); verified against the PRD
// first-hand at the review gate.
// Non-ASCII pinned as \u escapes (ASCII source) so the literals are byte-identical to the
// verbatim PRD bytes in preregistration.md regardless of editor/glyph handling.
const AC19_THRESHOLDS = [
  "- **Median per-origin pinball improvement > 0** against the **naive expanding-window baseline** (the primary comparison that carries the evidence) **and > 0 against the legacy transplanted constant** (necessary, never the headline).",
  "- **Sign test p ≤ 0.05** across origins.",
  "- **Exceedance calibration within the frozen 95% binomial band** against target `1−p*`.",
  "- **Correct constructed rejection behavior** (100%/0% per AC-11 semantics, on the held-out starved variants).",
  "- **Cross-runtime byte identity** of outputs/digests.",
  "- **Zero post-freeze pin violations.**",
  "- Losing to the persistence baseline downgrades PASS → PARTIAL (arch §9:284; recon §6:140). The seven pre-committed outcome branches and their follow-on cycles are arch §10:291-306; the decision is evaluated mechanically from the run manifest (C-005 M7).",
];
const AC19_VOID = [
  "1. Any post-freeze edit to a pinned asset.",
  "6. Any candidate-data contact before M3.",
];

test('AC-19: preregistration.md contains the PRD §10 thresholds (and §11 void conditions) VERBATIM', () => {
  const pre = readFileSync(join(REPO, 'lab/preregistration/preregistration.md'), 'utf8');
  for (const line of AC19_THRESHOLDS) assert.ok(pre.includes(line), `threshold present verbatim: ${line.slice(0, 48)}...`);
  for (const line of AC19_VOID) assert.ok(pre.includes(line), `void condition present verbatim: ${line}`);
  assert.ok(pre.includes('n_min') && pre.includes('= 59'), 'frozen n_min pinned');
  assert.ok(pre.includes('Experiment ordering') && pre.includes('E2') && pre.includes('E1'), 'E2 -> E1 ordering pinned');
});

test('AC-21 + FR-10: burn ledger is byte-empty; trials ledger holds exactly one primary', () => {
  assert.equal(statSync(join(REPO, BURN_LEDGER_PATH)).size, 0, 'burn ledger is byte-empty');
  const trials = readLedger(join(REPO, TRIALS_LEDGER_PATH));
  assert.equal(trials.length, 1, 'exactly one trials record');
  assert.equal(trials.filter(t => t.status === 'primary').length, 1, 'exactly one primary');
  assert.equal(trials[0].parameter, 'threshold');
  assert.equal(trials[0].score, 'pinball');
  assert.equal(Number.isInteger(trials[0].registered_at_ms), true, 'registered_at_ms is an integer (pinned, never wall clock)');
});

// ─── Thin CLI (lab/freeze/build-freeze.js) ────────────────────────────────────

function cliIo(overrides = {}) {
  const dirFiles = { 'lab/census': ['lab/census/burned-list.json'], 'lab/harness': ['lab/harness/manifests.js'], 'src/classifier': ['src/classifier/cadence.js'], 'src/derive': ['src/derive/kernel.js'] };
  let n = 0;
  return {
    gitHeadSha: () => SHA,
    gitTreeClean: () => true,
    listDirFiles: (d) => dirFiles[d] || [],
    readFile: (p) => (p === '/rec.md' ? '# M3 evidence\n' : 'bytes-' + (n++) + '\n'),
    fileExists: (p) => p === '/rec.md',
    ...overrides,
  };
}

test('CLI builds freeze artifacts into a temp dir from injected inputs (real repo untouched)', () => {
  const out = mkdtempSync(join(tmpdir(), 'forge-freeze-cli-'));
  try {
    const built = buildFreeze({ repoRoot: '/repo', freezeDir: out, milestoneRecordPath: '/rec.md', milestoneRecordRepoRel: 'grimoires/loa/a2a/cycle-004/20-s03-milestone-evidence-record.md', evidence: goodEvidence(), freezeTargetSha: SHA, io: cliIo() });
    assert.ok(existsSync(join(out, 'freeze-manifest.json')) && existsSync(join(out, 'freeze-manifest.sha256')), 'both artifacts written');
    assert.equal(readFileSync(join(out, 'freeze-manifest.sha256'), 'utf8').trim(), built.companionDigest);
    assert.equal(built.manifest.grammar_version, '0.1.0');
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('CLI refuses on a missing or empty milestone record', () => {
  assert.throws(() => buildFreeze({ repoRoot: '/repo', freezeDir: '/x', milestoneRecordPath: '/nope.md', milestoneRecordRepoRel: 'x', evidence: goodEvidence(), freezeTargetSha: SHA, io: cliIo({ fileExists: () => false }), write: false }), /milestone-evidence record not found/);
  assert.throws(() => buildFreeze({ repoRoot: '/repo', freezeDir: '/x', milestoneRecordPath: '/rec.md', milestoneRecordRepoRel: 'x', evidence: goodEvidence(), freezeTargetSha: SHA, io: cliIo({ readFile: () => '   ' }), write: false }), /empty\/malformed/);
});

test('CLI propagates builder refusals (dirty tree) and writes nothing', () => {
  const out = mkdtempSync(join(tmpdir(), 'forge-freeze-cli-'));
  try {
    assert.throws(() => buildFreeze({ repoRoot: '/repo', freezeDir: out, milestoneRecordPath: '/rec.md', milestoneRecordRepoRel: 'x', evidence: goodEvidence(), freezeTargetSha: SHA, io: cliIo({ gitTreeClean: () => false }) }), /dirty working tree/);
    assert.equal(readdirSync(out).length, 0, 'no artifact written on refusal');
  } finally { rmSync(out, { recursive: true, force: true }); }
});

// cycle-004 post-M3 cleanup: the original assertion here checked the REAL repo root for the
// absence of lab/freeze/freeze-manifest.json/.sha256, which was phase-correct only during the
// S03 pre-freeze window. The accepted C_freeze commit legitimately created those files on landed
// master (final freeze review PASS / final freeze audit PASS / M3 acceptance), so that repo-root
// check is now stale by design, not a freeze-correctness regression (classified NON-BLOCKING
// PHASE GUARD). The safety property worth keeping — the builder must not silently leave real
// freeze artifacts behind before it is legitimately invoked — is re-exercised below in an
// isolated freezeDir, decoupled from the real repo's evolving phase, using the same buildFreeze()
// + cliIo() harness as the "Thin CLI" tests above.
test('builder CLI is tracked + excluded from assets[]; freeze artifacts are not silently pre-populated before a legitimate build (pre-freeze absence invariant, isolated)', () => {
  assert.ok(existsSync(join(REPO, 'lab/freeze/build-freeze.js')), 'the builder CLI exists');
  assert.ok(Array.isArray(FR9B_EXCLUDED_FROM_ASSETS) && FR9B_EXCLUDED_FROM_ASSETS.includes('lab/freeze/build-freeze.js'), 'the CLI is excluded from assets[]');

  const out = mkdtempSync(join(tmpdir(), 'forge-freeze-prefreeze-'));
  try {
    assert.equal(existsSync(join(out, 'freeze-manifest.json')), false, 'no freeze-manifest.json before build');
    assert.equal(existsSync(join(out, 'freeze-manifest.sha256')), false, 'no companion digest before build');
    buildFreeze({ repoRoot: '/repo', freezeDir: out, milestoneRecordPath: '/rec.md', milestoneRecordRepoRel: 'x', evidence: goodEvidence(), freezeTargetSha: SHA, io: cliIo() });
    assert.equal(existsSync(join(out, 'freeze-manifest.json')), true, 'freeze-manifest.json exists once legitimately built');
    assert.equal(existsSync(join(out, 'freeze-manifest.sha256')), true, 'companion digest exists once legitimately built');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

// ─── Tracked-tree cleanliness: real git-backed regression ─────────────────────
// Exercises the SAME helper the CLI wires into gitTreeClean, against a throwaway
// LOCAL git repo (no network, no remote, real FORGE tree untouched). Regression
// for the pre-freeze review finding: an unrelated pre-existing UNTRACKED file
// (.agents/ / .codex/ / AGENTS.md class) must NOT make the freeze refuse, while
// any tracked dirtiness (modified / staged / deleted) still refuses.
test('isTrackedTreeClean (real git): untracked-only stays clean; modified/staged/deleted tracked refuse', () => {
  const repo = mkdtempSync(join(tmpdir(), 'forge-tracked-clean-'));
  // Fixed executable, fixed args, execFileSync, no shell, no remote. stderr ignored
  // (suppresses git's init hint); a non-zero exit still throws and fails the test.
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    git(['init', '-q']);
    git(['config', 'user.email', 'test@forge.local']);
    git(['config', 'user.name', 'forge-test']);
    git(['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(repo, 'tracked.txt'), 'v1\n');
    git(['add', 'tracked.txt']);
    git(['commit', '-q', '--no-verify', '-m', 'init']);

    // Case 1 — clean tracked tree → clean
    assert.equal(isTrackedTreeClean(repo), true, 'case 1: clean tracked tree is clean');

    // Case 2 — untracked file ONLY → still clean (the exact regression for the finding)
    writeFileSync(join(repo, 'stray-untracked.txt'), 'unrelated\n');
    assert.equal(isTrackedTreeClean(repo), true, 'case 2: untracked-only tree is still clean');

    // Case 3 — modified tracked file → dirty
    writeFileSync(join(repo, 'tracked.txt'), 'v2\n');
    assert.equal(isTrackedTreeClean(repo), false, 'case 3: modified tracked file refuses');

    // Case 4 — staged tracked change → dirty
    git(['add', 'tracked.txt']);
    assert.equal(isTrackedTreeClean(repo), false, 'case 4: staged tracked change refuses');

    // Case 5 — tracked deletion → dirty (commit the clean state first; untracked file still present)
    git(['commit', '-q', '--no-verify', '-m', 'v2']);
    assert.equal(isTrackedTreeClean(repo), true, 'case 5a: clean again after commit (untracked still ignored)');
    rmSync(join(repo, 'tracked.txt'));
    assert.equal(isTrackedTreeClean(repo), false, 'case 5b: tracked deletion refuses');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
