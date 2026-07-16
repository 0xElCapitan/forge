/**
 * lab/resolution/verify-pins.js
 *
 * Cycle-005 S01 (PRD FR-E3, FR-C1; SDD DR-2, §9.1 map; Sprint Plan T1.3).
 *
 * The pinned-asset invariance verifier (FR-E3): re-hash ALL pinned freeze assets
 * (43 at Cycle-004) against their recorded digests and re-verify the freeze
 * companion digest — the mechanical proof that void condition 1 (any post-freeze
 * edit to a pinned asset) never triggered. Cheap and repeatable; run at gate-a /
 * g0 / pre-census / terminal (§9.1 map). This is the continuous canary that guards
 * the whole cycle against an accidental pinned-asset edit while building adjacent
 * apparatus.
 *
 * Reuses `sha256LFNormalized` (the Cycle-004 EOL doctrine) — a raw byte hash of a
 * tracked text file is not cross-OS stable (`.gitattributes * text=auto`).
 *
 * @module lab/resolution/verify-pins
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { sha256LFNormalized } from '../harness/manifests.js';

/** The four pin-invariance verification events (§9.1 map). */
export const PIN_EVENTS = Object.freeze(['gate-a', 'g0', 'pre-census', 'terminal']);

/** Companion-digest path for a freeze manifest. */
export function companionDigestPath(manifestPath) {
  return manifestPath.endsWith('.json') ? manifestPath.slice(0, -'.json'.length) + '.sha256' : manifestPath + '.sha256';
}

/**
 * Re-hash every pinned asset against the freeze manifest and re-verify the
 * companion digest. PURE result (no throw): the caller decides HALT (NFR-HALT).
 *
 * @param {Object} p
 * @param {string} p.repoRoot
 * @param {string} p.freezeManifestPath - lab/freeze/freeze-manifest.json (the REAL reference)
 * @returns {{all_match:boolean, companion_match:boolean, asset_count:number, mismatches:Array<{path:string, reason:string}>}}
 */
export function verifyAllPins({ repoRoot, freezeManifestPath }) {
  const mismatches = [];
  if (!existsSync(freezeManifestPath)) {
    return { all_match: false, companion_match: false, asset_count: 0, mismatches: [{ path: freezeManifestPath, reason: 'freeze manifest not found' }] };
  }
  const manifestText = readFileSync(freezeManifestPath, 'utf8');
  let manifest;
  try { manifest = JSON.parse(manifestText); }
  catch (e) { return { all_match: false, companion_match: false, asset_count: 0, mismatches: [{ path: freezeManifestPath, reason: `malformed manifest JSON: ${e.message}` }] }; }

  const cPath = companionDigestPath(freezeManifestPath);
  let companion_match = false;
  if (existsSync(cPath)) {
    const companion = readFileSync(cPath, 'utf8').trim();
    companion_match = companion === sha256LFNormalized(manifestText);
    if (!companion_match) mismatches.push({ path: cPath, reason: 'companion digest mismatch' });
  } else {
    mismatches.push({ path: cPath, reason: 'companion digest file missing' });
  }

  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  for (const a of assets) {
    const abs = join(repoRoot, a.path);
    if (!existsSync(abs)) { mismatches.push({ path: a.path, reason: 'pinned asset missing on disk' }); continue; }
    const actual = sha256LFNormalized(readFileSync(abs, 'utf8'));
    if (actual !== a.sha256) mismatches.push({ path: a.path, reason: 'pinned asset digest mismatch (void condition 1)' });
  }

  return {
    all_match: mismatches.length === 0,
    companion_match,
    asset_count: assets.length,
    mismatches,
  };
}

/**
 * Build a `pin-invariance-<event>.json` record body (DR-4/§7). Governance/derived
 * hybrid: no wall-clock (the digests are deterministic); the event label carries
 * the ceremony point. The caller wraps it with a content-address via evidence.js.
 *
 * @param {string} event - one of {@link PIN_EVENTS}
 * @param {ReturnType<typeof verifyAllPins>} result
 * @returns {Object}
 */
export function buildPinInvarianceRecord(event, result) {
  if (!PIN_EVENTS.includes(event)) throw new Error(`buildPinInvarianceRecord: unknown event "${event}"`);
  return {
    record_kind: 'pin-invariance',
    schema_version: '1.0.0',
    cycle: 'cycle-005',
    event,
    asset_count: result.asset_count,
    all_match: result.all_match,
    companion_match: result.companion_match,
    mismatches: result.mismatches,
  };
}
