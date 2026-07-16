/**
 * lab/resolution/census-exec.js
 *
 * Cycle-005 S01 (PRD FR-C1, FR-C3, NFR-HALT; SDD DR-9, DR-10; Sprint Plan T1.5).
 *
 * The census-execution wrapper — THE ONLY subprocess-bearing module (G9). It spawns
 * the UNMODIFIED frozen census CLI:
 *
 *   node lab/census/census.js --freeze-manifest <real> --metadata <dir>
 *
 * with stdout/stderr captured as BUFFERS via `spawnSync` (an explicit argv array, no
 * shell, NO redirection — PowerShell redirection re-encodes bytes, the Cycle-004
 * byte hazard). Success requires exit 0 AND empty stderr; the stdout bytes are the
 * verbatim `census-result.json`. Any non-zero exit / non-empty stderr is a
 * `CensusExecRefusal` HALT — never bypassed, mocked, or "fixed forward" (FR-C1).
 *
 * S01: exercised via the in-process `census-cli-real-freeze.spec.js` (FR-A2 closure,
 * calls the census `main()` directly with the real freeze reference + fixture
 * metadata) and an injected-spawn unit path. The real subprocess run against real
 * metadata is an S02 operation.
 *
 * @module lab/resolution/census-exec
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { sha256LFNormalized } from '../harness/manifests.js';
import { writeTextAtomic } from '../harness/slice-fixtures.js';

/** A census-execution refusal — non-zero exit / non-empty stderr from the frozen CLI (HALT). */
export class CensusExecRefusal extends Error {
  constructor(message, detail) { super(message); this.name = 'CensusExecRefusal'; this.detail = detail; }
}

/** Repo-relative path to the frozen census CLI. */
export const CENSUS_CLI_REL = 'lab/census/census.js';

/**
 * Spawn the frozen census CLI and capture stdout/stderr as Buffers. Injectable
 * `spawn` for tests (defaults to `spawnSync`). NO shell, NO redirection.
 *
 * @param {Object} p
 * @param {string} p.repoRoot
 * @param {string} p.freezeManifestPath
 * @param {string} p.metadataDir
 * @param {Function} [p.spawn] - (cmd, args, opts) => { status, stdout:Buffer, stderr:Buffer, error? }
 * @param {string} [p.execPath] - node binary (defaults to process.execPath)
 * @returns {{argv:string[], status:number, stdout:Buffer, stderr:Buffer}}
 */
export function runCensusCapture({ repoRoot, freezeManifestPath, metadataDir, spawn = spawnSync, execPath = process.execPath }) {
  const censusScript = join(repoRoot, CENSUS_CLI_REL);
  const args = [censusScript, '--freeze-manifest', freezeManifestPath, '--metadata', metadataDir];
  const res = spawn(execPath, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (res.error) throw new CensusExecRefusal(`census subprocess failed to start: ${res.error.message}`, { argv: args });
  const stdout = Buffer.isBuffer(res.stdout) ? res.stdout : Buffer.from(res.stdout ?? '', 'utf8');
  const stderr = Buffer.isBuffer(res.stderr) ? res.stderr : Buffer.from(res.stderr ?? '', 'utf8');
  return { argv: [execPath, ...args], status: typeof res.status === 'number' ? res.status : 1, stdout, stderr };
}

/** Digest every metadata file in the census-input directory (LF-normalized), sorted by name. */
export function metadataFileDigests(metadataDir) {
  if (!existsSync(metadataDir)) return [];
  return readdirSync(metadataDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(name => ({ name, sha256: sha256LFNormalized(readFileSync(join(metadataDir, name), 'utf8')) }));
}

/**
 * Build the `census-execution.json` derived-record body (§7). No wall-clock
 * (deterministic derived record, DR-10.3). Wrapped with a content-address by
 * evidence.js before write.
 *
 * @returns {Object}
 */
export function buildCensusExecutionRecord({ argv, exit_code, stderr_empty, stdout_sha256, freeze_companion_digest, metadata_files, refs = {} }) {
  return {
    record_kind: 'census-execution',
    schema_version: '1.0.0',
    cycle: 'cycle-005',
    argv,
    exit_code,
    stderr_empty,
    stdout_sha256,
    freeze_companion_digest,
    metadata_files,
    refs,
  };
}

/**
 * Execute the frozen census against the REAL freeze reference + a metadata dir,
 * write the verbatim `census-result.json`, and return the execution-record data +
 * the raw stdout. Throws {@link CensusExecRefusal} (HALT) on non-zero exit / non-empty
 * stderr, producing NO census-result artifact (no partial output; FR-C1).
 *
 * @param {Object} p
 * @param {string} p.repoRoot
 * @param {string} p.freezeManifestPath
 * @param {string} p.metadataDir
 * @param {string} p.censusResultPath - where to write the verbatim stdout
 * @param {string} p.freezeCompanionDigest
 * @param {Function} [p.spawn]
 * @param {Object} [p.refs]
 * @returns {{execution:Object, censusResultPath:string, stdout:Buffer}}
 */
export function executeCensus({ repoRoot, freezeManifestPath, metadataDir, censusResultPath, freezeCompanionDigest, spawn = spawnSync, refs = {} }) {
  const { argv, status, stdout, stderr } = runCensusCapture({ repoRoot, freezeManifestPath, metadataDir, spawn });
  if (status !== 0 || stderr.length > 0) {
    throw new CensusExecRefusal('census refused (non-zero exit or non-empty stderr) — HALT, never fixed forward (FR-C1/NFR-HALT)', {
      argv, exit_code: status, stderr: stderr.toString('utf8').slice(0, 4096),
    });
  }
  // The census-result is the frozen census's own emission, captured VERBATIM (DR-9.1).
  writeTextAtomic(censusResultPath, stdout.toString('utf8'));
  const execution = buildCensusExecutionRecord({
    argv,
    exit_code: status,
    stderr_empty: true,
    stdout_sha256: sha256LFNormalized(stdout),
    freeze_companion_digest: freezeCompanionDigest,
    metadata_files: metadataFileDigests(metadataDir),
    refs,
  });
  return { execution, censusResultPath, stdout };
}
