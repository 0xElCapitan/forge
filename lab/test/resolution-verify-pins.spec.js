// lab/test/resolution-verify-pins.spec.js
//
// Cycle-005 S01 (PRD FR-E3, FR-C1; SDD DR-2; Sprint Plan T1.8). The FR-E3 43/43
// pinned-asset invariance verifier: a clean run over the REAL freeze (43/43 +
// companion), and a planted-drift refusal (a temp manifest with a wrong pinned digest).
// This is a standing pinned-asset canary — any void-condition-1 edit fails it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyAllPins, buildPinInvarianceRecord, companionDigestPath, PIN_EVENTS } from '../resolution/verify-pins.js';
import { sha256LFNormalized } from '../harness/manifests.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FREEZE = join(REPO_ROOT, 'lab/freeze/freeze-manifest.json');

test('FR-E3: verifyAllPins over the REAL freeze → 43/43 + companion, zero mismatches', () => {
  const r = verifyAllPins({ repoRoot: REPO_ROOT, freezeManifestPath: FREEZE });
  assert.equal(r.all_match, true, `mismatches: ${JSON.stringify(r.mismatches)}`);
  assert.equal(r.companion_match, true);
  assert.equal(r.asset_count, 43, 'the Cycle-004 freeze pins 43 assets');
  assert.equal(r.mismatches.length, 0);
});

test('FR-E3: a planted pinned-asset digest drift is detected (void condition 1)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c005-pins-'));
  const manifest = JSON.parse(readFileSync(FREEZE, 'utf8'));
  // Corrupt exactly one pinned digest.
  manifest.assets = manifest.assets.map((a, i) => (i === 0 ? { ...a, sha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' } : a));
  const bytes = JSON.stringify(manifest);
  const mp = join(dir, 'freeze-manifest.json');
  writeFileSync(mp, bytes);
  writeFileSync(companionDigestPath(mp), sha256LFNormalized(bytes)); // companion matches these bytes
  const r = verifyAllPins({ repoRoot: REPO_ROOT, freezeManifestPath: mp });
  assert.equal(r.companion_match, true, 'the tampered manifest still has a self-consistent companion');
  assert.equal(r.all_match, false, 'but a pinned asset re-hash mismatches');
  assert.ok(r.mismatches.some(m => m.reason.includes('digest mismatch')));
});

test('verifyAllPins on a missing manifest is fail-closed (all_match false)', () => {
  const r = verifyAllPins({ repoRoot: REPO_ROOT, freezeManifestPath: join(REPO_ROOT, 'lab/freeze/nope.json') });
  assert.equal(r.all_match, false);
});

test('buildPinInvarianceRecord shape + event validation', () => {
  const r = verifyAllPins({ repoRoot: REPO_ROOT, freezeManifestPath: FREEZE });
  for (const ev of PIN_EVENTS) {
    const rec = buildPinInvarianceRecord(ev, r);
    assert.equal(rec.record_kind, 'pin-invariance');
    assert.equal(rec.event, ev);
    assert.equal(rec.asset_count, 43);
    assert.equal(rec.all_match, true);
  }
  assert.throws(() => buildPinInvarianceRecord('bogus-event', r));
});
