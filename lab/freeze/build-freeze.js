/**
 * lab/freeze/build-freeze.js
 *
 * Cycle-004 S03 (PR-4; Sprint Plan T3.10; SDD DR-8). The THIN operator-invocable CLI
 * over the freeze-builder FUNCTIONS in lab/harness/manifests.js. This file contains NO
 * freeze logic of its own — it only gathers real inputs (git state, tracked file bytes,
 * the milestone-evidence record, the structured evidence) and delegates to
 * `buildFreezeManifest` / `writeFreezeArtifacts`.
 *
 * LIFECYCLE GUARD: the real freeze build (writing lab/freeze/freeze-manifest.json + its
 * companion digest) occurs ONLY after the pre-freeze commit C_pre and accepted M1/M2
 * milestone evidence. This CLI must NOT be invoked against the real repository during the
 * S03 pre-freeze implementation phase — doing so would create the real freeze artifact
 * early, a lifecycle violation. It is exercised only by tests, over temp dirs + fabricated
 * evidence (T3.10).
 *
 * @module lab/freeze/build-freeze
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildFreezeManifest, writeFreezeArtifacts, enumerateFr9bAssetPaths, FreezeRefusal } from '../harness/manifests.js';

/** Repo root = two directories up from lab/freeze/. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** grammar_version = CLASSIFIER_VERSION (src/ir/emit.js:30); algorithm_version = ALGORITHM_VERSION (src/derive/kernel.js:30). */
export const GRAMMAR_VERSION = '0.1.0';
export const ALGORITHM_VERSION = '1.0.0';

/** The tracked freeze artifacts (created only by the real build, post-C_pre). */
export const FREEZE_MANIFEST_REL = 'lab/freeze/freeze-manifest.json';
export const FREEZE_COMPANION_REL = 'lab/freeze/freeze-manifest.sha256';

/**
 * Tracked-tree cleanliness for the freeze precondition (Sprint Plan §8.6 step 6 —
 * "clean tracked tree"). Returns true iff there is NO tracked modification
 * (modified / staged / deleted). Untracked files are IGNORED via
 * `--untracked-files=no`, so unrelated pre-existing untracked paths (e.g.
 * `.agents/`, `.codex/`, `AGENTS.md`) never make the freeze refuse — the binding
 * contract refuses on a dirty TRACKED tree only, never on unrelated untracked
 * files. Fixed executable + fixed args via execFileSync (no shell, no remote).
 *
 * @param {string} [repoRoot]
 * @returns {boolean} true when the tracked tree is clean
 */
export function isTrackedTreeClean(repoRoot = REPO_ROOT) {
  return execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: repoRoot, encoding: 'utf8' }).length === 0;
}

/** Default (real) IO adapter. `git` is used here (build-freeze.js is not under lab/census/). */
export function defaultIo(repoRoot = REPO_ROOT) {
  const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  return {
    gitHeadSha: () => git(['rev-parse', 'HEAD']),
    gitTreeClean: () => isTrackedTreeClean(repoRoot),
    listDirFiles: (dir) => git(['ls-files', dir]).split('\n').filter(l => l.length > 0),
    readFile: (p) => readFileSync(p, 'utf8'),
    fileExists: existsSync,
    writeText: undefined, // fall through to writeFreezeArtifacts' atomic default
  };
}

/**
 * Build the freeze artifacts from real (or injected) inputs. THIN wiring only —
 * delegates all logic to the builder. Refuses (throws {@link FreezeRefusal}) on a
 * missing/empty milestone record before delegating; every other refusal comes from
 * the builder's preconditions and enumeration.
 *
 * @param {Object} p
 * @param {string} p.repoRoot
 * @param {string} p.freezeDir             - directory to write artifacts (temp dir in tests)
 * @param {string} p.milestoneRecordPath   - absolute path to the milestone-evidence record file
 * @param {string} p.milestoneRecordRepoRel- repo-relative POSIX path pinned into milestone_evidence.path
 * @param {Object} p.evidence              - structured { citedSha, m1Present, m2Present, checks }
 * @param {string} p.freezeTargetSha       - the SHA the freeze targets (== C_pre)
 * @param {Object} p.io                    - IO adapter (defaults to real git/fs)
 * @param {boolean} [p.write=true]         - when false, build only (no artifact written)
 * @returns {{manifest:Object, manifestBytes:string, companionDigest:string, companionBytes:string}}
 */
export function buildFreeze({ repoRoot, freezeDir, milestoneRecordPath, milestoneRecordRepoRel, evidence, freezeTargetSha, io = defaultIo(repoRoot), write = true }) {
  const gitState = { headSha: io.gitHeadSha(), treeClean: io.gitTreeClean() };

  if (!io.fileExists(milestoneRecordPath)) {
    throw new FreezeRefusal(`freeze refuses: milestone-evidence record not found: ${milestoneRecordPath}`);
  }
  const milestoneContent = io.readFile(milestoneRecordPath);
  if (typeof milestoneContent !== 'string' || milestoneContent.trim().length === 0) {
    throw new FreezeRefusal('freeze refuses: milestone-evidence record is empty/malformed');
  }
  const milestoneRecord = { path: milestoneRecordRepoRel, content: milestoneContent };

  const assetPaths = enumerateFr9bAssetPaths({ listDirFiles: io.listDirFiles });
  const assetEntries = assetPaths.map(p => ({ path: p, content: io.readFile(join(repoRoot, p)) }));

  const built = buildFreezeManifest({
    assetEntries, milestoneRecord,
    grammar_version: GRAMMAR_VERSION, algorithm_version: ALGORITHM_VERSION,
    gitState, evidence, freezeTargetSha,
  });

  if (write) {
    const writeArgs = { manifestPath: join(freezeDir, 'freeze-manifest.json'), companionPath: join(freezeDir, 'freeze-manifest.sha256'), manifestBytes: built.manifestBytes, companionBytes: built.companionBytes };
    if (io.writeText) writeArgs.writeText = io.writeText;
    writeFreezeArtifacts(writeArgs);
  }
  return built;
}

/** Parse the CLI flags. */
export function parseArgs(argv) {
  const out = { freezeTargetSha: null, milestoneRecord: null, evidence: null, freezeDir: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--freeze-target-sha') out.freezeTargetSha = argv[++i] ?? null;
    else if (argv[i] === '--milestone-record') out.milestoneRecord = argv[++i] ?? null;
    else if (argv[i] === '--evidence') out.evidence = argv[++i] ?? null;
    else if (argv[i] === '--freeze-dir') out.freezeDir = argv[++i] ?? null;
  }
  return out;
}

/**
 * CLI entry. Refuses (non-zero exit, nothing written) on any missing input or builder
 * refusal. On success, writes the two freeze artifacts and prints the companion digest.
 * @returns {number} exit code
 */
export function main(argv, { repoRoot = REPO_ROOT, io, stdout = (s) => process.stdout.write(s), stderr = (s) => process.stderr.write(s) } = {}) {
  try {
    const a = parseArgs(argv);
    if (!a.freezeTargetSha) throw new FreezeRefusal('freeze refuses: --freeze-target-sha <sha> required');
    if (!a.milestoneRecord) throw new FreezeRefusal('freeze refuses: --milestone-record <path> required');
    if (!a.evidence) throw new FreezeRefusal('freeze refuses: --evidence <path.json> required');
    if (!a.freezeDir) throw new FreezeRefusal('freeze refuses: --freeze-dir <dir> required');
    if (!existsSync(a.evidence)) throw new FreezeRefusal(`freeze refuses: evidence file not found: ${a.evidence}`);
    let evidence;
    try { evidence = JSON.parse(readFileSync(a.evidence, 'utf8')); }
    catch (e) { throw new FreezeRefusal(`freeze refuses: malformed evidence JSON: ${e.message}`); }

    const built = buildFreeze({
      repoRoot, freezeDir: a.freezeDir,
      milestoneRecordPath: a.milestoneRecord,
      milestoneRecordRepoRel: 'grimoires/loa/a2a/cycle-004/20-s03-milestone-evidence-record.md',
      evidence, freezeTargetSha: a.freezeTargetSha, io,
    });
    stdout(`freeze manifest written; companion digest ${built.companionDigest}\n`);
    return 0;
  } catch (e) {
    stderr(`${e.name || 'Error'}: ${e.message}\n`);
    return 1;
  }
}

// Operator-invocable CLI. Do NOT run against the real repository during S03 pre-freeze.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
