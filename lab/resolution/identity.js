/**
 * lab/resolution/identity.js
 *
 * Cycle-005 S01 (PRD FR-A3/FR-A4, FR-E1; SDD DR-2; Sprint Plan T1.3, T1.7).
 *
 * The Gate-A acquisition-apparatus IDENTITY. Builds the tracked
 * `acquisition-manifest.json` (+ `.sha256` companion) — a content-addressed
 * enumeration of EVERY `.js`/`.json` asset under `lab/acquisition/**` and
 * `lab/resolution/**` (both namespaces), the per-provider method set, the freeze
 * anchor, and the ledger baselines — reusing the pinned freeze primitives
 * (`buildAssetInventory`, `sha256LFNormalized`, `canonicalize`), never
 * reimplementing them (house rule).
 *
 * `verifyAcquisitionIdentity()` is the FR-A4 operational seal BY CONSTRUCTION: it
 * re-hashes every apparatus asset against the accepted manifest and refuses on any
 * mismatch (the `verifyFreeze` pattern transplanted). The `seal.js` orchestrator
 * refuses to run unless this passes, so any post-acceptance source change
 * mechanically disables the resolution path until the operator re-accepts at a new
 * identity.
 *
 * @module lab/resolution/identity
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalize } from '../../src/receipt/canonicalize.js';
import { sha256LFNormalized, buildAssetInventory } from '../harness/manifests.js';
import { TRIALS_LEDGER_PATH, BURN_LEDGER_PATH } from '../harness/ledgers.js';
import { writeTextAtomic } from '../harness/slice-fixtures.js';

/** The apparatus namespaces enumerated by the Gate-A manifest (DR-2). */
export const APPARATUS_NAMESPACES = Object.freeze(['lab/acquisition', 'lab/resolution']);

/** The Lane-A Gate-A method-set file (embedded as `method_set`). */
const METHOD_SET_REL = 'lab/acquisition/method-set.json';
/** The Cycle-004 freeze companion-digest file (the FR-E1 anchor). */
const FREEZE_COMPANION_REL = 'lab/freeze/freeze-manifest.sha256';

/** An acquisition-identity refusal — DR-2 self-verify failure (HALT; no partial effect). */
export class AcquisitionRefusal extends Error {
  constructor(message) { super(message); this.name = 'AcquisitionRefusal'; }
}

/** Recursively collect repo-relative POSIX paths of every `.js`/`.json` under `relDir`. */
function walkAssets(repoRoot, relDir) {
  const abs = join(repoRoot, relDir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const ent of readdirSync(abs, { withFileTypes: true })) {
    const childRel = `${relDir}/${ent.name}`;
    if (ent.isDirectory()) out.push(...walkAssets(repoRoot, childRel));
    else if (ent.isFile() && (ent.name.endsWith('.js') || ent.name.endsWith('.json'))) out.push(childRel);
  }
  return out;
}

/**
 * Enumerate the apparatus assets as `buildAssetInventory` entries
 * (`{ path, content }`), repo-relative POSIX, from both namespaces.
 * @returns {Array<{path:string, content:string}>}
 */
export function enumerateApparatusEntries(repoRoot) {
  const paths = [];
  for (const ns of APPARATUS_NAMESPACES) paths.push(...walkAssets(repoRoot, ns));
  return paths.map(p => ({ path: p, content: readFileSync(join(repoRoot, p), 'utf8') }));
}

/**
 * Build the acquisition manifest object (WITHOUT the companion digest — the
 * companion is computed over the manifest bytes and stored in the `.sha256` file).
 *
 * @param {Object} p
 * @param {string} p.repoRoot
 * @returns {Object} the acquisition manifest
 */
export function buildAcquisitionManifest({ repoRoot }) {
  const assets = buildAssetInventory(enumerateApparatusEntries(repoRoot));

  const methodSetPath = join(repoRoot, METHOD_SET_REL);
  if (!existsSync(methodSetPath)) throw new AcquisitionRefusal(`acquisition manifest: method set absent: ${METHOD_SET_REL}`);
  const method_set = JSON.parse(readFileSync(methodSetPath, 'utf8'));

  const companionPath = join(repoRoot, FREEZE_COMPANION_REL);
  if (!existsSync(companionPath)) throw new AcquisitionRefusal(`acquisition manifest: freeze companion absent: ${FREEZE_COMPANION_REL}`);
  const companion_digest = readFileSync(companionPath, 'utf8').trim();

  const trialsAbs = join(repoRoot, TRIALS_LEDGER_PATH);
  const trials_sha256 = existsSync(trialsAbs) ? sha256LFNormalized(readFileSync(trialsAbs, 'utf8')) : null;
  const burnAbs = join(repoRoot, BURN_LEDGER_PATH);
  const burn_bytes = existsSync(burnAbs) ? statSync(burnAbs).size : 0;

  return {
    manifest_kind: 'acquisition',
    schema_version: '1.0.0',
    cycle: 'cycle-005',
    assets,
    method_set,
    freeze_ref: { companion_digest },
    ledger_baselines: { trials_sha256, burn_bytes },
  };
}

/** Serialize an acquisition manifest to its on-disk bytes (canonical JSON + explicit LF). */
export function serializeAcquisitionManifest(manifest) {
  return canonicalize(manifest) + '\n';
}

/** The acquisition manifest's companion digest = `sha256(LF-normalized manifest bytes)`. */
export function computeAcquisitionCompanion(manifest) {
  return sha256LFNormalized(serializeAcquisitionManifest(manifest));
}

/** Companion-digest path for the acquisition manifest. */
export function companionDigestPath(manifestPath) {
  return manifestPath.endsWith('.json') ? manifestPath.slice(0, -'.json'.length) + '.sha256' : manifestPath + '.sha256';
}

/**
 * Build + atomically write the acquisition manifest pair (`.json` + `.sha256`) over
 * the code-complete apparatus tree (Task 1.7). The manifest bytes are `canonicalize +
 * \n`; the companion is `sha256(LF-normalized manifest bytes)`. Self-verifies after
 * write (DR-2). Returns `{ manifestPath, companionPath, companion_digest, asset_count }`.
 *
 * @param {Object} p
 * @param {string} p.repoRoot
 * @param {string} p.evidenceDir - lab/evidence/cycle-005
 * @returns {{manifestPath:string, companionPath:string, companion_digest:string, asset_count:number}}
 */
export function writeAcquisitionManifest({ repoRoot, evidenceDir }) {
  const manifest = buildAcquisitionManifest({ repoRoot });
  const manifestBytes = serializeAcquisitionManifest(manifest);
  const companion = sha256LFNormalized(manifestBytes);
  const manifestPath = join(evidenceDir, 'acquisition-manifest.json');
  const companionPath = companionDigestPath(manifestPath);
  writeTextAtomic(manifestPath, manifestBytes);
  writeTextAtomic(companionPath, companion + '\n');
  // Self-verify the just-written pair (DR-2 — refuse to leave a broken identity).
  const v = verifyAcquisitionIdentity({ repoRoot, manifestPath });
  if (v.companion_digest !== companion) throw new AcquisitionRefusal('acquisition manifest self-verify mismatch immediately after write');
  return { manifestPath, companionPath, companion_digest: companion, asset_count: manifest.assets.length };
}

/**
 * Verify the acquisition identity: load the manifest + companion, recompute the
 * companion over the manifest bytes, and re-hash EVERY listed apparatus asset
 * against its recorded digest. Throws {@link AcquisitionRefusal} on ANY mismatch
 * (no partial effect). Returns the verified manifest + companion.
 *
 * @param {Object} p
 * @param {string} p.repoRoot
 * @param {string} p.manifestPath - lab/evidence/cycle-005/acquisition-manifest.json
 * @returns {{manifest:Object, companion_digest:string, asset_count:number}}
 */
export function verifyAcquisitionIdentity({ repoRoot, manifestPath }) {
  if (!existsSync(manifestPath)) throw new AcquisitionRefusal(`acquisition identity: manifest not found: ${manifestPath}`);
  const cPath = companionDigestPath(manifestPath);
  if (!existsSync(cPath)) throw new AcquisitionRefusal(`acquisition identity: companion digest missing: ${cPath}`);
  const manifestText = readFileSync(manifestPath, 'utf8');
  let manifest;
  try { manifest = JSON.parse(manifestText); } catch (e) { throw new AcquisitionRefusal(`acquisition identity: malformed manifest JSON: ${e.message}`); }
  const companion = readFileSync(cPath, 'utf8').trim();
  const recomputed = sha256LFNormalized(manifestText);
  if (companion !== recomputed) throw new AcquisitionRefusal('acquisition identity: companion digest mismatch (manifest bytes drifted)');
  if (!Array.isArray(manifest.assets)) throw new AcquisitionRefusal('acquisition identity: manifest has no assets[]');
  for (const a of manifest.assets) {
    const abs = join(repoRoot, a.path);
    if (!existsSync(abs)) throw new AcquisitionRefusal(`acquisition identity: apparatus asset missing on disk: ${a.path}`);
    const actual = sha256LFNormalized(readFileSync(abs, 'utf8'));
    if (actual !== a.sha256) throw new AcquisitionRefusal(`acquisition identity: apparatus asset digest mismatch (drift): ${a.path}`);
  }
  return { manifest, companion_digest: recomputed, asset_count: manifest.assets.length };
}
