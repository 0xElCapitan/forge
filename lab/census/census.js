/**
 * lab/census/census.js
 *
 * Cycle-004 S03 (FR-11e; SDD Lane L5 07-cycle-004-sdd.md:537; DR-8; Sprint Plan T3.5).
 *
 * The aggregate-only census CLI. It is STRUCTURALLY UNABLE to run before a valid
 * freeze exists: it requires `--freeze-manifest <path>`, loads it, verifies its
 * companion digest, and re-hashes every pinned census asset (self-integrity) before
 * doing anything else. Any integrity failure is a DR-5 specification error — the
 * census REFUSES with a non-zero exit and NO partial output.
 *
 * Local metadata enters ONLY via `--metadata <dir>` of local JSON files. The output
 * surface is AGGREGATE-ONLY: counts, time span, cadence summaries, and the
 * eligibility-relevant aggregate flags. No value-level series content is ever read
 * from, or emitted by, this module.
 *
 * STRUCTURAL ZERO-NETWORK GUARANTEE (AC-7): this module — and every module under
 * lab/census/ — contains no executable reference to any networking API. Metadata is
 * read from the local filesystem only; no provider is ever contacted, this cycle or
 * ever. Enforced by the lab lint in lab/test/census-no-network.spec.js.
 *
 * S03 CONSTRAINT: this module MUST NOT be executed against real candidate providers,
 * downloaded metadata, live endpoints, or real candidate files. Only refusal paths
 * and a synthetic success path over fabricated local metadata + a test-scoped
 * temporary manifest are exercised (in tests). No real census-output artifact exists.
 *
 * @module lab/census/census
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { sha256LFNormalized, validateFreezeManifestShape } from '../harness/manifests.js';

/** Repo root = two directories up from lab/census/. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * The census self-integrity pin set: the census-apparatus assets that MUST be pinned
 * in the freeze manifest and re-hash to their pinned digests before the census runs.
 * @type {ReadonlyArray<string>}
 */
export const CENSUS_SELF_ASSETS = Object.freeze([
  'lab/census/burned-list.js',
  'lab/census/burned-list.json',
  'lab/census/candidate-pool.json',
  'lab/census/census.js',
  'lab/census/eligibility.js',
  'lab/census/selection-rule.js',
]);

/** Aggregate-only fields emitted per candidate. Value-level series are NEVER included. */
const AGGREGATE_FIELDS = Object.freeze([
  'provider', 'product', 'n_observations', 'history_years', 'span', 'cadence',
  'authority_published', 'public', 'machine_readable', 'free',
  'exogeneity_judgment', 'exogenous', 'mechanical_outcome_declared', 'revision_vintage_documented',
]);

/** A census refusal — a DR-5 specification error. Thrown before any output is produced. */
export class CensusRefusal extends Error {
  constructor(message) { super(message); this.name = 'CensusRefusal'; }
}

/** Parse the census CLI flags. Unknown flags are ignored; missing flags surface as null. */
export function parseArgs(argv) {
  const out = { freezeManifest: null, metadata: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--freeze-manifest') out.freezeManifest = argv[++i] ?? null;
    else if (argv[i] === '--metadata') out.metadata = argv[++i] ?? null;
  }
  return out;
}

/** Companion-digest path for a freeze manifest (freeze-manifest.json -> freeze-manifest.sha256). */
export function companionDigestPath(manifestPath) {
  return manifestPath.endsWith('.json') ? manifestPath.slice(0, -'.json'.length) + '.sha256' : manifestPath + '.sha256';
}

/**
 * Verify the freeze manifest: it exists and parses; its companion digest exists and
 * matches `sha256(LF-normalized manifest bytes)`; its shape is valid; and every census
 * self-asset is pinned and re-hashes to its pinned digest. Throws {@link CensusRefusal}
 * on ANY failure. Injectable (repoRoot/readers) for test-scoped temp manifests.
 *
 * @returns {Object} the verified freeze manifest
 */
export function verifyFreeze({
  freezeManifestPath,
  repoRoot = REPO_ROOT,
  readFile = (p) => readFileSync(p, 'utf8'),
  fileExists = existsSync,
}) {
  if (typeof freezeManifestPath !== 'string' || freezeManifestPath.length === 0) {
    throw new CensusRefusal('census refuses: --freeze-manifest <path> is required (no valid freeze reference)');
  }
  if (!fileExists(freezeManifestPath)) {
    throw new CensusRefusal(`census refuses: freeze manifest not found: ${freezeManifestPath}`);
  }
  const manifestText = readFile(freezeManifestPath);
  let manifest;
  try { manifest = JSON.parse(manifestText); }
  catch (e) { throw new CensusRefusal(`census refuses: malformed freeze manifest JSON: ${e.message}`); }

  const companionPath = companionDigestPath(freezeManifestPath);
  if (!fileExists(companionPath)) {
    throw new CensusRefusal(`census refuses: companion digest missing: ${companionPath}`);
  }
  const companion = readFile(companionPath).trim();
  const recomputed = sha256LFNormalized(manifestText);
  if (companion !== recomputed) {
    throw new CensusRefusal('census refuses: companion digest mismatch (freeze manifest bytes do not match freeze-manifest.sha256)');
  }

  try { validateFreezeManifestShape(manifest); }
  catch (e) { throw new CensusRefusal(`census refuses: freeze manifest shape invalid: ${e.message}`); }

  const pinByPath = new Map(manifest.assets.map(a => [a.path, a.sha256]));
  for (const rel of CENSUS_SELF_ASSETS) {
    if (!pinByPath.has(rel)) {
      throw new CensusRefusal(`census refuses: census asset not pinned in freeze manifest: ${rel}`);
    }
    const abs = join(repoRoot, rel);
    if (!fileExists(abs)) {
      throw new CensusRefusal(`census refuses: pinned census asset missing on disk: ${rel}`);
    }
    const actual = sha256LFNormalized(readFile(abs));
    if (actual !== pinByPath.get(rel)) {
      throw new CensusRefusal(`census refuses: pinned census asset digest mismatch: ${rel}`);
    }
  }
  return manifest;
}

/**
 * Load local aggregate-metadata JSON files from a directory. LOCAL FILESYSTEM ONLY —
 * no network. Each file must be a JSON object. Returns them sorted by filename for
 * deterministic ordering.
 */
export function loadLocalMetadata({
  metadataDir,
  readDir = (d) => readdirSync(d),
  readFile = (p) => readFileSync(p, 'utf8'),
  fileExists = existsSync,
}) {
  if (typeof metadataDir !== 'string' || metadataDir.length === 0) {
    throw new CensusRefusal('census refuses: --metadata <dir> is required');
  }
  if (!fileExists(metadataDir)) {
    throw new CensusRefusal(`census refuses: metadata directory not found: ${metadataDir}`);
  }
  const files = readDir(metadataDir).filter(f => f.endsWith('.json')).sort();
  return files.map((f) => {
    const text = readFile(join(metadataDir, f));
    let obj;
    try { obj = JSON.parse(text); }
    catch (e) { throw new CensusRefusal(`census refuses: malformed metadata JSON in ${f}: ${e.message}`); }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new CensusRefusal(`census refuses: metadata ${f} must be a JSON object`);
    }
    return { file: f, metadata: obj };
  });
}

/**
 * Project one metadata object down to its AGGREGATE-ONLY fields. Any value-level
 * content (arrays of observations, raw series) is dropped — never echoed.
 */
export function aggregateOnly(metadata) {
  const out = {};
  for (const k of AGGREGATE_FIELDS) {
    if (k in metadata) out[k] = metadata[k];
  }
  return out;
}

/**
 * Compute the aggregate-only census report from loaded local metadata. The report
 * carries counts, span, cadence summaries, and eligibility-relevant aggregate flags
 * only — no value-level series.
 */
export function computeAggregates(loaded) {
  const candidates = loaded.map(({ file, metadata }) => ({ source_file: file, ...aggregateOnly(metadata) }));
  return {
    report_kind: 'aggregate-census',
    schema_version: '1.0.0',
    candidate_count: candidates.length,
    candidates,
    note: 'AGGREGATE-ONLY: counts, span, cadence, and eligibility-relevant flags. No value-level series content. No provider was contacted.',
  };
}

/**
 * Run the census end to end: verify the freeze (refuse on any integrity failure),
 * load local metadata, and compute the aggregate-only report. Returns the report;
 * produces NO output itself, so a refusal leaves nothing partial behind.
 */
export function runCensus({ freezeManifest, metadata, repoRoot = REPO_ROOT, io = {} }) {
  verifyFreeze({ freezeManifestPath: freezeManifest, repoRoot, ...io });
  const loaded = loadLocalMetadata({ metadataDir: metadata, ...io });
  return computeAggregates(loaded);
}

/**
 * CLI entry point. Prints the aggregate report to stdout ONLY on full success; on any
 * refusal it writes the reason to stderr, prints nothing to stdout (no partial output),
 * and returns a non-zero exit code.
 *
 * @returns {number} process exit code (0 success, 1 refusal/error)
 */
export function main(argv, { stdout = (s) => process.stdout.write(s), stderr = (s) => process.stderr.write(s) } = {}) {
  let report;
  try {
    const { freezeManifest, metadata } = parseArgs(argv);
    report = runCensus({ freezeManifest, metadata });
  } catch (e) {
    stderr(`${e.name || 'Error'}: ${e.message}\n`);
    return 1;
  }
  stdout(JSON.stringify(report, null, 2) + '\n');
  return 0;
}

// Operator-invocable CLI. Structurally cannot run before a valid freeze exists.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
