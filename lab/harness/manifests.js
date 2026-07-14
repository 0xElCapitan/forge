/**
 * lab/harness/manifests.js
 *
 * Cycle-004 S02 (FR-9a/9c + freeze primitives; SDD Lane L4 + DR-8; Sprint Plan
 * §7.2 T2.5). Content-addressed run manifests, the BI-5 canonical comparison
 * projection, the data-manifest SHAPE (nothing populated this cycle), and the
 * freeze-manifest SHAPE validation + F-7 deterministic asset-enumeration
 * primitives (the S03 builder composes these — NO freeze artifact is written in
 * S02; tests use temp dirs).
 *
 * Content addressing = `sha256(canonicalize(obj))`. Atomic writes reuse the
 * slice-fixtures primitives (temp → flush/close → atomic rename; §8.3.1).
 *
 * @module lab/harness/manifests
 */

import { canonicalize } from '../../src/receipt/canonicalize.js';
import { sha256 } from '../../src/receipt/hash.js';
import { writeCanonicalJsonAtomic, writeTextAtomic } from './slice-fixtures.js';

/** Content address of any JSON-compatible object: `sha256(canonicalize(obj))`. */
export function contentAddress(obj) {
  return sha256(canonicalize(obj));
}

/** The machine-metadata block (excluded from the BI-5 projection). */
export function environmentBlock() {
  return { os: process.platform, node: process.version, arch: process.arch };
}

// ─── Run manifest (content-addressed; run_id self-excluded) ───────────────────

/**
 * Assemble a run manifest per Lane L4. Returns the manifest WITHOUT a `run_id`
 * key — the writer wrapper computes and inserts it (`run_id` is the self-excluded
 * content digest). `freeze: null` is permitted ONLY for pre-freeze synthetic runs.
 *
 * @param {Object} p
 * @param {Object|null} p.freeze
 * @param {Object} p.data - { fixture, data_sha256, span, n }
 * @param {Object} p.config - scientific config block
 * @param {Array<Object>} p.origins - per-origin results (boundaries + method + baselines + scores)
 * @param {Object} p.rejection_metrics
 * @param {Object} [p.environment]
 * @param {Array<Object>} [p.decisions]
 * @returns {Object} manifest without `run_id`
 */
export function buildRunManifest({ freeze = null, data, config, origins, rejection_metrics, environment = environmentBlock(), decisions = [] }) {
  return {
    manifest_kind: 'run',
    schema_version: '1.0.0',
    freeze: freeze === undefined ? null : freeze,
    data,
    config,
    origins,
    rejection_metrics,
    environment,
    decisions,
  };
}

/**
 * The `run_id` = `sha256(canonicalize(manifest with the run_id key removed))`.
 * Accepts a manifest with or without a `run_id` key (it is stripped first).
 */
export function computeRunId(manifest) {
  const { run_id, ...rest } = manifest;
  return contentAddress(rest);
}

/** Insert the self-excluded `run_id` digest into a manifest. */
export function withRunId(manifestWithoutRunId) {
  return { ...manifestWithoutRunId, run_id: computeRunId(manifestWithoutRunId) };
}

/** Verify a manifest's `run_id` equals its self-excluded content digest. */
export function verifyRunId(manifest) {
  return typeof manifest.run_id === 'string' && manifest.run_id === computeRunId(manifest);
}

/** Atomically write a finalized (run_id-bearing) run manifest as canonical JSON. */
export function writeRunManifest(filePath, manifest) {
  validateRunManifest(manifest);
  writeCanonicalJsonAtomic(filePath, manifest);
  return filePath;
}

const FORBIDDEN_KEYS = Object.freeze(['scoring', 'certified', 'admitted', 'calibrated', 'calibration', 'certificate']);

/** Recursively assert no NFR-CEIL forbidden key appears anywhere in an object. */
export function assertNoForbiddenKeys(obj, path = '$') {
  if (obj === null || typeof obj !== 'object') return;
  if (Array.isArray(obj)) { obj.forEach((v, i) => assertNoForbiddenKeys(v, `${path}[${i}]`)); return; }
  for (const k of Object.keys(obj)) {
    if (FORBIDDEN_KEYS.includes(k)) throw new Error(`assertNoForbiddenKeys: forbidden claim-ceiling key "${k}" at ${path}`);
    assertNoForbiddenKeys(obj[k], `${path}.${k}`);
  }
}

/** Fail-closed run-manifest shape validation (DR-5 spec error on breach). */
export function validateRunManifest(m) {
  if (m === null || typeof m !== 'object') throw new Error('run manifest must be an object');
  if (m.manifest_kind !== 'run') throw new Error(`run manifest kind must be "run", got ${m.manifest_kind}`);
  if (m.schema_version !== '1.0.0') throw new Error('run manifest schema_version must be "1.0.0"');
  if (!verifyRunId(m)) throw new Error('run manifest run_id must equal the self-excluded content digest');
  if (!('freeze' in m)) throw new Error('run manifest must carry a freeze field (object or null)');
  if (m.data === null || typeof m.data !== 'object') throw new Error('run manifest data block required');
  if (m.config === null || typeof m.config !== 'object') throw new Error('run manifest config block required');
  if (!Array.isArray(m.origins)) throw new Error('run manifest origins must be an array');
  for (const o of m.origins) {
    for (const f of ['origin_ms', 'training_cutoff_ms', 'purge_gap_ms', 'evaluation_start_ms', 'evaluation_end_ms', 'outcome_count']) {
      if (!Number.isInteger(o[f])) throw new Error(`run manifest origin missing integer field ${f}`);
    }
    if (o.method === null || typeof o.method !== 'object' || typeof o.method.state !== 'string') {
      throw new Error('run manifest origin.method must carry a state');
    }
  }
  if (m.rejection_metrics === null || typeof m.rejection_metrics !== 'object') throw new Error('run manifest rejection_metrics block required');
  if (m.environment === null || typeof m.environment !== 'object') throw new Error('run manifest environment block required');
  assertNoForbiddenKeys(m);
  return true;
}

// ─── BI-5 canonical comparison projection ─────────────────────────────────────

/** True when a string is a machine-local work path (e.g. `lab/out/<run_id>/…`). */
function isWorkPath(s) {
  return typeof s === 'string' && /(^|[\\/])lab[\\/]out[\\/]/.test(s);
}

/**
 * Recursively strip: the `run_id` key, the `environment` block, and any
 * machine-local work path (value under `lab/out/…`). Everything scientific
 * (config, boundaries, estimates, rejections, scores, digests) is kept.
 */
export function projectForBI5(manifest) {
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v !== null && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) {
        if (k === 'run_id' || k === 'environment') continue;         // excluded exactly
        const child = v[k];
        if (isWorkPath(child)) continue;                             // machine-local work path
        out[k] = strip(child);
      }
      return out;
    }
    return v;
  };
  return strip(manifest);
}

/**
 * The BI-5 canonical projection STRING — byte-identical across re-runs with
 * identical config. Excludes exactly `run_id`, `environment`, and machine-local
 * work paths; includes all scientific config/boundaries/estimates/rejections/
 * scores/digests.
 */
export function canonicalProjection(manifest) {
  return canonicalize(projectForBI5(manifest));
}

// ─── Data manifest — SHAPE only (FR-9c; nothing populated this cycle) ─────────

/** The empty data-manifest shape (every real field stays empty this cycle). */
export function buildDataManifestShape() {
  return { manifest_kind: 'data', url: '', fetched_at: null, sha256: null, span: null, n: null, vintage_note: null };
}

/** Validate a data manifest's SHAPE (keys/types) against fabricated values. */
export function validateDataManifestShape(m) {
  if (m === null || typeof m !== 'object') throw new Error('data manifest must be an object');
  if (m.manifest_kind !== 'data') throw new Error('data manifest kind must be "data"');
  for (const k of ['url', 'fetched_at', 'sha256', 'span', 'n', 'vintage_note']) {
    if (!(k in m)) throw new Error(`data manifest missing field ${k}`);
  }
  return true;
}

// ─── Freeze-manifest shape + F-7 deterministic asset enumeration ──────────────

/** `sha256(LF-normalized bytes)` — `\r\n → \n` before hashing (DR-8, §8.3). */
export function sha256LFNormalized(textOrBuffer) {
  const text = Buffer.isBuffer(textOrBuffer) ? textOrBuffer.toString('utf8') : String(textOrBuffer);
  return sha256(text.replace(/\r\n/g, '\n'));
}

/** Normalize a path to repo-relative POSIX form (backslashes → forward). */
export function normalizePosixPath(p) {
  return String(p).replace(/\\/g, '/');
}

/** Reject absolute / `..`-escaping / empty asset paths (DR-8 hard failure). */
export function assertSafeAssetPath(posixPath) {
  if (posixPath.length === 0) throw new Error('asset enumeration: empty asset path');
  if (posixPath.startsWith('/')) throw new Error(`asset enumeration: absolute path forbidden "${posixPath}"`);
  if (/^[A-Za-z]:/.test(posixPath)) throw new Error(`asset enumeration: absolute (drive) path forbidden "${posixPath}"`);
  for (const seg of posixPath.split('/')) {
    if (seg === '..') throw new Error(`asset enumeration: ".."-escaping path forbidden "${posixPath}"`);
  }
}

/**
 * Deterministically sort a set of asset paths (F-7): normalize to repo-relative
 * POSIX, reject unsafe paths, reject duplicate/path-colliding entries, then sort
 * lexicographically — the SOLE ordering authority (never `readdir` order).
 * Windows and Ubuntu produce a byte-identical ordered inventory.
 *
 * @param {string[]} paths
 * @returns {string[]} sorted, normalized, deduped-by-collision paths
 */
export function sortAssetPaths(paths) {
  if (!Array.isArray(paths)) throw new Error('sortAssetPaths: expected an array of paths');
  const seen = new Set();
  const normalized = [];
  for (const raw of paths) {
    const p = normalizePosixPath(raw);
    assertSafeAssetPath(p);
    if (seen.has(p)) throw new Error(`asset enumeration: duplicate/colliding entry "${p}"`);
    seen.add(p);
    normalized.push(p);
  }
  normalized.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return normalized;
}

/**
 * Build a freeze-asset inventory (F-7): expand the given entries, hash each file
 * individually over LF-normalized bytes, and return the lexicographically-sorted
 * `{ path, sha256 }` array. `entries` are `{ path, content, isSymlink? }` records
 * (in-memory synthetic tree for tests; the S03 builder supplies real file bytes).
 * Symlinks, `..`-escapes, absolute, duplicate/colliding, and content-missing
 * entries are hard failures.
 *
 * @param {Array<{path:string, content?:string, isSymlink?:boolean}>} entries
 * @returns {Array<{path:string, sha256:string}>}
 */
export function buildAssetInventory(entries) {
  if (!Array.isArray(entries)) throw new Error('buildAssetInventory: expected an array of entries');
  const byPath = new Map();
  for (const e of entries) {
    if (e === null || typeof e !== 'object') throw new Error('buildAssetInventory: entry must be an object');
    if (e.isSymlink) throw new Error(`asset enumeration: symlink forbidden "${e.path}"`);
    const p = normalizePosixPath(e.path);
    assertSafeAssetPath(p);
    if (byPath.has(p)) throw new Error(`asset enumeration: duplicate/colliding entry "${p}"`);
    if (typeof e.content !== 'string') throw new Error(`asset enumeration: missing content for "${p}"`);
    byPath.set(p, sha256LFNormalized(e.content));
  }
  return [...byPath.keys()]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map(path => ({ path, sha256: byPath.get(path) }));
}

/**
 * Validate a freeze-manifest SHAPE (DR-8) — structure only; no real freeze is
 * built this cycle. Requires `manifest_kind:"freeze"`, a sorted `{path, sha256}`
 * asset array, `grammar_version`, and `algorithm_version`.
 */
export function validateFreezeManifestShape(m) {
  if (m === null || typeof m !== 'object') throw new Error('freeze manifest must be an object');
  if (m.manifest_kind !== 'freeze') throw new Error('freeze manifest kind must be "freeze"');
  if (!Array.isArray(m.assets)) throw new Error('freeze manifest assets must be an array');
  let prev = null;
  for (const a of m.assets) {
    if (a === null || typeof a !== 'object' || typeof a.path !== 'string' || typeof a.sha256 !== 'string') {
      throw new Error('freeze manifest asset must be { path, sha256 }');
    }
    assertSafeAssetPath(normalizePosixPath(a.path));
    if (prev !== null && !(prev < a.path)) throw new Error(`freeze manifest assets must be lexicographically sorted + unique (near "${a.path}")`);
    prev = a.path;
  }
  if (typeof m.grammar_version !== 'string') throw new Error('freeze manifest grammar_version required');
  if (typeof m.algorithm_version !== 'string') throw new Error('freeze manifest algorithm_version required');
  // The `milestone_evidence` block is OPTIONAL in the shape (a pre-S03 freeze
  // manifest carries none); validate it only when present (backward-compatible).
  if ('milestone_evidence' in m) validateMilestoneEvidenceBlock(m.milestone_evidence);
  return true;
}

// ─── Freeze builder (S03 additive; PR-4/PR-5; DR-8; FR-9b) ─────────────────────
// Composes the F-7 enumeration primitives above into the freeze manifest builder.
// The functions are PURE — git state and file bytes are gathered by the thin CLI
// (lab/freeze/build-freeze.js) and passed in; NO real freeze artifact is written by
// this module and the real build is NOT invoked in S03. Tests use temp dirs +
// fabricated evidence (T3.10).

/** The FR-9b pin set (PRD FR-9b; SDD DR-8 point 1; Sprint Plan T3.9). Directory pins
 * expand into individual files at build time; single-file pins are named directly.
 * `src/selector/rules.js` is a single-file pin (NOT all of src/selector). */
export const FR9B_ASSET_SET = Object.freeze({
  files: Object.freeze(['spec/derive-vectors.json', 'src/selector/rules.js', 'lab/preregistration/preregistration.md']),
  dirs: Object.freeze(['lab/census', 'lab/harness', 'src/classifier', 'src/derive']),
});

/** Paths that are NEVER part of the runtime-rehashed assets[] (R-9; DR-8). */
export const FR9B_EXCLUDED_FROM_ASSETS = Object.freeze([
  'lab/test/run-all.js', 'lab/test/*.spec.js', '.github/**', 'lab/ledgers/burn-ledger.jsonl',
  'lab/freeze/build-freeze.js', 'lab/freeze/freeze-manifest.json', 'lab/freeze/freeze-manifest.sha256',
]);

/** The required CI checks that MUST be green at C_pre for both M1 and M2 (Sprint Plan §8.6 step 5). */
export const REQUIRED_CI_CHECKS = Object.freeze([
  'test',
  'kernel-vectors (ubuntu-latest, 20)',
  'kernel-vectors (ubuntu-latest, 24)',
  'kernel-vectors (windows-latest, 20)',
  'kernel-vectors (windows-latest, 24)',
  'lab-check',
]);

/** The milestone-evidence attestation class (procedural-attestation; State-Zone, not rehashed). */
export const MILESTONE_EVIDENCE_CLASS = 'procedural-attestation';

/** A freeze-build refusal — a DR-5 specification error. Thrown before any artifact is produced. */
export class FreezeRefusal extends Error {
  constructor(message) { super(message); this.name = 'FreezeRefusal'; }
}

/**
 * Expand the FR-9b asset set into a sorted, deduped list of repo-relative POSIX paths.
 * `listDirFiles(dir)` returns the repo-relative POSIX paths of the tracked files under a
 * directory (supplied by the CLI via `git ls-files`; injected in tests). Excludes any
 * path in the runtime-exclusion set. The lexicographic sort is the sole ordering authority.
 *
 * @param {{listDirFiles:(dir:string)=>string[]}} io
 * @returns {string[]}
 */
export function enumerateFr9bAssetPaths({ listDirFiles }) {
  if (typeof listDirFiles !== 'function') throw new Error('enumerateFr9bAssetPaths: listDirFiles function required');
  const excluded = new Set(['lab/test/run-all.js', 'lab/ledgers/burn-ledger.jsonl', 'lab/freeze/build-freeze.js', 'lab/freeze/freeze-manifest.json', 'lab/freeze/freeze-manifest.sha256']);
  const isExcluded = (p) => excluded.has(p) || /\.spec\.js$/.test(p) || p.startsWith('.github/') || p.startsWith('lab/test/');
  const collected = [];
  for (const f of FR9B_ASSET_SET.files) collected.push(f);
  for (const d of FR9B_ASSET_SET.dirs) {
    for (const f of listDirFiles(d)) collected.push(normalizePosixPath(f));
  }
  return sortAssetPaths(collected.filter(p => !isExcluded(p)));
}

/**
 * Compute the milestone-evidence block for a State-Zone attestation record.
 * Digest = `sha256(LF-normalized full-file bytes)` (UTF-8, entire file, no rewrite,
 * lowercase-hex `sha256:<hex>`). The record carries no self-digest and no companion file;
 * this block is NOT part of the runtime-rehashed assets[].
 *
 * @param {{path:string, content:string}} record
 * @returns {{path:string, sha256:string, class:string}}
 */
export function computeMilestoneEvidenceBlock({ path, content }) {
  if (typeof path !== 'string' || path.length === 0) throw new Error('computeMilestoneEvidenceBlock: path required');
  if (typeof content !== 'string') throw new Error('computeMilestoneEvidenceBlock: content (file bytes) required');
  return { path, sha256: sha256LFNormalized(content), class: MILESTONE_EVIDENCE_CLASS };
}

/** Validate a milestone-evidence block shape (path, sha256:<hex>, procedural-attestation class). */
export function validateMilestoneEvidenceBlock(block) {
  if (block === null || typeof block !== 'object') throw new Error('milestone_evidence must be an object');
  if (typeof block.path !== 'string' || block.path.length === 0) throw new Error('milestone_evidence.path required');
  if (typeof block.sha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(block.sha256)) throw new Error('milestone_evidence.sha256 must be sha256:<64 lowercase hex>');
  if (block.class !== MILESTONE_EVIDENCE_CLASS) throw new Error(`milestone_evidence.class must be "${MILESTONE_EVIDENCE_CLASS}"`);
  return true;
}

/** Verify a pinned milestone-evidence digest against the record bytes. Throws
 *  {@link FreezeRefusal} on mismatch (the verify-time counterpart to the digest pin). */
export function assertMilestoneDigestMatches(block, recordContent) {
  const recomputed = sha256LFNormalized(recordContent);
  if (block.sha256 !== recomputed) {
    throw new FreezeRefusal(`freeze refuses: milestone-evidence digest mismatch (pinned ${block.sha256} != recomputed ${recomputed})`);
  }
  return true;
}

/**
 * Assemble the freeze manifest from asset entries + versions + the milestone block.
 * Fixed key order; validates shape (including the milestone block). No self-hash.
 *
 * @param {{assetEntries:Array<{path:string,content:string}>, grammar_version:string, algorithm_version:string, milestone_evidence:Object}} p
 * @returns {Object} the freeze manifest
 */
export function assembleFreezeManifest({ assetEntries, grammar_version, algorithm_version, milestone_evidence }) {
  validateMilestoneEvidenceBlock(milestone_evidence);
  const manifest = {
    manifest_kind: 'freeze',
    schema_version: '1.0.0',
    assets: buildAssetInventory(assetEntries),
    grammar_version,
    algorithm_version,
    milestone_evidence,
  };
  validateFreezeManifestShape(manifest);
  return manifest;
}

/** Serialize a freeze manifest to its on-disk bytes (canonical JSON + explicit LF). */
export function serializeFreezeManifest(manifest) {
  return canonicalize(manifest) + '\n';
}

/** The manifest's own digest = `sha256(LF-normalized manifest bytes)`, recorded OUTSIDE
 *  the manifest (companion file + commit trailer). Never stored inside the manifest. */
export function computeManifestCompanionDigest(manifest) {
  return sha256LFNormalized(serializeFreezeManifest(manifest));
}

/**
 * Fail-closed freeze preconditions (DR-8 point 3; AC-19). Throws {@link FreezeRefusal}
 * (DR-5 specification error) on any of: missing M1/M2 evidence; evidence citing a
 * different commit; any required check not green; dirty tree; HEAD mismatch.
 *
 * @param {{gitState:{headSha:string, treeClean:boolean}, evidence:{citedSha:string, m1Present:boolean, m2Present:boolean, checks:Array<{name:string,conclusion:string}>}, freezeTargetSha:string}} p
 */
export function assertFreezePreconditions({ gitState, evidence, freezeTargetSha }) {
  if (typeof freezeTargetSha !== 'string' || freezeTargetSha.length === 0) throw new FreezeRefusal('freeze refuses: freezeTargetSha required');
  if (evidence === null || typeof evidence !== 'object') throw new FreezeRefusal('freeze refuses: milestone evidence required');
  if (!evidence.m1Present) throw new FreezeRefusal('freeze refuses: missing M1 evidence');
  if (!evidence.m2Present) throw new FreezeRefusal('freeze refuses: missing M2 evidence');
  if (evidence.citedSha !== freezeTargetSha) throw new FreezeRefusal(`freeze refuses: evidence cites a different commit (${evidence.citedSha} != ${freezeTargetSha})`);

  const checks = Array.isArray(evidence.checks) ? evidence.checks : [];
  const byName = new Map(checks.map(c => [c.name, c.conclusion]));
  for (const name of REQUIRED_CI_CHECKS) {
    if (!byName.has(name)) throw new FreezeRefusal(`freeze refuses: required check missing/incomplete: ${name}`);
    if (byName.get(name) !== 'success') throw new FreezeRefusal(`freeze refuses: required check not green: ${name} (${byName.get(name)})`);
  }

  if (gitState === null || typeof gitState !== 'object') throw new FreezeRefusal('freeze refuses: git state required');
  if (gitState.treeClean !== true) throw new FreezeRefusal('freeze refuses: dirty working tree');
  if (gitState.headSha !== freezeTargetSha) throw new FreezeRefusal(`freeze refuses: HEAD (${gitState.headSha}) != cited freeze-target SHA (${freezeTargetSha})`);
  return true;
}

/**
 * The composed freeze builder. Asserts preconditions, then assembles the manifest and
 * computes the companion digest. PURE: returns the artifacts, writes nothing (the CLI
 * writes). Refuses (throws {@link FreezeRefusal}) on any precondition failure, producing
 * no partial artifact. NOT invoked against the real repository in S03.
 *
 * @returns {{manifest:Object, manifestBytes:string, companionDigest:string, companionBytes:string}}
 */
export function buildFreezeManifest({ assetEntries, milestoneRecord, grammar_version, algorithm_version, gitState, evidence, freezeTargetSha }) {
  assertFreezePreconditions({ gitState, evidence, freezeTargetSha });
  const milestone_evidence = computeMilestoneEvidenceBlock(milestoneRecord);
  const manifest = assembleFreezeManifest({ assetEntries, grammar_version, algorithm_version, milestone_evidence });
  const manifestBytes = serializeFreezeManifest(manifest);
  const companionDigest = sha256LFNormalized(manifestBytes);
  return { manifest, manifestBytes, companionDigest, companionBytes: companionDigest + '\n' };
}

/**
 * Write the two freeze artifacts atomically (manifest JSON + companion digest). Kept
 * separate from {@link buildFreezeManifest} so the pure build path is testable without
 * touching disk. NOT invoked against lab/freeze/ in S03 (that would create the real
 * artifact — a lifecycle violation). Tests write to temp dirs only.
 */
export function writeFreezeArtifacts({ manifestPath, companionPath, manifestBytes, companionBytes, writeText = writeTextAtomic }) {
  writeText(manifestPath, manifestBytes);
  writeText(companionPath, companionBytes);
  return { manifestPath, companionPath };
}
