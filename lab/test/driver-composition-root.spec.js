// lab/test/driver-composition-root.spec.js
//
// Cycle-005 S02 (PRD FR-B1/FR-E3; SDD DR-2; Sprint Plan T2.1/T2.2;
// 27-cycle-005-task-2-2-pre-contact-pin-invariance-review.md §5 — operator Design A).
//
// The PRODUCTION composition root — `lab/driver/acquire-run.js`. This spec proves that
//
//   - the driver runs the REAL acquisition entry point with the REAL production
//     pin-invariance preparer, and the artifact is durable before the first transport;
//   - the driver is INSIDE the apparatus identity: the tracked acquisition manifest
//     enumerates it, and `verifyAcquisitionIdentity` re-hashes it;
//   - a driver whose bytes differ from the accepted manifest refuses BEFORE transport
//     with an identity-drift refusal — the property that makes the injected preparer
//     trustworthy at all (review 27 §4.3);
//   - the driver carries NO policy: it names no provider, route, method, rank,
//     parameter or credential; it passes `argv` through untouched; and it constructs
//     the `io` bag itself, so no caller can substitute the preparer or a transport;
//   - scope, order and count come from the G0 record, not from the driver;
//   - absent / stale Gate-A or G0 authority still blocks execution through the driver;
//   - an interrupted run's pin-invariance artifact blocks a restart through the driver;
//   - and no alternative, unpinned production execution path exists in the repository.
//
// Every fixture writes into a temporary directory. Transport is exercised by replacing
// `globalThis.fetch` — deliberately, because the driver injects no transport of its own,
// so a stub there is the only way a request could be observed. NO REAL NETWORK REQUEST
// IS MADE and no provider is contacted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAcquisition, REPO_ROOT as DRIVER_REPO_ROOT, EVIDENCE_DIR_REL } from '../driver/acquire-run.js';
import { APPARATUS_NAMESPACES, verifyAcquisitionIdentity, companionDigestPath } from '../resolution/identity.js';
import { prepareG0PinInvariance, PIN_INVARIANCE_G0_NAME } from '../resolution/pin-invariance.js';
import { FROZEN_PIN_ASSET_COUNT } from '../acquisition/acquire.js';
import { buildAssetInventory, contentAddress, sha256LFNormalized } from '../harness/manifests.js';
import { canonicalize } from '../../src/receipt/canonicalize.js';
import { readLedger } from '../harness/ledgers.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DRIVER_REL = 'lab/driver/acquire-run.js';
const METHOD_SET_REL = 'lab/acquisition/method-set.json';
const FREEZE_COMPANION_REL = 'lab/freeze/freeze-manifest.sha256';
const LIVE_EVIDENCE_DIR = join(REPO_ROOT, EVIDENCE_DIR_REL);

/** The live Cycle-004 freeze companion digest — the anchor a lawful record must name. */
const LIVE_FREEZE_COMPANION = readFileSync(join(REPO_ROOT, FREEZE_COMPANION_REL), 'utf8').trim();

const tmpEvidenceDir = () => mkdtempSync(join(tmpdir(), 'c005-drv-'));

/** A one-shot record with its DR-4.3 self-excluded content id. */
const withId = (rec) => ({ ...rec, record_id: contentAddress(rec) });

const ALL_METHODS = Object.freeze([
  'usgs-nwis-site-metadata',
  'noaa-coops-station-metadata',
  'noaa-ndbc-station-metadata',
  'nws-isd-station-inventory',
]);

/**
 * A synthetic evidence directory carrying a lawful authority chain over the REAL
 * repository tree. The manifest enumerates the REAL method set and the REAL driver, so
 * the contact-side seatbelt actually re-hashes `lab/driver/acquire-run.js`.
 *
 * `driverDigest` lets a caller record a digest that is NOT the driver's real one —
 * exactly the state a post-acceptance edit to the driver would produce.
 */
function lawfulAuthority({ driverDigest = null, methodIds = ALL_METHODS, staleGateA = false } = {}) {
  const evidenceDir = tmpEvidenceDir();
  const methodSetText = readFileSync(join(REPO_ROOT, METHOD_SET_REL), 'utf8');
  const driverText = readFileSync(join(REPO_ROOT, DRIVER_REL), 'utf8');
  const assets = buildAssetInventory([
    { path: METHOD_SET_REL, content: methodSetText },
    { path: DRIVER_REL, content: driverText },
  ]);
  if (driverDigest !== null) {
    for (const a of assets) if (a.path === DRIVER_REL) a.sha256 = driverDigest;
  }
  const manifest = {
    manifest_kind: 'acquisition',
    schema_version: '1.0.0',
    cycle: 'cycle-005',
    assets,
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
    manifest_companion_digest: staleGateA ? 'sha256:' + '0'.repeat(64) : companion,
    ud1_status: {
      history_years: { decision: 'accepted', intended_class: 'ii', candidates: accepted },
      n_observations: { decision: 'accepted class 3 for ranks 1-4 under the current apparatus', candidates: { 1: { status: 'accepted_class_3' }, 2: { status: 'accepted_class_3' }, 3: { status: 'accepted_class_3' }, 4: { status: 'accepted_class_3' }, 5: { status: 'method_accepted_lawful_not_exercised' } } },
    },
    ud2_status: { provider: 'EIA', decision: 'uncredentialed', credential_authorized: false },
    operator_statement: 'synthetic Gate-A acceptance for the composition-root spec',
    at: '2026-01-01T00:00:00Z',
  });
  writeFileSync(join(evidenceDir, 'gate-a-acceptance.json'), canonicalize(gateA) + '\n');

  const excluded = ['eia-electricity-demand-count', ...ALL_METHODS.filter(m => !methodIds.includes(m))].sort();
  const providersByMethod = {
    'usgs-nwis-site-metadata': 'USGS',
    'noaa-coops-station-metadata': 'NOAA',
    'noaa-ndbc-station-metadata': 'NOAA',
    'nws-isd-station-inventory': 'NWS/ISD',
  };
  const providers = [...new Set(methodIds.map(m => providersByMethod[m]))];
  const excludedProviders = ['USGS', 'NOAA', 'NWS/ISD', 'EIA'].filter(p => !providers.includes(p)).sort();
  const contactParams = {};
  if (methodIds.includes('usgs-nwis-site-metadata')) contactParams['usgs-nwis-site-metadata'] = { sites: '01646500' };
  if (methodIds.includes('noaa-coops-station-metadata')) contactParams['noaa-coops-station-metadata'] = { station: '9414290' };

  const g0 = withId({
    record_kind: 'g0-authorization', schema_version: '1.0.0', cycle: 'cycle-005',
    gate_a_ref: gateA.record_id, apparatus_manifest_companion_digest: companion,
    scope: {
      providers,
      method_ids: methodIds,
      route_classes: ['metadata', 'inventory'],
      credential_posture: 'uncredentialed',
      contact_params: contactParams,
      excluded_method_ids: excluded,
      excluded_providers: excludedProviders,
    },
    operator_statement: 'synthetic G0 authorization for the composition-root spec',
    at: '2026-01-01T00:00:00Z',
  });
  writeFileSync(join(evidenceDir, 'g0-authorization.json'), canonicalize(g0) + '\n');
  return { evidenceDir, companion, gateA, g0 };
}

/**
 * Run the driver with `globalThis.fetch` replaced by a recording stub that REFUSES
 * every request (a lawful §9.1 class-3 contact refusal). The driver injects no
 * transport, so this is the only surface through which a request could escape — and
 * every recorded URL is therefore proof of what the pinned apparatus decided to
 * attempt, not of anything the driver chose.
 */
async function driveWithStubbedTransport(argv, overrides, onFirstCall = () => {}) {
  const calls = [];
  const original = globalThis.fetch;
  let out = '';
  let err = '';
  try {
    globalThis.fetch = async (url) => {
      if (calls.length === 0) onFirstCall();
      calls.push(String(url));
      throw new Error('injected transport refusal — no provider is contacted by this spec');
    };
    const code = await runAcquisition(argv, { ...overrides, stdout: (s) => { out += s; }, stderr: (s) => { err += s; } });
    return { code, calls, out, err };
  } finally {
    globalThis.fetch = original;
  }
}

// ─── The driver is inside the apparatus identity ───────────────────────────────

test('Design A: lab/driver is an apparatus namespace and the tracked manifest enumerates the driver', () => {
  assert.ok(APPARATUS_NAMESPACES.includes('lab/driver'), 'the composition root is an enumerated apparatus namespace');

  const manifestPath = join(LIVE_EVIDENCE_DIR, 'acquisition-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const paths = manifest.assets.map(a => a.path);

  // EVERY driver source file is enumerated — not merely the one this spec knows about.
  const onDisk = readdirSync(join(REPO_ROOT, 'lab/driver'))
    .filter(n => n.endsWith('.js') || n.endsWith('.json'))
    .map(n => `lab/driver/${n}`)
    .sort();
  assert.ok(onDisk.length > 0, 'the driver namespace is non-empty');
  for (const p of onDisk) assert.ok(paths.includes(p), `${p} is enumerated in the acquisition manifest`);
  assert.ok(paths.includes(DRIVER_REL), 'the composition root itself is enumerated');

  const entry = manifest.assets.find(a => a.path === DRIVER_REL);
  assert.equal(entry.sha256, sha256LFNormalized(readFileSync(join(REPO_ROOT, DRIVER_REL), 'utf8')), 'the recorded digest is the live driver bytes');

  // …and the Lane B verifier agrees over the whole tracked identity.
  const v = verifyAcquisitionIdentity({ repoRoot: REPO_ROOT, manifestPath });
  assert.equal(v.companion_digest, readFileSync(companionDigestPath(manifestPath), 'utf8').trim(), 'companion agrees');
  assert.equal(v.asset_count, manifest.assets.length);
});

test('Design A: a driver whose bytes differ from the accepted manifest refuses BEFORE transport', async () => {
  const fx = lawfulAuthority({ driverDigest: 'sha256:' + 'f'.repeat(64) });
  const { code, calls, err } = await driveWithStubbedTransport(['--execute'], { repoRoot: REPO_ROOT, evidenceDir: fx.evidenceDir });
  assert.equal(code, 1, 'identity drift is a refusal');
  assert.match(err, /apparatus asset digest mismatch \(identity drift\)/);
  assert.match(err, /lab\/driver\/acquire-run\.js/, 'the refusal names the driver');
  assert.equal(calls.length, 0, 'zero transport');
  assert.ok(!existsSync(join(fx.evidenceDir, PIN_INVARIANCE_G0_NAME)), 'the refusal precedes pin-invariance preparation');
  assert.ok(!existsSync(join(fx.evidenceDir, 'contact-log.jsonl')), 'no evidence was appended');

  // --preflight is refused on the same drift: the seatbelt is not an --execute-only check.
  const pre = await driveWithStubbedTransport(['--preflight'], { repoRoot: REPO_ROOT, evidenceDir: fx.evidenceDir });
  assert.equal(pre.code, 1);
  assert.match(pre.err, /identity drift/);
  assert.equal(pre.calls.length, 0);
});

test('Design A: an EDITED driver file — not merely an edited manifest — refuses before transport', async () => {
  // The mirror image of the case above, and the one an attacker actually performs: the
  // manifest records the driver's REAL digest and the FILE is what changed. Reproduced
  // over a throwaway repository root so the repository's own driver is never touched.
  const altRoot = mkdtempSync(join(tmpdir(), 'c005-root-'));
  mkdirSync(join(altRoot, 'lab/driver'), { recursive: true });
  mkdirSync(join(altRoot, 'lab/acquisition'), { recursive: true });
  const methodSetText = readFileSync(join(REPO_ROOT, METHOD_SET_REL), 'utf8');
  const driverText = readFileSync(join(REPO_ROOT, DRIVER_REL), 'utf8');
  writeFileSync(join(altRoot, METHOD_SET_REL), methodSetText);
  // One added line of "harmless" commentary — enough to change the content address.
  writeFileSync(join(altRoot, DRIVER_REL), driverText + '// tampered\n');

  const evidenceDir = tmpEvidenceDir();
  const manifest = {
    manifest_kind: 'acquisition', schema_version: '1.0.0', cycle: 'cycle-005',
    assets: buildAssetInventory([
      { path: METHOD_SET_REL, content: methodSetText },
      { path: DRIVER_REL, content: driverText }, // the ACCEPTED (untampered) bytes
    ]),
    method_set: JSON.parse(methodSetText),
    freeze_ref: { companion_digest: LIVE_FREEZE_COMPANION },
    ledger_baselines: { trials_sha256: null, burn_bytes: 0 },
  };
  const bytes = canonicalize(manifest) + '\n';
  writeFileSync(join(evidenceDir, 'acquisition-manifest.json'), bytes);
  writeFileSync(join(evidenceDir, 'acquisition-manifest.sha256'), sha256LFNormalized(bytes) + '\n');

  const { code, calls, err } = await driveWithStubbedTransport(['--execute'], { repoRoot: altRoot, evidenceDir });
  assert.equal(code, 1);
  assert.match(err, /apparatus asset digest mismatch \(identity drift\)/);
  assert.match(err, /lab\/driver\/acquire-run\.js/);
  assert.equal(calls.length, 0, 'zero transport');
  assert.ok(!existsSync(join(evidenceDir, PIN_INVARIANCE_G0_NAME)), 'the refusal precedes pin-invariance preparation');
});

// ─── The driver executes the real entry point with the real preparer ───────────

test('Design A: the driver runs the real acquisition entry point with the real pin-invariance preparer', async () => {
  const fx = lawfulAuthority();
  let pinDurableAtFirstContact = null;
  const { code, calls, err } = await driveWithStubbedTransport(
    ['--execute'],
    { repoRoot: REPO_ROOT, evidenceDir: fx.evidenceDir },
    () => { pinDurableAtFirstContact = existsSync(join(fx.evidenceDir, PIN_INVARIANCE_G0_NAME)); },
  );

  assert.equal(code, 0, `four lawful class-3 refusals complete the pool (stderr: ${err})`);
  assert.equal(calls.length, 4, 'exactly the four authorized candidates were attempted, one each');
  assert.ok(calls.every(u => !u.includes('api.eia.gov')), 'EIA is never contacted');
  assert.equal(pinDurableAtFirstContact, true, 'the FR-E3 artifact was durable before the wire was touched');

  // The artifact is the production preparer's: 43/43 against the REAL Cycle-004 freeze,
  // bound to the identity `main` verified, the accepted freeze anchor and the G0 record.
  const rec = JSON.parse(readFileSync(join(fx.evidenceDir, PIN_INVARIANCE_G0_NAME), 'utf8'));
  assert.equal(rec.record_kind, 'pin-invariance');
  assert.equal(rec.event, 'g0');
  assert.equal(rec.asset_count, FROZEN_PIN_ASSET_COUNT);
  assert.equal(rec.all_match, true);
  assert.equal(rec.companion_match, true);
  assert.deepStrictEqual(rec.mismatches, []);
  assert.equal(rec.apparatus_identity, fx.companion);
  assert.equal(rec.freeze_companion_digest, LIVE_FREEZE_COMPANION);
  assert.equal(rec.refs.g0, fx.g0.record_id);
  const { record_id, ...body } = rec;
  assert.equal(record_id, contentAddress(body), 'DR-4.3 self-excluded record_id verifies');

  assert.equal(readLedger(join(fx.evidenceDir, 'contact-log.jsonl')).length, 4, 'the pool ran to the end — the one-shot split does not deadlock');
});

test('Design A: an interruption after persistence blocks a restart through the driver', async () => {
  // The post-interruption state, produced by the SAME production code path a real run
  // executes at the boundary: the artifact is durable, no ledger line was ever written.
  const fx = lawfulAuthority();
  prepareG0PinInvariance({
    repoRoot: REPO_ROOT,
    evidenceDir: fx.evidenceDir,
    apparatus_identity: fx.companion,
    freeze_companion_digest: LIVE_FREEZE_COMPANION,
    g0_record_id: fx.g0.record_id,
  });
  const before = readFileSync(join(fx.evidenceDir, PIN_INVARIANCE_G0_NAME), 'utf8');
  assert.ok(!existsSync(join(fx.evidenceDir, 'contact-log.jsonl')), 'the ledger set alone would not catch this state');

  const { code, calls, err } = await driveWithStubbedTransport(['--execute'], { repoRoot: REPO_ROOT, evidenceDir: fx.evidenceDir });
  assert.equal(code, 1);
  assert.equal(calls.length, 0, 'zero transport on the refused restart');
  assert.match(err, /Cycle-005 acquisition evidence already exists/);
  assert.match(err, /pin-invariance-g0\.json/);
  assert.match(err, /reached the pre-contact boundary/, 'the refusal claims only what the evidence supports');
  assert.doesNotMatch(err, /contact has already begun/);
  assert.equal(readFileSync(join(fx.evidenceDir, PIN_INVARIANCE_G0_NAME), 'utf8'), before, 'the artifact is byte-identical');
});

// ─── The driver holds no authority of its own ──────────────────────────────────

test('Design A: the driver constructs its own io — a caller cannot substitute the preparer or a transport', async () => {
  const fx = lawfulAuthority();
  let liarCalled = 0;
  const smuggled = [];
  // Every substitution a caller could attempt, offered at once.
  const overrides = {
    repoRoot: REPO_ROOT,
    evidenceDir: fx.evidenceDir,
    io: { preparePinInvariance: () => { liarCalled++; return { record_kind: 'pin-invariance', event: 'g0', all_match: true, companion_match: true, mismatches: [], cycle: 'cycle-005', asset_count: 43 }; } },
    preparePinInvariance: () => { liarCalled++; },
    fetchImpl: async (u) => { smuggled.push(u); throw new Error('smuggled'); },
    env: { FORGE_EIA_API_KEY: 'must-never-be-read' },
    now: () => '1970-01-01T00:00:00Z',
  };
  const { code, calls } = await driveWithStubbedTransport(['--execute'], overrides);

  assert.equal(code, 0);
  assert.equal(liarCalled, 0, 'no substituted preparer was ever invoked');
  assert.equal(smuggled.length, 0, 'no substituted transport was ever invoked');
  assert.equal(calls.length, 4, 'transport went through the apparatus default, observed at globalThis');
  const rec = JSON.parse(readFileSync(join(fx.evidenceDir, PIN_INVARIANCE_G0_NAME), 'utf8'));
  assert.equal(rec.apparatus_identity, fx.companion, 'the artifact is the production preparer’s, not the liar’s');
  assert.equal(rec.freeze_companion_digest, LIVE_FREEZE_COMPANION);
  // The wall-clock came from the apparatus, not the caller's frozen clock.
  const log = readLedger(join(fx.evidenceDir, 'contact-log.jsonl'));
  assert.ok(log.every(l => l.at !== '1970-01-01T00:00:00Z'), 'the caller could not pin the governance clock');
});

test('Design A: scope, order and count come from the G0 record — the driver is unchanged', async () => {
  const one = lawfulAuthority({ methodIds: ['noaa-ndbc-station-metadata'] });
  const r1 = await driveWithStubbedTransport(['--execute'], { repoRoot: REPO_ROOT, evidenceDir: one.evidenceDir });
  assert.equal(r1.code, 0);
  assert.equal(r1.calls.length, 1, 'a one-method G0 scope produces exactly one attempt');

  const two = lawfulAuthority({ methodIds: ['usgs-nwis-site-metadata', 'nws-isd-station-inventory'] });
  const r2 = await driveWithStubbedTransport(['--execute'], { repoRoot: REPO_ROOT, evidenceDir: two.evidenceDir });
  assert.equal(r2.code, 0);
  assert.equal(r2.calls.length, 2, 'a two-method G0 scope produces exactly two attempts');
  // Rank order is the apparatus's, derived from the accepted method set (USGS rank 1
  // before NWS/ISD rank 4) — the driver supplied no ordering.
  const ranks = readLedger(join(two.evidenceDir, 'contact-log.jsonl')).map(l => l.candidate_rank);
  assert.deepStrictEqual(ranks, [1, 4], 'frozen rank order, ascending');
});

test('Design A: the driver names no provider, route, method, rank, parameter or credential', () => {
  const src = readFileSync(join(REPO_ROOT, DRIVER_REL), 'utf8');
  // Provider + host + credential + scope vocabulary, as executable-looking literals.
  for (const forbidden of [/['"]USGS['"]/, /['"]NOAA['"]/, /['"]NWS\/ISD['"]/, /['"]EIA['"]/, /FORGE_[A-Z_]*API_KEY/, /waterservices|tidesandcurrents|ndbc\.noaa|ncei\.noaa|api\.eia/, /-site-metadata|-station-metadata|-station-inventory|-demand-count/, /contact_params|method_ids|route_classes|credential_posture|excluded_/]) {
    assert.doesNotMatch(src, forbidden, `the composition root must not carry ${forbidden}`);
  }
  // No environment read and no clock of its own.
  assert.doesNotMatch(src, /process\.env/, 'the driver reads no environment');
  assert.doesNotMatch(src, /new Date|Date\.now/, 'the driver supplies no clock');
  // No flag vocabulary of its own, and no override/resume/bypass surface (R-4).
  assert.doesNotMatch(src, /--resume|--force|--again|--rerun|LOA_[A-Z_]*(FORCE|RESUME|OVERRIDE)/, 'no bypass flag or env escape is offered');
  assert.doesNotMatch(src, /argv\.(includes|indexOf|filter|some)|parseArgs\s*\(/, 'the driver parses no arguments — parseArgs remains the sole argument authority');
});

test('Design A: argv reaches the apparatus untouched — unknown arguments still refuse', async () => {
  const fx = lawfulAuthority();
  for (const bad of ['--force', '--resume', '--rerun', '--evidence-dir=/tmp/x']) {
    const { code, calls, err } = await driveWithStubbedTransport([bad], { repoRoot: REPO_ROOT, evidenceDir: fx.evidenceDir });
    assert.equal(code, 1, `${bad} is refused`);
    assert.match(err, /unknown argument/);
    assert.equal(calls.length, 0, `${bad} performs zero transport`);
  }
  // …and the default is the non-contacting one.
  const dflt = await driveWithStubbedTransport([], { repoRoot: REPO_ROOT, evidenceDir: fx.evidenceDir });
  assert.equal(dflt.code, 0);
  assert.equal(dflt.calls.length, 0, 'the default performs no transport');
  assert.match(dflt.out, /--preflight — no provider was contacted/);
  assert.ok(!existsSync(join(fx.evidenceDir, PIN_INVARIANCE_G0_NAME)), 'preflight prepares no pin evidence');
});

// ─── Authority still governs when the driver is the caller ─────────────────────

test('Design A: absent or stale Gate-A / G0 authority still blocks execution through the driver', async () => {
  const stale = lawfulAuthority({ staleGateA: true });
  const r1 = await driveWithStubbedTransport(['--execute'], { repoRoot: REPO_ROOT, evidenceDir: stale.evidenceDir });
  assert.equal(r1.code, 1);
  assert.match(r1.err, /STALE GATE-A AUTHORITY/);
  assert.equal(r1.calls.length, 0);
  assert.ok(!existsSync(join(stale.evidenceDir, PIN_INVARIANCE_G0_NAME)));

  const bare = tmpEvidenceDir();
  const r2 = await driveWithStubbedTransport(['--execute'], { repoRoot: REPO_ROOT, evidenceDir: bare });
  assert.equal(r2.code, 1);
  assert.match(r2.err, /acquisition manifest not found/);
  assert.equal(r2.calls.length, 0);
  assert.deepStrictEqual(readdirSync(bare), [], 'a refusal writes nothing');
});

test('Design A: the driver defaults to the real repository paths, and an isolated run against them writes nothing live', async () => {
  // The driver's own default paths are the repository's — checked as values, never by
  // invoking runAcquisition with BOTH repoRoot and evidenceDir left to default. Once a
  // lawful G0 exists (as it now does), that call would consume the live one-shot gate
  // and persist real run evidence — exactly the hazard this spec must not reproduce.
  assert.equal(DRIVER_REPO_ROOT.replace(/\\/g, '/'), REPO_ROOT.replace(/\\/g, '/'));
  assert.equal(EVIDENCE_DIR_REL, 'lab/evidence/cycle-005');

  const before = readdirSync(LIVE_EVIDENCE_DIR).sort();
  const isolated = tmpEvidenceDir();
  assert.ok(!existsSync(join(isolated, PIN_INVARIANCE_G0_NAME)), 'absent before the run in the isolated evidence root');

  const { code, calls, err } = await driveWithStubbedTransport(['--execute'], { repoRoot: REPO_ROOT, evidenceDir: isolated });
  assert.equal(code, 1, 'no gate records exist in the isolated evidence directory');
  assert.match(err, /acquisition manifest not found/);
  assert.equal(calls.length, 0, 'ZERO transport');
  assert.deepStrictEqual(readdirSync(LIVE_EVIDENCE_DIR).sort(), before, 'the real evidence directory is unchanged');
  assert.deepStrictEqual(readdirSync(isolated), [], 'the isolated evidence root — the one actually exercised — received no evidence; the refusal preceded pin-invariance preparation');
});

// ─── Exclusivity: no other production execution path ───────────────────────────

/** Every `.js` under a repo-relative directory (absent directories yield nothing). */
function repoJsFiles(rel) {
  const abs = join(REPO_ROOT, rel);
  let entries;
  try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const ent of entries) {
    const childRel = `${rel}/${ent.name}`;
    if (ent.isDirectory()) out.push(...repoJsFiles(childRel));
    else if (ent.isFile() && (ent.name.endsWith('.js') || ent.name.endsWith('.mjs'))) out.push(childRel);
  }
  return out;
}

test('Design A: the composition root is the ONLY production execution path', () => {
  // (a) Nothing outside lab/driver/** and lab/test/** names the acquisition entry point.
  const scanned = ['lab', 'src', 'bin', 'scripts'].flatMap(repoJsFiles);
  const importers = scanned.filter(rel => /\bfrom\s+['"][^'"]*acquisition\/acquire\.js['"]/.test(readFileSync(join(REPO_ROOT, rel), 'utf8')));
  const unexpected = importers.filter(rel => !rel.startsWith('lab/driver/') && !rel.startsWith('lab/test/'));
  assert.deepStrictEqual(unexpected, [], 'only the composition root and the specs import acquire.js');
  assert.ok(importers.includes(DRIVER_REL), 'the composition root does import it (the lint is non-vacuous)');

  // (b) `acquire.js` itself carries no self-invocation tail — it is library-only, so the
  //     entry point cannot be reached except through a pinned, enumerated driver.
  const acqSrc = readFileSync(join(REPO_ROOT, 'lab/acquisition/acquire.js'), 'utf8');
  assert.doesNotMatch(acqSrc, /pathToFileURL/, 'acquire.js has no CLI self-invocation tail');

  // (c) No packaged entry point routes around the apparatus.
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.bin, undefined, 'no bin entry exposes an acquisition command');
  for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
    assert.doesNotMatch(cmd, /acquire|lab\/driver/, `npm script "${name}" must not invoke acquisition`);
  }

  // (d) No workflow invokes it either.
  for (const wf of readdirSync(join(REPO_ROOT, '.github/workflows'))) {
    const src = readFileSync(join(REPO_ROOT, '.github/workflows', wf), 'utf8');
    assert.doesNotMatch(src, /acquire/, `.github/workflows/${wf} must not invoke acquisition`);
  }

  // (e) …and the only driver module is a regular file inside the identity.
  const drivers = readdirSync(join(REPO_ROOT, 'lab/driver'));
  assert.deepStrictEqual(drivers.sort(), ['acquire-run.js']);
  assert.ok(statSync(join(REPO_ROOT, DRIVER_REL)).isFile());
});
