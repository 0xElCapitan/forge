// lab/test/resolution-pin-invariance.spec.js
//
// Cycle-005 S02 Task 2.2 (PRD FR-E3; SDD DR-2/DR-4.3/§7; Sprint Plan T2.1/T2.2;
// 24-cycle-005-pre-g0-apparatus-audit.md §7; 25-cycle-005-replacement-gate-a-decision-brief.md §5).
//
// The PRODUCTION `io.preparePinInvariance` — `lab/resolution/pin-invariance.js`. This
// spec proves that
//
//   - it verifies the REAL Cycle-004 freeze (43/43 pinned assets + companion) and
//     persists a canonical, authority-bound, self-addressed `pin-invariance-g0.json`;
//   - the artifact is byte-deterministic (no wall-clock) across independent runs;
//   - a pre-existing artifact, a freeze-anchor mismatch, a pin count that is not the
//     frozen 43, pinned-asset drift, a non-`g0` event and a missing binding argument
//     ALL refuse, and a refusal before the write leaves the directory untouched;
//   - the persisted-artifact verifier rejects malformed, stale, mismatched and edited
//     evidence;
//   - and — the end-to-end claim — `acquire.js main --execute` driven by this exact
//     production preparer persists the artifact BEFORE the first transport call, and a
//     second invocation over it refuses with zero further transport.
//
// Every write lands in a temporary directory: the repository evidence directory is
// never touched, and every transport is injected — no live provider request occurs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  prepareG0PinInvariance,
  verifyPersistedG0PinInvariance,
  buildG0PinInvarianceRecord,
  PIN_INVARIANCE_G0_NAME,
  FROZEN_PIN_ASSET_COUNT,
  FREEZE_MANIFEST_REL,
} from '../resolution/pin-invariance.js';
import { AcquisitionRefusal } from '../resolution/identity.js';
import { verifyAllPins } from '../resolution/verify-pins.js';
import { main } from '../acquisition/acquire.js';
import { buildAssetInventory, contentAddress, sha256LFNormalized } from '../harness/manifests.js';
import { canonicalize } from '../../src/receipt/canonicalize.js';
import { readLedger } from '../harness/ledgers.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const METHOD_SET_REL = 'lab/acquisition/method-set.json';
const FREEZE_COMPANION_REL = 'lab/freeze/freeze-manifest.sha256';

/** The live Cycle-004 freeze companion digest — the anchor a lawful record must name. */
const LIVE_FREEZE_COMPANION = readFileSync(join(REPO_ROOT, FREEZE_COMPANION_REL), 'utf8').trim();

const tmpEvidenceDir = () => mkdtempSync(join(tmpdir(), 'c005-pin-'));

/** A one-shot record with its DR-4.3 self-excluded content id. */
const withId = (rec) => ({ ...rec, record_id: contentAddress(rec) });

/** The lawful argument set against the real repository freeze. */
const lawfulArgs = (evidenceDir, over = {}) => ({
  repoRoot: REPO_ROOT,
  evidenceDir,
  apparatus_identity: 'sha256:apparatus-under-test',
  freeze_companion_digest: LIVE_FREEZE_COMPANION,
  g0_record_id: 'sha256:g0-under-test',
  ...over,
});

// ─── The lawful path ───────────────────────────────────────────────────────────

test('T2.2: prepareG0PinInvariance persists a verifiable 43/43 record bound to its authority', () => {
  const evidenceDir = tmpEvidenceDir();
  const rec = prepareG0PinInvariance(lawfulArgs(evidenceDir));

  assert.equal(rec.record_kind, 'pin-invariance');
  assert.equal(rec.schema_version, '1.0.0');
  assert.equal(rec.cycle, 'cycle-005');
  assert.equal(rec.event, 'g0');
  assert.equal(rec.asset_count, FROZEN_PIN_ASSET_COUNT);
  assert.equal(FROZEN_PIN_ASSET_COUNT, 43, 'the frozen Cycle-004 pin count');
  assert.equal(rec.all_match, true);
  assert.equal(rec.companion_match, true);
  assert.deepEqual(rec.mismatches, []);
  assert.equal(rec.apparatus_identity, 'sha256:apparatus-under-test');
  assert.equal(rec.freeze_companion_digest, LIVE_FREEZE_COMPANION);
  assert.deepEqual(rec.refs, { g0: 'sha256:g0-under-test' });

  // The returned record IS the persisted one, canonical and self-addressed.
  const text = readFileSync(join(evidenceDir, PIN_INVARIANCE_G0_NAME), 'utf8');
  assert.equal(text, canonicalize(rec) + '\n');
  const { record_id, ...body } = rec;
  assert.equal(record_id, contentAddress(body), 'DR-4.3 self-excluded record_id verifies');

  // No wall-clock anywhere: the record is a set of digests and verification results.
  assert.ok(!('at' in rec), 'the record carries no wall-clock');

  // And it agrees with an independent read of the same verifier.
  const independent = verifyAllPins({ repoRoot: REPO_ROOT, freezeManifestPath: join(REPO_ROOT, FREEZE_MANIFEST_REL) });
  assert.equal(independent.asset_count, FROZEN_PIN_ASSET_COUNT);
  assert.equal(independent.all_match, true);
  assert.equal(independent.companion_match, true);
});

test('T2.2: the persisted artifact is byte-deterministic across independent runs', () => {
  const a = tmpEvidenceDir();
  const b = tmpEvidenceDir();
  prepareG0PinInvariance(lawfulArgs(a));
  prepareG0PinInvariance(lawfulArgs(b));
  assert.equal(
    readFileSync(join(a, PIN_INVARIANCE_G0_NAME), 'utf8'),
    readFileSync(join(b, PIN_INVARIANCE_G0_NAME), 'utf8'),
    'two independent preparations produce byte-identical evidence',
  );
});

test('T2.2: buildG0PinInvarianceRecord composes the frozen builder without reimplementing it', () => {
  const result = verifyAllPins({ repoRoot: REPO_ROOT, freezeManifestPath: join(REPO_ROOT, FREEZE_MANIFEST_REL) });
  const body = buildG0PinInvarianceRecord({ result, apparatus_identity: 'sha256:a', freeze_companion_digest: 'sha256:f', g0_record_id: 'sha256:g' });
  assert.equal(body.event, 'g0');
  assert.equal(body.asset_count, result.asset_count);
  assert.deepEqual(body.mismatches, result.mismatches);
  assert.ok(!('record_id' in body), 'the record id is computed at write, never by the builder');
});

// ─── Refusals before the write ─────────────────────────────────────────────────

test('T2.2: a pre-existing artifact refuses and is never overwritten', () => {
  const evidenceDir = tmpEvidenceDir();
  const planted = '{"record_kind":"pin-invariance"}\n';
  writeFileSync(join(evidenceDir, PIN_INVARIANCE_G0_NAME), planted);
  assert.throws(() => prepareG0PinInvariance(lawfulArgs(evidenceDir)), /already exists/);
  assert.throws(() => prepareG0PinInvariance(lawfulArgs(evidenceDir)), AcquisitionRefusal);
  assert.equal(readFileSync(join(evidenceDir, PIN_INVARIANCE_G0_NAME), 'utf8'), planted, 'byte-identical');
});

test('T2.2: a freeze anchor that is not the live freeze companion refuses and writes nothing', () => {
  const evidenceDir = tmpEvidenceDir();
  assert.throws(
    () => prepareG0PinInvariance(lawfulArgs(evidenceDir, { freeze_companion_digest: 'sha256:not-the-live-freeze' })),
    /does not match the live freeze companion digest/,
  );
  assert.deepEqual(readdirSync(evidenceDir), [], 'the evidence directory is untouched');
});

test('T2.2: a non-g0 event and every missing binding argument refuse', () => {
  const evidenceDir = tmpEvidenceDir();
  assert.throws(() => prepareG0PinInvariance(lawfulArgs(evidenceDir, { event: 'gate-a' })), /produces the "g0" event only/);
  for (const field of ['repoRoot', 'evidenceDir', 'apparatus_identity', 'freeze_companion_digest', 'g0_record_id']) {
    assert.throws(() => prepareG0PinInvariance(lawfulArgs(evidenceDir, { [field]: '' })), new RegExp(`${field} must be a non-empty string`), field);
    assert.throws(() => prepareG0PinInvariance(lawfulArgs(evidenceDir, { [field]: undefined })), AcquisitionRefusal, field);
  }
  assert.deepEqual(readdirSync(evidenceDir), [], 'the evidence directory is untouched');
});

/**
 * A synthetic repo root carrying its own freeze: `count` tiny pinned assets, a manifest
 * over them, and a matching companion. `corrupt` rewrites one asset AFTER the manifest
 * is sealed, producing genuine void-condition-1 drift.
 */
function synthFreeze({ count, corrupt = false }) {
  const root = mkdtempSync(join(tmpdir(), 'c005-pin-freeze-'));
  mkdirSync(join(root, 'lab', 'freeze', 'pinned'), { recursive: true });
  const entries = [];
  for (let i = 0; i < count; i++) {
    const rel = `lab/freeze/pinned/asset-${i}.txt`;
    const content = `pinned asset ${i}\n`;
    writeFileSync(join(root, rel), content);
    entries.push({ path: rel, content });
  }
  const manifest = { manifest_kind: 'freeze', schema_version: '1.0.0', assets: buildAssetInventory(entries) };
  const manifestText = canonicalize(manifest) + '\n';
  writeFileSync(join(root, FREEZE_MANIFEST_REL), manifestText);
  const companion = sha256LFNormalized(manifestText);
  writeFileSync(join(root, FREEZE_COMPANION_REL), companion + '\n');
  if (corrupt) writeFileSync(join(root, entries[0].path), 'edited after the freeze\n');
  return { root, companion };
}

test('T2.2: a freeze that does not enumerate the frozen 43 pinned assets refuses', () => {
  const evidenceDir = tmpEvidenceDir();
  const { root, companion } = synthFreeze({ count: 2 });
  assert.throws(
    () => prepareG0PinInvariance(lawfulArgs(evidenceDir, { repoRoot: root, freeze_companion_digest: companion })),
    /enumerates 2 pinned assets, not the frozen 43/,
  );
  assert.deepEqual(readdirSync(evidenceDir), []);
});

test('T2.2: pinned-asset drift (void condition 1) refuses and writes nothing', () => {
  const evidenceDir = tmpEvidenceDir();
  const { root, companion } = synthFreeze({ count: FROZEN_PIN_ASSET_COUNT, corrupt: true });
  assert.throws(
    () => prepareG0PinInvariance(lawfulArgs(evidenceDir, { repoRoot: root, freeze_companion_digest: companion })),
    /pinned-asset drift \(void condition 1\) — lab\/freeze\/pinned\/asset-0\.txt/,
  );
  assert.deepEqual(readdirSync(evidenceDir), [], 'no partial evidence survives a drift refusal');
});

test('T2.2: an absent freeze manifest or companion refuses', () => {
  const evidenceDir = tmpEvidenceDir();
  const bare = mkdtempSync(join(tmpdir(), 'c005-pin-bare-'));
  assert.throws(() => prepareG0PinInvariance(lawfulArgs(evidenceDir, { repoRoot: bare })), /freeze manifest absent/);
  mkdirSync(join(bare, 'lab', 'freeze'), { recursive: true });
  writeFileSync(join(bare, FREEZE_MANIFEST_REL), '{"assets":[]}\n');
  assert.throws(() => prepareG0PinInvariance(lawfulArgs(evidenceDir, { repoRoot: bare })), /freeze companion digest absent/);
  assert.deepEqual(readdirSync(evidenceDir), []);
});

// ─── The persisted-artifact verifier ───────────────────────────────────────────

test('T2.2: verifyPersistedG0PinInvariance rejects malformed, stale, mismatched and edited evidence', () => {
  const base = lawfulArgs('');
  const lawful = (evidenceDir) => ({ evidenceDir, apparatus_identity: base.apparatus_identity, freeze_companion_digest: base.freeze_companion_digest, g0_record_id: base.g0_record_id });

  const plant = (over = {}, raw = null) => {
    const evidenceDir = tmpEvidenceDir();
    const rec = withId({
      record_kind: 'pin-invariance', schema_version: '1.0.0', cycle: 'cycle-005', event: 'g0',
      asset_count: FROZEN_PIN_ASSET_COUNT, all_match: true, companion_match: true, mismatches: [],
      apparatus_identity: base.apparatus_identity, freeze_companion_digest: base.freeze_companion_digest,
      refs: { g0: base.g0_record_id }, ...over,
    });
    writeFileSync(join(evidenceDir, PIN_INVARIANCE_G0_NAME), raw === null ? canonicalize(rec) + '\n' : raw);
    return evidenceDir;
  };

  assert.throws(() => verifyPersistedG0PinInvariance(lawful(tmpEvidenceDir())), /was not persisted/);
  assert.throws(() => verifyPersistedG0PinInvariance(lawful(plant({}, '{ not json'))), /malformed/);
  assert.throws(() => verifyPersistedG0PinInvariance(lawful(plant({}, '[]\n'))), /not a JSON object/);
  assert.throws(() => verifyPersistedG0PinInvariance(lawful(plant({ record_kind: 'halt' }))), /record_kind must be "pin-invariance"/);
  assert.throws(() => verifyPersistedG0PinInvariance(lawful(plant({ cycle: 'cycle-004' }))), /not a cycle-005 record/);
  assert.throws(() => verifyPersistedG0PinInvariance(lawful(plant({ event: 'terminal' }))), /event must be "g0"/);
  assert.throws(() => verifyPersistedG0PinInvariance(lawful(plant({ asset_count: 42 }))), /asset_count must be 43/);
  assert.throws(() => verifyPersistedG0PinInvariance(lawful(plant({ all_match: false }))), /all_match is not true/);
  assert.throws(() => verifyPersistedG0PinInvariance(lawful(plant({ companion_match: false }))), /companion_match is not true/);
  assert.throws(() => verifyPersistedG0PinInvariance(lawful(plant({ mismatches: [{ path: 'x', reason: 'y' }] }))), /reports mismatches/);
  assert.throws(() => verifyPersistedG0PinInvariance(lawful(plant({ apparatus_identity: 'sha256:other' }))), /STALE PIN EVIDENCE/);
  assert.throws(() => verifyPersistedG0PinInvariance(lawful(plant({ freeze_companion_digest: 'sha256:other' }))), /names another freeze companion/);
  assert.throws(() => verifyPersistedG0PinInvariance(lawful(plant({ refs: { g0: 'sha256:other' } }))), /does not reference the governing G0/);
  assert.throws(() => verifyPersistedG0PinInvariance(lawful(plant({ refs: null }))), /does not reference the governing G0/);

  // A body edited under a retained record_id, and bytes that are not the canonical form.
  const edited = tmpEvidenceDir();
  const rec = prepareG0PinInvariance(lawfulArgs(edited));
  writeFileSync(join(edited, PIN_INVARIANCE_G0_NAME), canonicalize({ ...rec, apparatus_identity: 'sha256:swapped' }) + '\n');
  assert.throws(() => verifyPersistedG0PinInvariance(lawful(edited)), /record_id does not verify/);

  const noncanonical = tmpEvidenceDir();
  const rec2 = prepareG0PinInvariance(lawfulArgs(noncanonical));
  writeFileSync(join(noncanonical, PIN_INVARIANCE_G0_NAME), JSON.stringify(rec2, null, 2) + '\n');
  assert.throws(() => verifyPersistedG0PinInvariance(lawful(noncanonical)), /not the canonical form/);
});

// ─── End to end: main --execute driven by the PRODUCTION preparer ──────────────

/**
 * An authority fixture rooted at the REAL repository, so `main` re-hashes a real
 * apparatus asset and the production preparer reads the real Cycle-004 freeze. All
 * evidence lands in a temporary directory; the repository evidence directory is never
 * written. The transport is injected and always refuses, so each candidate lands a
 * lawful §9.1 class-3 outcome and no provider is contacted.
 */
function realRootAuthority() {
  const evidenceDir = tmpEvidenceDir();
  const methodSetText = readFileSync(join(REPO_ROOT, METHOD_SET_REL), 'utf8');
  const manifest = {
    manifest_kind: 'acquisition',
    schema_version: '1.0.0',
    cycle: 'cycle-005',
    assets: buildAssetInventory([{ path: METHOD_SET_REL, content: methodSetText }]),
    method_set: JSON.parse(methodSetText),
    freeze_ref: { companion_digest: LIVE_FREEZE_COMPANION },
    ledger_baselines: { trials_sha256: null, burn_bytes: 0 },
  };
  const manifestBytes = canonicalize(manifest) + '\n';
  const companion = sha256LFNormalized(manifestBytes);
  writeFileSync(join(evidenceDir, 'acquisition-manifest.json'), manifestBytes);
  writeFileSync(join(evidenceDir, 'acquisition-manifest.sha256'), companion + '\n');

  const accepted = { 1: { status: 'accepted' }, 2: { status: 'accepted' }, 3: { status: 'accepted' }, 4: { status: 'accepted' }, 5: { status: 'accepted' } };
  const gateA = withId({
    record_kind: 'gate-a-acceptance', schema_version: '1.0.0', gate: 'A', cycle: 'cycle-005',
    manifest_companion_digest: companion, apparatus_asset_count: manifest.assets.length,
    ud1_status: {
      history_years: { decision: 'accepted', intended_class: 'ii', candidates: accepted },
      n_observations: { decision: 'accepted class 3 for ranks 1-4 under the current apparatus', candidates: { 1: { status: 'accepted_class_3' }, 2: { status: 'accepted_class_3' }, 3: { status: 'accepted_class_3' }, 4: { status: 'accepted_class_3' }, 5: { status: 'method_accepted_lawful_not_exercised' } } },
    },
    ud2_status: { provider: 'EIA', decision: 'uncredentialed', credential_authorized: false },
    operator_statement: 'synthetic Gate-A acceptance for the production pin-invariance spec',
    at: '2026-01-01T00:00:00Z',
  });
  writeFileSync(join(evidenceDir, 'gate-a-acceptance.json'), canonicalize(gateA) + '\n');

  const g0 = withId({
    record_kind: 'g0-authorization', schema_version: '1.0.0', cycle: 'cycle-005',
    gate_a_ref: gateA.record_id, apparatus_manifest_companion_digest: companion,
    scope: {
      providers: ['USGS', 'NOAA', 'NWS/ISD'],
      method_ids: ['usgs-nwis-site-metadata', 'noaa-coops-station-metadata', 'noaa-ndbc-station-metadata', 'nws-isd-station-inventory'],
      route_classes: ['metadata', 'inventory'],
      credential_posture: 'uncredentialed',
      contact_params: { 'usgs-nwis-site-metadata': { sites: '01646500' }, 'noaa-coops-station-metadata': { station: '9414290' } },
      excluded_method_ids: ['eia-electricity-demand-count'],
      excluded_providers: ['EIA'],
    },
    operator_statement: 'synthetic G0 authorization for the production pin-invariance spec',
    at: '2026-01-01T00:00:00Z',
  });
  writeFileSync(join(evidenceDir, 'g0-authorization.json'), canonicalize(g0) + '\n');
  return { evidenceDir, companion, gateA, g0 };
}

test('T2.2: main --execute with the PRODUCTION preparer persists the artifact before the first transport', async () => {
  const fx = realRootAuthority();
  const order = [];
  const run = (io) => main(['--execute'], {
    repoRoot: REPO_ROOT, evidenceDir: fx.evidenceDir, io,
    now: () => '2026-01-01T00:00:00Z',
    stdout: () => {}, stderr: (s) => { order.push(`stderr:${s.trim().slice(0, 60)}`); },
  });

  const calls = [];
  const code = await run({
    fetchImpl: async (url) => {
      if (calls.length === 0) order.push(`pin-on-disk-at-first-contact:${existsSync(join(fx.evidenceDir, PIN_INVARIANCE_G0_NAME))}`);
      calls.push(url);
      throw new Error('injected transport refusal — no provider is contacted by this spec');
    },
    preparePinInvariance: prepareG0PinInvariance,
  });

  assert.equal(code, 0, 'four lawful class-3 refusals complete the pool');
  assert.equal(calls.length, 4, 'the four authorized candidates were attempted, one each');
  assert.ok(calls.every(u => !u.includes('api.eia.gov')), 'EIA is never contacted');
  assert.ok(order.includes('pin-on-disk-at-first-contact:true'), 'the artifact was durable before the wire was touched');

  const rec = JSON.parse(readFileSync(join(fx.evidenceDir, PIN_INVARIANCE_G0_NAME), 'utf8'));
  assert.equal(rec.asset_count, FROZEN_PIN_ASSET_COUNT);
  assert.equal(rec.all_match, true);
  assert.equal(rec.apparatus_identity, fx.companion, 'bound to the identity main verified');
  assert.equal(rec.freeze_companion_digest, LIVE_FREEZE_COMPANION);
  assert.equal(rec.refs.g0, fx.g0.record_id);
  assert.equal(readLedger(join(fx.evidenceDir, 'contact-log.jsonl')).length, 4, 'the pool ran to the end — the split does not deadlock');

  // A second invocation, same production preparer: refused before any transport.
  const before = readFileSync(join(fx.evidenceDir, PIN_INVARIANCE_G0_NAME), 'utf8');
  const secondCalls = [];
  let secondErr = '';
  const secondCode = await main(['--execute'], {
    repoRoot: REPO_ROOT, evidenceDir: fx.evidenceDir,
    io: { fetchImpl: async (u) => { secondCalls.push(u); throw new Error('unreachable'); }, preparePinInvariance: prepareG0PinInvariance },
    now: () => '2026-01-01T00:00:00Z',
    stdout: () => {}, stderr: (s) => { secondErr += s; },
  });
  assert.equal(secondCode, 1);
  assert.match(secondErr, /Cycle-005 acquisition evidence already exists/);
  assert.equal(secondCalls.length, 0, 'zero transport on the refused re-run');
  assert.equal(readFileSync(join(fx.evidenceDir, PIN_INVARIANCE_G0_NAME), 'utf8'), before, 'the artifact is byte-identical');
});

test('T2.2: the repository evidence directory holds no live pin-invariance artifact', () => {
  // This node builds the production boundary; it does not exercise it against the real
  // evidence directory. A live artifact there would be un-adjudicated run evidence.
  assert.ok(!existsSync(join(REPO_ROOT, 'lab/evidence/cycle-005', PIN_INVARIANCE_G0_NAME)), 'no live g0 pin-invariance record exists');
  assert.ok(!existsSync(join(REPO_ROOT, 'lab/evidence/cycle-005/g0-authorization.json')), 'no G0 authorization exists');
});
