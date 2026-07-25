// lab/test/acquisition-cli.spec.js
//
// Cycle-005 pre-G0 apparatus remediation (PRD FR-A5/FR-A7, FR-B1/FR-B2/FR-B4,
// FR-E3, NFR-CONTAM-1..4, NFR-HALT; SDD DR-2/DR-3/DR-4.4; Sprint Plan T2.1/T2.2;
// 15-cycle-005-g0-decision-brief.md §1.3 M2/M3/M4/M6).
//
// The operator execution surface: `acquire.js main()`. This spec proves that
//
//   - authority is MECHANICALLY bound, not merely present: the Gate-A record must be
//     valid, self-consistent, and accepted AT the live apparatus identity; the G0
//     record must reference that exact Gate-A record and the live identity; its
//     scope (providers / methods / route classes / pinned parameters / credential
//     posture / exclusions) must validate against the frozen route table (M3);
//   - a stale, malformed, absent or mismatched authority performs ZERO transport;
//   - EIA and every other unauthorized candidate cannot enter execution, and
//     FORGE_EIA_API_KEY is never required or exercised;
//   - `pin-invariance-g0` evidence is prepared BEFORE the first transport call (T2.1);
//   - a contact or extraction refusal is evidenced as §9.1 class 3 and the pool
//     CONTINUES, never erasing evidence already earned by earlier candidates (M4);
//   - a class-4 outcome halts immediately and orphans every later rank;
//   - `route_class` comes from the route table — rank 4 is `inventory` (M6);
//   - candidate ordering and contact-log sequence identity are deterministic.
//
// Every fixture is a temporary synthetic apparatus with an INJECTED transport. No
// live provider request occurs, and the real evidence directory is never written.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main, acquirePool, parseArgs, verifyContactAuthority, deriveAuthorizedCandidates, requiredContactParams, findHaltRecords, assertNoGoverningHalt, findPriorAcquisitionEvidence, assertNoPriorAcquisition, HALT_RECORD_NAME, AcquisitionRefusal } from '../acquisition/acquire.js';
import { ROUTES } from '../acquisition/routes.js';
import { buildAssetInventory, contentAddress, sha256LFNormalized } from '../harness/manifests.js';
import { canonicalize } from '../../src/receipt/canonicalize.js';
import { readLedger } from '../harness/ledgers.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const METHOD_SET_REL = 'lab/acquisition/method-set.json';

const AUTHORIZED_METHODS = Object.freeze([
  'usgs-nwis-site-metadata',
  'noaa-coops-station-metadata',
  'noaa-ndbc-station-metadata',
  'nws-isd-station-inventory',
]);

/** A one-shot record with its DR-4.3 self-excluded content id. */
const withId = (rec) => ({ ...rec, record_id: contentAddress(rec) });

/** The provider-response rehearsal fixture bodies (LF-joined). */
function usgsFixture(name) {
  const f = JSON.parse(readFileSync(join(REPO_ROOT, 'lab/acquisition/fixtures/provider-responses/usgs-nwis-site-rdb.json'), 'utf8'));
  return f.responses[name].body_lines.join('\n');
}

// Shaped to the header the ACCEPTED extractor parses (unquoted column names —
// lab/test/acquisition-extract.spec.js:50). Whether the live `isd-history.csv`
// quotes its header cannot be verified pre-contact without contacting a configured
// host; if it does, rank 4 lands class 3 by `extraction_refused` rather than by a
// null n_observations — the same §9.1 class, a different recorded reason.
const ISD_CSV = [
  'USAF,WBAN,STATION NAME,CTRY,STATE,ICAO,LAT,LON,ELEV(M),BEGIN,END',
  '724050,13743,RONALD REAGAN WASHINGTON NATL AP,US,VA,KDCA,+38.848,-077.034,+00004.0,19360101,20260723',
  '725030,14732,LA GUARDIA AIRPORT,US,NY,KLGA,+40.779,-073.880,+00003.4,19730101,20260723',
  '',
].join('\n');

const NDBC_TABLE = [
  '#STATION_ID|OWNER|TTYPE|HULL|NAME|PAYLOAD|LOCATION|TIMEZONE|FORECAST|NOTE',
  '41001|NDBC|Buoy|3-meter foam|EAST HATTERAS - 150 NM East of Cape Hatteras|AMPS|34.724 N 72.317 W|E||',
  '',
].join('\n');

/**
 * Build a synthetic apparatus root: the real method set as the single hashed asset,
 * a manifest pair over it, and (optionally) the two gate records bound to that
 * identity. `mutate` may edit either gate record body before it is content-addressed.
 */
function synthAuthority({ gateA: gateAOverride = null, g0: g0Override = null, withGateA = true, withG0 = true, drift = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'c005-cli-'));
  const evidenceDir = join(root, 'evidence');
  mkdirSync(join(root, 'lab', 'acquisition'), { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });

  const methodSetText = readFileSync(join(REPO_ROOT, METHOD_SET_REL), 'utf8');
  writeFileSync(join(root, METHOD_SET_REL), methodSetText);

  const manifest = {
    manifest_kind: 'acquisition',
    schema_version: '1.0.0',
    cycle: 'cycle-005',
    assets: buildAssetInventory([{ path: METHOD_SET_REL, content: methodSetText }]),
    method_set: JSON.parse(methodSetText),
    freeze_ref: { companion_digest: 'sha256:synthetic' },
    ledger_baselines: { trials_sha256: null, burn_bytes: 0 },
  };
  const manifestBytes = canonicalize(manifest) + '\n';
  const companion = sha256LFNormalized(manifestBytes);
  writeFileSync(join(evidenceDir, 'acquisition-manifest.json'), manifestBytes);
  writeFileSync(join(evidenceDir, 'acquisition-manifest.sha256'), companion + '\n');
  if (drift) writeFileSync(join(root, METHOD_SET_REL), methodSetText + '\n');

  const acceptedCandidates = { 1: { status: 'accepted' }, 2: { status: 'accepted' }, 3: { status: 'accepted' }, 4: { status: 'accepted' }, 5: { status: 'accepted' } };
  const gateA = withId(gateAOverride ? gateAOverride(companion) : {
    record_kind: 'gate-a-acceptance',
    schema_version: '1.0.0',
    gate: 'A',
    cycle: 'cycle-005',
    manifest_companion_digest: companion,
    apparatus_asset_count: manifest.assets.length,
    ud1_status: {
      history_years: { decision: 'accepted', intended_class: 'ii', candidates: acceptedCandidates },
      n_observations: { decision: 'accepted class 3 for ranks 1-4 under the current apparatus', candidates: { 1: { status: 'accepted_class_3' }, 2: { status: 'accepted_class_3' }, 3: { status: 'accepted_class_3' }, 4: { status: 'accepted_class_3' }, 5: { status: 'method_accepted_lawful_not_exercised' } } },
    },
    ud2_status: { provider: 'EIA', decision: 'uncredentialed', credential_authorized: false },
    operator_statement: 'synthetic Gate-A acceptance for the acquisition CLI spec',
    at: '2026-01-01T00:00:00Z',
  });
  if (withGateA) writeFileSync(join(evidenceDir, 'gate-a-acceptance.json'), canonicalize(gateA) + '\n');

  const g0 = withId(g0Override ? g0Override({ companion, gateARef: gateA.record_id }) : {
    record_kind: 'g0-authorization',
    schema_version: '1.0.0',
    cycle: 'cycle-005',
    gate_a_ref: gateA.record_id,
    apparatus_manifest_companion_digest: companion,
    scope: {
      providers: ['USGS', 'NOAA', 'NWS/ISD'],
      method_ids: [...AUTHORIZED_METHODS],
      route_classes: ['metadata', 'inventory'],
      credential_posture: 'uncredentialed',
      contact_params: {
        'usgs-nwis-site-metadata': { sites: '01646500' },
        'noaa-coops-station-metadata': { station: '9414290' },
      },
      excluded_method_ids: ['eia-electricity-demand-count'],
      excluded_providers: ['EIA'],
    },
    operator_statement: 'synthetic G0 authorization for the acquisition CLI spec',
    at: '2026-01-01T00:00:00Z',
  });
  if (withG0) writeFileSync(join(evidenceDir, 'g0-authorization.json'), canonicalize(g0) + '\n');

  return { root, evidenceDir, companion, gateA, g0 };
}

/** Run main() capturing streams; `io` carries the injected transport + hooks. */
async function runMain(argv, { root, evidenceDir }, io = {}) {
  let out = '', err = '';
  const code = await main(argv, {
    repoRoot: root, evidenceDir, io,
    now: () => '2026-01-01T00:00:00Z',
    stdout: (s) => { out += s; },
    stderr: (s) => { err += s; },
  });
  return { code, out, err };
}

/**
 * A transport stub: `bodies` maps a host substring to a response spec
 * (`{ body, contentType, status?, location? }`) or a thrower (`{ throws }`).
 */
function transport(bodies, calls) {
  return async (url) => {
    calls.push(url);
    const key = Object.keys(bodies).find(h => url.includes(h));
    assert.ok(key, `injected transport has no body for ${url}`);
    const entry = bodies[key];
    if (entry.throws) throw new Error(entry.throws);
    const headers = { 'content-type': entry.contentType ?? null, location: entry.location ?? null };
    return {
      status: entry.status ?? 200,
      headers: { get: (h) => headers[h.toLowerCase()] ?? null },
      arrayBuffer: async () => Buffer.from(entry.body ?? '', 'utf8'),
      body: null,
    };
  };
}

const OK_BODIES = () => ({
  'waterservices.usgs.gov': { body: usgsFixture('catalog_conformant'), contentType: 'text/plain' },
  'api.tidesandcurrents.noaa.gov': { body: JSON.stringify({ details: {} }), contentType: 'application/json' },
  'www.ndbc.noaa.gov': { body: NDBC_TABLE, contentType: 'text/plain' },
  'www.ncei.noaa.gov': { body: ISD_CSV, contentType: 'text/csv' },
});

// ─── Preflight: authority binding, zero transport ──────────────────────────────

test('M2: --preflight verifies the full authority chain and contacts nothing', async () => {
  const fx = synthAuthority();
  const calls = [];
  const { code, out } = await runMain(['--preflight'], fx, { fetchImpl: transport(OK_BODIES(), calls) });
  assert.equal(code, 0);
  assert.equal(calls.length, 0, 'preflight performs no transport');
  assert.match(out, /authority verified/);
  assert.match(out, /rank 1 {2}USGS/);
  assert.match(out, /excluded methods {3}: eia-electricity-demand-count/);
  assert.ok(!existsSync(join(fx.evidenceDir, 'contact-log.jsonl')), 'no contact log is written by preflight');
});

test('M2: the default (no argument) mode is preflight, and an unknown argument is refused', async () => {
  const fx = synthAuthority();
  const calls = [];
  const dflt = await runMain([], fx, { fetchImpl: transport(OK_BODIES(), calls) });
  assert.equal(dflt.code, 0);
  assert.equal(calls.length, 0);
  const bad = await runMain(['--yolo'], fx, { fetchImpl: transport(OK_BODIES(), calls) });
  assert.equal(bad.code, 1);
  assert.match(bad.err, /unknown argument "--yolo"/);
  assert.equal(calls.length, 0);
});

test('M2: the derived scope is exactly the authorized ranks 1-4, in rank order, with table route classes', () => {
  const fx = synthAuthority();
  const a = verifyContactAuthority({ repoRoot: fx.root, evidenceDir: fx.evidenceDir });
  assert.deepEqual(a.candidates.map(c => c.rank), [1, 2, 3, 4]);
  assert.deepEqual(a.candidates.map(c => c.route_method_id), AUTHORIZED_METHODS);
  assert.deepEqual(a.candidates.map(c => c.route_class), ['metadata', 'metadata', 'metadata', 'inventory']);
  assert.deepEqual(a.candidates[0].contact_params, { sites: '01646500' });
  assert.deepEqual(a.candidates[2].contact_params, {}, 'a paramless route takes no parameters');
  // Gate-A UD-1 acceptance is READ from the record, never assumed.
  assert.equal(a.candidates[0].operator_accepted.history_years, true);
  assert.equal(a.candidates[0].operator_accepted.n_observations, false, 'accepted_class_3 is not an acceptance');
  assert.equal(a.candidates[0].operator_accepted.span, false, 'a field absent from ud1_status is fail-closed');
});

// ─── No transport on absent / stale / malformed / mismatched authority ─────────

const REFUSALS = [
  ['the Gate-A record is absent', () => synthAuthority({ withGateA: false }), /gate record absent: gate-a-acceptance\.json/],
  ['the G0 record is absent', () => synthAuthority({ withG0: false }), /gate record absent: g0-authorization\.json/],
  ['the apparatus has drifted from the accepted identity', () => synthAuthority({ drift: true }), /identity drift/],
  ['the Gate-A record is STALE (accepted at another identity)', () => synthAuthority({
    gateA: () => ({ record_kind: 'gate-a-acceptance', gate: 'A', cycle: 'cycle-005', manifest_companion_digest: 'sha256:0000', operator_statement: 'x', at: 'x' }),
  }), /STALE GATE-A AUTHORITY/],
  ['the Gate-A record_id was edited after acceptance', () => {
    const fx = synthAuthority();
    const rec = JSON.parse(readFileSync(join(fx.evidenceDir, 'gate-a-acceptance.json'), 'utf8'));
    rec.operator_statement = 'tampered';
    writeFileSync(join(fx.evidenceDir, 'gate-a-acceptance.json'), canonicalize(rec) + '\n');
    return fx;
  }, /record_id does not match its content/],
  ['the G0 record is malformed JSON', () => {
    const fx = synthAuthority();
    writeFileSync(join(fx.evidenceDir, 'g0-authorization.json'), '{ not json\n');
    return fx;
  }, /malformed gate record g0-authorization\.json/],
  ['the G0 record references a different Gate-A record', () => synthAuthority({
    g0: ({ companion }) => baseG0({ companion, gateARef: 'sha256:some-other-gate-a' }),
  }), /does not reference the current Gate-A record/],
  ['the G0 record references a different apparatus identity', () => synthAuthority({
    g0: ({ gateARef }) => baseG0({ companion: 'sha256:stale-apparatus', gateARef }),
  }), /is not the live apparatus identity/],
  ['the G0 scope leaves a frozen route undisposed', () => synthAuthority({
    g0: (ctx) => mutateScope(baseG0(ctx), s => { s.excluded_method_ids = []; }),
  }), /does not dispose of every frozen route/],
  ['the G0 scope authorizes the credentialed EIA route', () => synthAuthority({
    g0: (ctx) => mutateScope(baseG0(ctx), s => {
      s.method_ids = [...AUTHORIZED_METHODS, 'eia-electricity-demand-count'];
      s.excluded_method_ids = [];
      s.providers = ['USGS', 'NOAA', 'NWS/ISD', 'EIA'];
      s.excluded_providers = [];
      s.route_classes = ['metadata', 'inventory', 'series-metadata'];
      s.contact_params['eia-electricity-demand-count'] = { period_of_record_start: '2015-01-01' };
    }),
  }), /authorizes credentialed route "eia-electricity-demand-count"/],
  ['the G0 credential posture is not uncredentialed', () => synthAuthority({
    g0: (ctx) => mutateScope(baseG0(ctx), s => { s.credential_posture = 'credentialed'; }),
  }), /credential_posture must be "uncredentialed"/],
  ['the G0 scope omits a route class it authorizes', () => synthAuthority({
    g0: (ctx) => mutateScope(baseG0(ctx), s => { s.route_classes = ['metadata']; }),
  }), /route_class "inventory" is not in route_classes/],
  ['the G0 scope omits a provider it authorizes', () => synthAuthority({
    g0: (ctx) => mutateScope(baseG0(ctx), s => { s.providers = ['USGS', 'NOAA']; }),
  }), /provider "NWS\/ISD" is not in providers/],
  ['the G0 scope carries an unauthorized contact parameter', () => synthAuthority({
    g0: (ctx) => mutateScope(baseG0(ctx), s => { s.contact_params['usgs-nwis-site-metadata'].siteStatus = 'all'; }),
  }), /unauthorized parameter "siteStatus"/],
  ['the G0 scope omits a pinned contact parameter', () => synthAuthority({
    g0: (ctx) => mutateScope(baseG0(ctx), s => { delete s.contact_params['noaa-coops-station-metadata']; }),
  }), /missing pinned parameter "station"/],
  ['the G0 scope names a credential as a parameter', () => synthAuthority({
    g0: (ctx) => mutateScope(baseG0(ctx), s => { s.contact_params['usgs-nwis-site-metadata'].api_key = 'PLANTED'; }),
  }), /a credential is never a scope parameter/],
  ['the G0 excluded-provider list is untruthful', () => synthAuthority({
    g0: (ctx) => mutateScope(baseG0(ctx), s => { s.excluded_providers = []; }),
  }), /excluded_providers \[\] does not match/],
  // F1: a PATH-templated parameter may name a pinned identifier, never path structure.
  ['the G0 scope pins a path parameter that would retarget the route (reviewed F-1 reproduction)', () => synthAuthority({
    g0: (ctx) => mutateScope(baseG0(ctx), s => { s.contact_params['noaa-coops-station-metadata'].station = '../../../../api/prod/datagetter?product=water_level&begin_date=20200101#'; }),
  }), /path param "station" is not a bounded path segment/],
  ['the G0 scope pins a path parameter with an added path segment', () => synthAuthority({
    g0: (ctx) => mutateScope(baseG0(ctx), s => { s.contact_params['noaa-coops-station-metadata'].station = '9414290/details'; }),
  }), /path param "station" is not a bounded path segment/],
  ['the G0 scope pins a path parameter with an encoded separator', () => synthAuthority({
    g0: (ctx) => mutateScope(baseG0(ctx), s => { s.contact_params['noaa-coops-station-metadata'].station = '9414290%2F..%2Fdatagetter'; }),
  }), /path param "station" is not a bounded path segment/],
  ['the G0 scope pins a relative path segment', () => synthAuthority({
    g0: (ctx) => mutateScope(baseG0(ctx), s => { s.contact_params['noaa-coops-station-metadata'].station = '..'; }),
  }), /path param "station" (is not a bounded path segment|must not be a relative path segment)/],
  ['the G0 scope pins an unbounded path parameter', () => synthAuthority({
    g0: (ctx) => mutateScope(baseG0(ctx), s => { s.contact_params['noaa-coops-station-metadata'].station = '9'.repeat(200); }),
  }), /exceeds the 128-character path-segment bound/],
];

/** The canonical synthetic G0 body (pre content-address). */
function baseG0({ companion, gateARef }) {
  return {
    record_kind: 'g0-authorization',
    schema_version: '1.0.0',
    cycle: 'cycle-005',
    gate_a_ref: gateARef,
    apparatus_manifest_companion_digest: companion,
    scope: {
      providers: ['USGS', 'NOAA', 'NWS/ISD'],
      method_ids: [...AUTHORIZED_METHODS],
      route_classes: ['metadata', 'inventory'],
      credential_posture: 'uncredentialed',
      contact_params: {
        'usgs-nwis-site-metadata': { sites: '01646500' },
        'noaa-coops-station-metadata': { station: '9414290' },
      },
      excluded_method_ids: ['eia-electricity-demand-count'],
      excluded_providers: ['EIA'],
    },
    operator_statement: 'synthetic G0 authorization for the acquisition CLI spec',
    at: '2026-01-01T00:00:00Z',
  };
}

function mutateScope(g0, fn) { fn(g0.scope); return g0; }

for (const [label, build, expected] of REFUSALS) {
  test(`M3/FR-B1: --execute performs NO transport when ${label}`, async () => {
    const fx = build();
    const calls = [];
    const { code, err } = await runMain(['--execute'], fx, {
      fetchImpl: transport(OK_BODIES(), calls),
      env: { FORGE_EIA_API_KEY: 'PLANTED_KEY_MUST_NEVER_BE_USED' },
      preparePinInvariance: () => { throw new Error('pin-invariance must not be prepared for a refused authority'); },
    });
    assert.equal(code, 1, `expected refusal: ${err}`);
    assert.match(err, expected);
    assert.equal(calls.length, 0, 'zero transport on a refused authority');
    assert.ok(!existsSync(join(fx.evidenceDir, 'contact-log.jsonl')), 'no evidence is written on a refused authority');
  });
}

// ─── FR-E3: pin-invariance evidence precedes the first transport call ──────────

test('T2.1: --execute refuses when no pin-invariance preparation is supplied', async () => {
  const fx = synthAuthority();
  const calls = [];
  const { code, err } = await runMain(['--execute'], fx, { fetchImpl: transport(OK_BODIES(), calls) });
  assert.equal(code, 1);
  assert.match(err, /requires io\.preparePinInvariance/);
  assert.equal(calls.length, 0);
});

test('T2.1: --execute refuses a pin-invariance record that reports drift or the wrong event', async () => {
  for (const [bad, expected] of [
    [{ record_kind: 'pin-invariance', event: 'gate-a', all_match: true, companion_match: true, mismatches: [] }, /event must be "g0"/],
    [{ record_kind: 'pin-invariance', event: 'g0', all_match: false, companion_match: true, mismatches: [] }, /all_match is not true/],
    [{ record_kind: 'pin-invariance', event: 'g0', all_match: true, companion_match: true, mismatches: [{ path: 'x', reason: 'y' }] }, /reports mismatches/],
  ]) {
    const fx = synthAuthority();
    const calls = [];
    const { code, err } = await runMain(['--execute'], fx, { fetchImpl: transport(OK_BODIES(), calls), preparePinInvariance: () => bad });
    assert.equal(code, 1);
    assert.match(err, expected);
    assert.equal(calls.length, 0, 'zero transport when pin invariance is not attested');
  }
});

test('T2.1: pin-invariance preparation happens BEFORE the first transport call', async () => {
  const fx = synthAuthority();
  const order = [];
  const calls = [];
  const fetchImpl = transport(OK_BODIES(), calls);
  const { code } = await runMain(['--execute'], fx, {
    fetchImpl: async (url, init) => { order.push(`contact:${new URL(url).host}`); return fetchImpl(url, init); },
    preparePinInvariance: ({ event }) => {
      order.push(`pin:${event}`);
      return { record_kind: 'pin-invariance', event: 'g0', all_match: true, companion_match: true, mismatches: [] };
    },
  });
  assert.equal(code, 0);
  assert.equal(order[0], 'pin:g0', 'the g0 pin-invariance record is prepared first');
  assert.ok(order.length > 1 && order.slice(1).every(o => o.startsWith('contact:')), 'every later step is a contact');
});

// ─── Execution: EIA exclusion, class-3 continuation, deterministic evidence ────

const PIN_OK = () => ({ record_kind: 'pin-invariance', event: 'g0', all_match: true, companion_match: true, mismatches: [] });

test('FR-B2/UD-2: EIA never enters execution and FORGE_EIA_API_KEY is never exercised', async () => {
  const fx = synthAuthority();
  const calls = [];
  const env = { FORGE_EIA_API_KEY: 'PLANTED_KEY_MUST_NEVER_BE_USED' };
  const { code } = await runMain(['--execute'], fx, { fetchImpl: transport(OK_BODIES(), calls), env, preparePinInvariance: PIN_OK });
  assert.equal(code, 0);
  assert.equal(calls.length, 4, 'exactly the four authorized candidates were contacted, one attempt each');
  assert.ok(calls.every(u => !u.includes('api.eia.gov')), 'the EIA host is never contacted');
  const log = readLedger(join(fx.evidenceDir, 'contact-log.jsonl'));
  assert.ok(log.every(l => l.method_id !== 'eia-electricity-demand-count'));
  const written = ['contact-log.jsonl', 'acquisition-provenance.jsonl'].map(f => readFileSync(join(fx.evidenceDir, f), 'utf8')).join('\n');
  assert.ok(!written.includes('PLANTED_KEY_MUST_NEVER_BE_USED'), 'the planted credential reaches no artifact');
});

test('FR-A5/FR-B4/M6: a full class-3 run is deterministic, rank-ordered, and rank 4 is `inventory`', async () => {
  const fx = synthAuthority();
  const calls = [];
  const { code, out } = await runMain(['--execute'], fx, { fetchImpl: transport(OK_BODIES(), calls), preparePinInvariance: PIN_OK });
  assert.equal(code, 0);
  const log = readLedger(join(fx.evidenceDir, 'contact-log.jsonl'));
  assert.deepEqual(log.map(l => l.seq), [0, 1, 2, 3], 'contact sequence identity is unambiguous and monotonic');
  assert.deepEqual(log.map(l => l.candidate_rank), [1, 2, 3, 4], 'frozen rank order');
  assert.deepEqual(log.map(l => l.route_class), ['metadata', 'metadata', 'metadata', 'inventory'], 'route_class comes from the route table (M6)');
  assert.deepEqual(log.map(l => l.outcome_class), ['ok', 'guard_rejected', 'ok', 'ok']);
  assert.ok(log.every(l => l.value_exposure_status === 'none_detected'));
  assert.ok(!existsSync(join(fx.evidenceDir, 'metadata')), 'no census-input file for an unresolved candidate (DR-4.4)');
  assert.equal(readLedger(join(fx.evidenceDir, 'contamination-events.jsonl')).length, 0);
  for (const rank of [1, 2, 3, 4]) assert.match(out, new RegExp(`rank ${rank} .*class3_acq_unresolved`));
  // rank 1's history_years is the operator-accepted class (ii); n_observations stays class 3.
  const prov = readLedger(join(fx.evidenceDir, 'acquisition-provenance.jsonl'));
  const r1 = prov.filter(p => p.candidate_rank === 1);
  assert.equal(r1.find(p => p.field === 'history_years').classification, 'ii');
  assert.equal(r1.find(p => p.field === 'n_observations').classification, 'iv');
});

test('M4: a contact refusal is evidenced as class 3, the pool continues, and earlier evidence survives', async () => {
  const fx = synthAuthority();
  const bodies = OK_BODIES();
  bodies['www.ndbc.noaa.gov'] = { throws: 'socket hang up' };
  const calls = [];
  const { code, out } = await runMain(['--execute'], fx, { fetchImpl: transport(bodies, calls), preparePinInvariance: PIN_OK });
  assert.equal(code, 0, 'a class-3 refusal is not a halt');
  assert.equal(calls.length, 4, 'the pool ran to completion — one attempt per candidate, no retry');
  const log = readLedger(join(fx.evidenceDir, 'contact-log.jsonl'));
  assert.deepEqual(log.map(l => l.candidate_rank), [1, 2, 3, 4], 'the refused candidate has its own evidence line');
  const refused = log.find(l => l.candidate_rank === 3);
  assert.equal(refused.outcome_class, 'contact_refused');
  assert.equal(refused.refusal_class, 'timeout');
  assert.match(refused.reason, /socket hang up/);
  assert.equal(refused.value_exposure_status, 'none_detected');
  assert.equal(refused.url_redacted, null);
  assert.match(out, /rank 3 {2}NOAA — class3_acq_unresolved/);
  // Rank 1's provenance, earned before the refusal, is intact.
  assert.equal(readLedger(join(fx.evidenceDir, 'acquisition-provenance.jsonl')).filter(p => p.candidate_rank === 1).length, 3);
});

test('M4: an extraction refusal is evidenced as class 3 and the pool continues', async () => {
  const fx = synthAuthority();
  const bodies = OK_BODIES();
  // A conformant CO-OPS station block whose period fields are absent → the extractor throws.
  bodies['api.tidesandcurrents.noaa.gov'] = { body: JSON.stringify({ stations: [{ id: '9414290', name: 'San Francisco' }] }), contentType: 'application/json' };
  const calls = [];
  const { code } = await runMain(['--execute'], fx, { fetchImpl: transport(bodies, calls), preparePinInvariance: PIN_OK });
  assert.equal(code, 0);
  assert.equal(calls.length, 4);
  const log = readLedger(join(fx.evidenceDir, 'contact-log.jsonl'));
  const r2 = log.find(l => l.candidate_rank === 2);
  assert.equal(r2.outcome_class, 'extraction_refused');
  assert.match(r2.reason, /ExtractionError/);
  assert.equal(log.length, 4, 'exactly one contact-log line per contacted candidate');
});

test('NFR-HALT: a class-4 outcome halts immediately and orphans every later rank', async () => {
  const fx = synthAuthority();
  const bodies = OK_BODIES();
  bodies['waterservices.usgs.gov'] = { body: usgsFixture('catalog_with_observation_row'), contentType: 'text/plain' };
  const calls = [];
  const { code, err } = await runMain(['--execute'], fx, { fetchImpl: transport(bodies, calls), preparePinInvariance: PIN_OK });
  assert.equal(code, 2, 'a terminal HALT is not a success exit');
  assert.equal(calls.length, 1, 'no candidate after the contamination is contacted');
  assert.match(err, /TERMINAL HALT/);
  const contam = readLedger(join(fx.evidenceDir, 'contamination-events.jsonl'));
  assert.equal(contam.length, 1);
  assert.equal(contam[0].resulting_classification, 'class4_contamination');
  assert.equal(contam[0].candidate_rank, 1);
  const log = readLedger(join(fx.evidenceDir, 'contact-log.jsonl'));
  assert.equal(log.length, 1);
  assert.equal(log[0].outcome_class, 'contamination_detected');
  assert.ok(!readFileSync(join(fx.evidenceDir, 'contact-log.jsonl'), 'utf8').includes('3.41'), 'no exposed value reaches any artifact (G3)');

  // F2: the halt_ref resolves to a durable HALT record on disk, and the operator's
  // terminal error names it.
  const haltPath = join(fx.evidenceDir, contam[0].halt_ref);
  assert.equal(contam[0].halt_ref, HALT_RECORD_NAME);
  assert.ok(existsSync(haltPath), 'the halt_ref resolves to a file that exists');
  const halt = JSON.parse(readFileSync(haltPath, 'utf8'));
  assert.equal(halt.record_kind, 'halt');
  assert.equal(halt.class, 'contamination');
  assert.equal(halt.cycle, 'cycle-005');
  assert.equal(halt.evidence.candidate_rank, 1);
  assert.equal(halt.refs.contact_ref, log[0].seq, 'the HALT record points at the contact-log line that produced it');
  assert.deepEqual(halt.blast_radius.not_attempted_ranks, [2, 3, 4]);
  assert.equal(halt.blast_radius.further_contact_prohibited, true);
  const { record_id, ...rest } = halt;
  assert.equal(record_id, contentAddress(rest), 'the HALT record verifies its own self-excluded content id');
  assert.equal(contam[0].halt_record_id, record_id, 'the contamination event binds that exact record');
  assert.match(err, new RegExp(HALT_RECORD_NAME.replace('.', '\\.')));
  assert.match(err, new RegExp(record_id.slice(0, 24)));
  // …carrying no exposed provider value and no raw response content (G3).
  const haltText = readFileSync(haltPath, 'utf8');
  for (const leak of ['3.41', '3.44', 'POTOMAC', '72255_00065', '2026-07-23 14:30']) {
    assert.ok(!haltText.includes(leak), `the HALT record must not carry response content (${leak})`);
  }
});

// ─── C-1: an existing governing HALT prohibits contact, mechanically ──────────
//
// A DR-3 contamination HALT is terminal for the cycle. Before the correction the
// one-shot check lived only inside the contamination branch, so a re-run after a
// terminal HALT contacted every candidate again and restarted the contact-log
// sequence at 0 (19-cycle-005-pre-g0-f1-f3-correction-review.md §7 C-1). The gate
// now runs at the top of the authority path AND at the top of the pool, so the
// refusal precedes pin-invariance preparation, evidence mutation and transport.

/** A valid, self-verifying contamination HALT record, as the apparatus writes it. */
function plantHalt(evidenceDir, { name = HALT_RECORD_NAME, mutate = null } = {}) {
  const body = {
    record_kind: 'halt',
    schema_version: '1.0.0',
    cycle: 'cycle-005',
    class: 'contamination',
    evidence: { candidate_rank: 1, provider: 'USGS', product: 'river stage', method_id: 'usgs-nwis-site-metadata', route_class: 'metadata', exposure_class: 'detected', guard_events: ['g2:value_bearing'], note: 'planted prior HALT' },
    blast_radius: { further_contact_prohibited: true, halted_at_rank: 1, not_attempted_ranks: [2, 3, 4], operator_adjudication_required: 'NFR-CONTAM-2' },
    refs: { contact_log: 'contact-log.jsonl', contact_ref: 0, contamination_events: 'contamination-events.jsonl' },
    at: '2026-01-01T00:00:00Z',
  };
  if (mutate) mutate(body);
  const path = join(evidenceDir, name);
  const bytes = canonicalize(withId(body)) + '\n';
  writeFileSync(path, bytes);
  return { path, bytes };
}

test('C-1: a planted valid HALT blocks --preflight before any transport or evidence mutation', async () => {
  const fx = synthAuthority();
  const { path, bytes } = plantHalt(fx.evidenceDir);
  const calls = [];
  const { code, err } = await runMain(['--preflight'], fx, { fetchImpl: transport(OK_BODIES(), calls) });
  assert.equal(code, 1, 'preflight itself is refused — there is nothing this apparatus may lawfully do');
  assert.match(err, /a governing Cycle-005 HALT record is already on disk/);
  assert.match(err, /halt-1\.json \[class contamination, record_id sha256:[0-9a-f]+ verifies\]/);
  assert.equal(calls.length, 0);
  assert.equal(readFileSync(path, 'utf8'), bytes, 'the existing HALT record is byte-identical');
  assert.ok(!existsSync(join(fx.evidenceDir, 'contact-log.jsonl')));
});

test('C-1: a planted valid HALT blocks --execute BEFORE pin-invariance preparation', async () => {
  const fx = synthAuthority();
  plantHalt(fx.evidenceDir);
  const calls = [];
  const { code, err } = await runMain(['--execute'], fx, {
    fetchImpl: transport(OK_BODIES(), calls),
    preparePinInvariance: () => { throw new Error('pin-invariance must not be prepared under a governing HALT'); },
  });
  assert.equal(code, 1);
  assert.match(err, /a governing Cycle-005 HALT record is already on disk/);
  assert.match(err, /prohibits all further contact within this cycle/);
  assert.equal(calls.length, 0, 'zero transport');
  assert.ok(!existsSync(join(fx.evidenceDir, 'contact-log.jsonl')), 'zero evidence mutation');
});

test('C-1: a real contamination run followed by a second invocation performs ZERO further contacts', async () => {
  const fx = synthAuthority();
  const bodies = OK_BODIES();
  bodies['waterservices.usgs.gov'] = { body: usgsFixture('catalog_with_observation_row'), contentType: 'text/plain' };
  const calls = [];

  const first = await runMain(['--execute'], fx, { fetchImpl: transport(bodies, calls), preparePinInvariance: PIN_OK });
  assert.equal(first.code, 2, 'run 1 halts on the contamination');
  assert.equal(calls.length, 1);
  const haltPath = join(fx.evidenceDir, HALT_RECORD_NAME);
  const after1 = {
    halt: readFileSync(haltPath, 'utf8'),
    log: readFileSync(join(fx.evidenceDir, 'contact-log.jsonl'), 'utf8'),
    contamination: readFileSync(join(fx.evidenceDir, 'contamination-events.jsonl'), 'utf8'),
  };

  const second = await runMain(['--execute'], fx, {
    fetchImpl: transport(bodies, calls),
    preparePinInvariance: () => { throw new Error('pin-invariance must not be prepared after a terminal HALT'); },
  });
  assert.equal(second.code, 1, 'run 2 is a refusal, not a completed run');
  assert.match(second.err, /a governing Cycle-005 HALT record is already on disk/);
  assert.equal(calls.length, 1, 'no additional transport across the second invocation');
  assert.equal(readFileSync(haltPath, 'utf8'), after1.halt, 'the governing HALT is byte-identical');
  assert.equal(readFileSync(join(fx.evidenceDir, 'contact-log.jsonl'), 'utf8'), after1.log, 'the contact log is byte-identical — nothing appended');
  assert.equal(readFileSync(join(fx.evidenceDir, 'contamination-events.jsonl'), 'utf8'), after1.contamination, 'the contamination ledger is byte-identical');
  assert.deepEqual(readLedger(join(fx.evidenceDir, 'contact-log.jsonl')).map(l => l.seq), [0], 'sequence numbering never restarts');
});

test('C-1: malformed or conflicting HALT evidence fails closed', async () => {
  const CASES = [
    ['malformed JSON', (dir) => writeFileSync(join(dir, HALT_RECORD_NAME), '{ not json\n'), /unreadable or malformed JSON — fails closed/],
    ['a JSON array', (dir) => writeFileSync(join(dir, HALT_RECORD_NAME), '[]\n'), /not a JSON object — fails closed/],
    ['a foreign record_kind', (dir) => writeFileSync(join(dir, HALT_RECORD_NAME), canonicalize({ record_kind: 'note', cycle: 'cycle-005' }) + '\n'), /record_kind is not "halt" — conflicting HALT evidence/],
    ['another cycle', (dir) => plantHalt(dir, { mutate: (b) => { b.cycle = 'cycle-004'; } }), /not a cycle-005 record — conflicting HALT evidence/],
    ['an edited record_id', (dir) => {
      const { path } = plantHalt(dir);
      const rec = JSON.parse(readFileSync(path, 'utf8'));
      rec.evidence.candidate_rank = 3;
      writeFileSync(path, canonicalize(rec) + '\n');
    }, /record_id does NOT verify — fails closed/],
    ['a HALT under another allocation', (dir) => plantHalt(dir, { name: 'halt-2.json' }), /halt-2\.json \[class contamination/],
    ['a HALT under a differently-cased name', (dir) => plantHalt(dir, { name: 'HALT-1.JSON' }), /HALT-1\.JSON \[class contamination/],
    ['a HALT-shaped directory', (dir) => mkdirSync(join(dir, HALT_RECORD_NAME)), /unreadable or malformed JSON — fails closed/],
    ['an empty HALT file', (dir) => writeFileSync(join(dir, HALT_RECORD_NAME), ''), /unreadable or malformed JSON — fails closed/],
    ['a control-byte-laden class', (dir) => writeFileSync(join(dir, HALT_RECORD_NAME), JSON.stringify({ record_kind: 'halt', cycle: 'cycle-005', class: 'contam ination\n<x>' }) + '\n'), /class \(unrecognised class\)/],
    ['two governing HALT records', (dir) => { plantHalt(dir); plantHalt(dir, { name: 'halt-7.json', mutate: (b) => { b.class = 'pin-mismatch'; } }); }, /halt-1\.json .*; halt-7\.json \[class pin-mismatch/],
  ];
  for (const [label, plant, expected] of CASES) {
    const fx = synthAuthority();
    plant(fx.evidenceDir);
    const calls = [];
    const { code, err } = await runMain(['--execute'], fx, {
      fetchImpl: transport(OK_BODIES(), calls),
      preparePinInvariance: () => { throw new Error('pin-invariance must not be prepared under a governing HALT'); },
    });
    assert.equal(code, 1, `${label}: refuses`);
    assert.match(err, /a governing Cycle-005 HALT record is already on disk/, label);
    assert.match(err, expected, label);
    assert.equal(calls.length, 0, `${label}: zero transport`);
    assert.ok(!existsSync(join(fx.evidenceDir, 'contact-log.jsonl')), `${label}: zero evidence mutation`);
  }
});

test('C-1: acquirePool itself refuses under a governing HALT (direct caller, no CLI)', async () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), 'c005-cli-halt-pool-'));
  const { path, bytes } = plantHalt(evidenceDir);
  const calls = [];
  await assert.rejects(
    () => acquirePool({
      candidates: [{ rank: 1, provider: 'USGS', product: 'river stage', route_method_id: 'usgs-nwis-site-metadata', contact_params: { sites: '01646500' }, authored_inputs: {}, measured_methods: {} }],
      evidenceDir,
      io: { fetchImpl: transport(OK_BODIES(), calls), env: {} },
      now: () => '2026-01-01T00:00:00Z',
    }),
    AcquisitionRefusal,
  );
  assert.equal(calls.length, 0, 'the pool gate precedes the first contact');
  assert.equal(readFileSync(path, 'utf8'), bytes);
  assert.ok(!existsSync(join(evidenceDir, 'contact-log.jsonl')));
});

test('C-1/F2: the existing HALT record is never overwritten and leaves no dangling ref', async () => {
  const fx = synthAuthority();
  const { path, bytes } = plantHalt(fx.evidenceDir);
  const bodies = OK_BODIES();
  bodies['waterservices.usgs.gov'] = { body: usgsFixture('catalog_with_observation_row'), contentType: 'text/plain' };
  const calls = [];
  const { code, err } = await runMain(['--execute'], fx, { fetchImpl: transport(bodies, calls), preparePinInvariance: PIN_OK });
  assert.equal(code, 1, 'an un-adjudicated HALT is a refusal, not a completed run');
  assert.match(err, /a governing Cycle-005 HALT record is already on disk/);
  assert.equal(calls.length, 0, 'the contaminating candidate is never contacted a second time');
  assert.equal(readFileSync(path, 'utf8'), bytes, 'the existing HALT record is byte-identical (never overwritten)');
  assert.ok(!existsSync(join(fx.evidenceDir, 'contact-log.jsonl')), 'no evidence is appended');
  assert.equal(readLedger(join(fx.evidenceDir, 'contamination-events.jsonl')).length, 0, 'no contamination event with a ref to a record this run did not write');
});

test('C-1: an evidence directory with no HALT record proceeds normally', () => {
  const fx = synthAuthority();
  assert.deepEqual(findHaltRecords(fx.evidenceDir), []);
  assert.doesNotThrow(() => assertNoGoverningHalt(fx.evidenceDir));
  // …and a non-HALT filename is not mistaken for one.
  for (const name of ['halt-notes.json', 'invalidation-1.json', 'halt.json', 'halt-1a.json', 'halt-1.jsonl']) {
    writeFileSync(join(fx.evidenceDir, name), '{}\n');
  }
  assert.deepEqual(findHaltRecords(fx.evidenceDir), []);
  assert.doesNotThrow(() => assertNoGoverningHalt(fx.evidenceDir));
  // An absent evidence directory carries no governing HALT (and does not throw).
  assert.deepEqual(findHaltRecords(join(tmpdir(), 'c005-no-such-evidence-dir')), []);
});

// ─── F3: truthful rejection evidence (HTTP status + stable reason) ────────────
//
// A response that arrived is recorded with the status it arrived with, and every
// non-`ok` line carries a stable `reason_code` plus a truthful `reason`. The
// existing `outcome_class` taxonomy and `value_exposure_status` are unchanged —
// classification semantics are not altered to improve logging
// (17-cycle-005-pre-g0-apparatus-remediation-review.md §4 F-3).

// C-5: a final non-success status is adjudicated, not merely recorded. Before the
// correction a 404 reached the guard and was logged as a content-type rejection,
// and a 503 whose body satisfied the declaration was logged `ok` and extracted
// (19-cycle-005-pre-g0-f1-f3-correction-review.md §7 C-5).

test('C-5: a 404 is an evidenced class-3 refusal carrying its real status, and the pool continues', async () => {
  const fx = synthAuthority();
  const NOT_FOUND = '<!DOCTYPE html><html><head><title>404 Not Found</title></head><body>Not Found</body></html>';
  const bodies = Object.fromEntries(Object.keys(OK_BODIES()).map(h => [h, { status: 404, body: NOT_FOUND, contentType: 'text/html; charset=iso-8859-1' }]));
  const calls = [];
  const { code, out } = await runMain(['--execute'], fx, { fetchImpl: transport(bodies, calls), preparePinInvariance: PIN_OK });
  assert.equal(code, 0, 'a non-success status is a lawful class-3 outcome, not a halt');
  assert.equal(calls.length, 4, 'execution continues to every later candidate');
  const log = readLedger(join(fx.evidenceDir, 'contact-log.jsonl'));
  assert.equal(log.length, 4);
  for (const l of log) {
    assert.equal(l.http_status, 404, 'the HTTP status of the response that actually arrived is preserved');
    assert.equal(l.outcome_class, 'contact_refused', 'a non-success response is not a successful contact');
    assert.equal(l.reason_code, 'http_error', 'a stable machine reason names the ground');
    assert.equal(l.refusal_class, 'http_error');
    assert.match(l.reason, /outside the accepted success range 200-299/, 'and a truthful prose reason');
    assert.equal(l.value_exposure_status, 'none_detected', 'a status alone is never contamination');
    assert.deepEqual(l.guard_events, [], 'the guard was never invoked on the body');
    assert.equal(l.content_type, null, 'the body was never read, so no content-type or byte length is claimed');
    assert.equal(l.byte_length, 0);
    assert.ok(l.url_redacted.startsWith('https://'), 'redacted route information is recorded');
  }
  assert.ok(readFileSync(join(fx.evidenceDir, 'contact-log.jsonl'), 'utf8').includes('"http_status":404'));
  assert.ok(!readFileSync(join(fx.evidenceDir, 'contact-log.jsonl'), 'utf8').includes('404 Not Found'), 'no raw response body enters the evidence');
  assert.ok(!existsSync(join(fx.evidenceDir, 'acquisition-provenance.jsonl')), 'the extractor was never invoked');
  assert.equal(readLedger(join(fx.evidenceDir, 'contamination-events.jsonl')).length, 0);
  for (const rank of [1, 2, 3, 4]) assert.match(out, new RegExp(`rank ${rank} .*class3_acq_unresolved`));
});

test('C-5: a 5xx whose body WOULD satisfy the declaration never records `ok` and never extracts', async () => {
  const fx = synthAuthority();
  const bodies = OK_BODIES();
  // Rank 1: the conformant USGS catalog served under a 503 — the reviewed C-5 case.
  bodies['waterservices.usgs.gov'] = { status: 503, body: usgsFixture('catalog_conformant'), contentType: 'text/plain' };
  const calls = [];
  const { code } = await runMain(['--execute'], fx, { fetchImpl: transport(bodies, calls), preparePinInvariance: PIN_OK });
  assert.equal(code, 0);
  assert.equal(calls.length, 4, 'execution continued to the next candidate after the lawful class-3 result');
  const log = readLedger(join(fx.evidenceDir, 'contact-log.jsonl'));
  const r1 = log.find(l => l.candidate_rank === 1);
  assert.equal(r1.outcome_class, 'contact_refused');
  assert.equal(r1.http_status, 503);
  assert.equal(r1.reason_code, 'http_error');
  assert.equal(readLedger(join(fx.evidenceDir, 'acquisition-provenance.jsonl')).filter(p => p.candidate_rank === 1).length, 0, 'no provenance for a refused contact');
  // …and the 2xx candidates in the same run are untouched by the change.
  assert.equal(log.find(l => l.candidate_rank === 3).http_status, 200);
  assert.equal(log.find(l => l.candidate_rank === 3).outcome_class, 'ok');
});

test('C-6: an in-allowlist retarget redirect is an evidenced class-3 refusal, redacted and credential-free', async () => {
  const fx = synthAuthority();
  const PLANTED = 'PLANTED_KEY_MUST_NEVER_BE_USED';
  const bodies = OK_BODIES();
  // rank 2 is redirected to ANOTHER path of its own allowlisted host, with a
  // credential planted in the target's query — the C-6 reproduction.
  bodies['api.tidesandcurrents.noaa.gov'] = {
    status: 302,
    location: `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_level&station=9414290&api_key=${PLANTED}`,
    body: '', contentType: null,
  };
  const calls = [];
  const { code } = await runMain(['--execute'], fx, { fetchImpl: transport(bodies, calls), env: { FORGE_EIA_API_KEY: PLANTED }, preparePinInvariance: PIN_OK });
  assert.equal(code, 0, 'a refused redirect is a lawful class-3 outcome, not a halt');
  assert.equal(calls.length, 4, 'the pool continued; the refused target received no transport');
  assert.ok(!calls.some(u => u.includes('datagetter')), 'the retarget destination is never contacted');
  const log = readLedger(join(fx.evidenceDir, 'contact-log.jsonl'));
  const r2 = log.find(l => l.candidate_rank === 2);
  assert.equal(r2.outcome_class, 'contact_refused');
  assert.equal(r2.reason_code, 'redirect_refused');
  assert.equal(r2.http_status, null, 'no FINAL response existed — the status is never fabricated');
  assert.match(r2.reason, /leaves the authorized route/);
  assert.match(r2.reason, /instead of the authorized template path/, 'the ground is stated truthfully — the refused target PATH, which is route information');
  const evidence = readFileSync(join(fx.evidenceDir, 'contact-log.jsonl'), 'utf8');
  assert.ok(!evidence.includes(PLANTED), 'no credential reaches the evidence');
  assert.ok(!evidence.includes('api_key=' + PLANTED), 'no credential-bearing query string reaches the evidence');
  assert.equal(r2.url_redacted, null, 'no FINAL response existed, so no contacted URL is claimed');
});

test('F3: a 200 whose SHAPE is wrong records the structural reason, not a content-type reason', async () => {
  const fx = synthAuthority();
  const bodies = OK_BODIES();
  // Right content-type, right status, wrong surface: the declared RDB header is absent.
  bodies['waterservices.usgs.gov'] = { body: 'no_such_column\tanother\nfoo\tbar\n', contentType: 'text/plain' };
  // A JSON body with no station block (CO-OPS) — a different structural reason again.
  bodies['api.tidesandcurrents.noaa.gov'] = { body: JSON.stringify({ metadata: {} }), contentType: 'application/json' };
  const calls = [];
  await runMain(['--execute'], fx, { fetchImpl: transport(bodies, calls), preparePinInvariance: PIN_OK });
  const log = readLedger(join(fx.evidenceDir, 'contact-log.jsonl'));
  const r1 = log.find(l => l.candidate_rank === 1);
  assert.equal(r1.http_status, 200, 'a lawful status is recorded as lawful');
  assert.equal(r1.outcome_class, 'guard_rejected');
  assert.equal(r1.reason_code, 'declared_header_tokens_absent');
  assert.match(r1.reason, /declared metadata header tokens absent/);
  const r2 = log.find(l => l.candidate_rank === 2);
  assert.equal(r2.reason_code, 'no_station_metadata_block', 'guard rejections are distinguishable from one another');
  assert.match(r2.reason, /no station metadata block/);
});

test('F3: extraction refusal, transport refusal and redirect refusal stay distinguishable', async () => {
  const fx = synthAuthority();
  const bodies = OK_BODIES();
  // rank 2: conformant station block whose period fields are absent → extractor throws.
  bodies['api.tidesandcurrents.noaa.gov'] = { body: JSON.stringify({ stations: [{ id: '9414290' }] }), contentType: 'application/json' };
  // rank 3: transport error (no response ever exists).
  bodies['www.ndbc.noaa.gov'] = { throws: 'socket hang up' };
  // rank 4: a redirect to a host outside the allowlist → refused, never followed (G8).
  bodies['www.ncei.noaa.gov'] = { status: 301, location: 'https://evil.example.com/pub/data/noaa/isd-history.csv', body: '', contentType: null };
  const calls = [];
  const { code } = await runMain(['--execute'], fx, { fetchImpl: transport(bodies, calls), preparePinInvariance: PIN_OK });
  assert.equal(code, 0, 'every one of these is a lawful class-3 outcome, not a halt');
  const log = readLedger(join(fx.evidenceDir, 'contact-log.jsonl'));
  const by = (rank) => log.find(l => l.candidate_rank === rank);

  assert.equal(by(1).outcome_class, 'ok');
  assert.equal(by(1).http_status, 200);
  assert.equal(by(1).reason_code, 'conformant');

  assert.equal(by(2).outcome_class, 'extraction_refused');
  assert.equal(by(2).http_status, 200, 'the response existed, so its status is recorded');
  assert.equal(by(2).reason_code, 'extractor_threw');
  assert.match(by(2).reason, /ExtractionError/);

  assert.equal(by(3).outcome_class, 'contact_refused');
  assert.equal(by(3).http_status, null, 'no response existed — the status is null, never fabricated');
  assert.equal(by(3).reason_code, 'timeout');
  assert.match(by(3).reason, /socket hang up/, 'the true transport message survives verbatim');
  assert.equal(by(3).url_redacted, null);

  assert.equal(by(4).outcome_class, 'contact_refused');
  assert.equal(by(4).http_status, null);
  assert.equal(by(4).reason_code, 'redirect_refused');
  assert.match(by(4).reason, /not allowlisted/);
  assert.ok(!calls.some(u => u.includes('evil.example.com')), 'the refused redirect target is never contacted');
  // Four distinct reason codes for four distinct grounds.
  assert.equal(new Set(log.map(l => l.reason_code)).size, 4);
});

test('F3: credential refusal and route refusal are recorded as themselves (no response exists)', async () => {
  // Neither is reachable through an authorized G0 scope (EIA is excluded and a path
  // parameter is validated pre-contact), so the pool is driven directly to prove the
  // evidence shape of both refusal grounds.
  const evidenceDir = mkdtempSync(join(tmpdir(), 'c005-cli-refusals-'));
  const calls = [];
  const out = await acquirePool({
    candidates: [
      { rank: 1, provider: 'EIA', product: 'hourly electricity demand', route_method_id: 'eia-electricity-demand-count', contact_params: { period_of_record_start: '2015-01-01' }, authored_inputs: {}, measured_methods: {} },
      { rank: 2, provider: 'NOAA', product: 'coastal water level', route_method_id: 'noaa-coops-station-metadata', contact_params: { station: '../../../../api/prod/datagetter' }, authored_inputs: {}, measured_methods: {} },
    ],
    evidenceDir,
    io: { fetchImpl: transport(OK_BODIES(), calls), env: {} },
    now: () => '2026-01-01T00:00:00Z',
  });
  assert.equal(calls.length, 0, 'neither refusal reaches a transport');
  assert.equal(out.halted, false);
  const log = readLedger(join(evidenceDir, 'contact-log.jsonl'));
  assert.equal(log[0].outcome_class, 'contact_refused');
  assert.equal(log[0].refusal_class, 'credential_missing');
  assert.equal(log[0].reason_code, 'credential_missing');
  assert.equal(log[0].http_status, null);
  assert.match(log[0].reason, /FORGE_EIA_API_KEY is not set/, 'the env var is named, the value never is');
  assert.equal(log[1].refusal_class, 'route_refused');
  assert.equal(log[1].reason_code, 'route_refused');
  assert.equal(log[1].http_status, null);
  assert.match(log[1].reason, /not a bounded path segment/, 'the route refusal states its own ground');
  assert.ok(out.results.every(r => r.status === 'class3_acq_unresolved'));
});

test('F3: no secret, raw payload or unsafe URL enters the evidence', async () => {
  const fx = synthAuthority();
  const PLANTED_KEY = 'PLANTED_KEY_MUST_NEVER_BE_USED';
  const bodies = OK_BODIES();
  const SECRET_IN_BODY = 'S3CRET-BODY-TOKEN';
  bodies['www.ndbc.noaa.gov'] = { body: `${NDBC_TABLE}\n# ${SECRET_IN_BODY}\n`, contentType: 'text/plain' };
  const calls = [];
  await runMain(['--execute'], fx, {
    fetchImpl: transport(bodies, calls),
    env: { FORGE_EIA_API_KEY: PLANTED_KEY },
    preparePinInvariance: PIN_OK,
  });
  const evidence = ['contact-log.jsonl', 'acquisition-provenance.jsonl']
    .map(f => (existsSync(join(fx.evidenceDir, f)) ? readFileSync(join(fx.evidenceDir, f), 'utf8') : ''))
    .join('\n');
  assert.ok(!evidence.includes(PLANTED_KEY), 'no credential');
  assert.ok(!evidence.includes(SECRET_IN_BODY), 'no raw response content, even from a conformant body');
  assert.ok(!evidence.includes('api_key='), 'no credential-bearing query string');
  const log = readLedger(join(fx.evidenceDir, 'contact-log.jsonl'));
  for (const l of log) {
    assert.ok(l.url_redacted === null || l.url_redacted.startsWith('https://'), 'a recorded URL is https or absent');
    assert.ok(!String(l.url_redacted).includes('..'), 'no traversal shape can appear in a recorded URL');
  }
});

// ─── Unit-level scope helpers ─────────────────────────────────────────────────

test('the required contact parameters are derived from the frozen templates themselves', () => {
  assert.deepEqual([...requiredContactParams('usgs-nwis-site-metadata')], ['sites']);
  assert.deepEqual([...requiredContactParams('noaa-coops-station-metadata')], ['station']);
  assert.deepEqual([...requiredContactParams('noaa-ndbc-station-metadata')], []);
  assert.deepEqual([...requiredContactParams('nws-isd-station-inventory')], []);
  // The credential placeholder is never a caller/scope parameter (G4).
  assert.deepEqual([...requiredContactParams('eia-electricity-demand-count')], ['period_of_record_start']);
  assert.throws(() => requiredContactParams('not-a-route'), AcquisitionRefusal);
});

test('deriveAuthorizedCandidates refuses when the scope and the method set disagree', () => {
  const methodSet = JSON.parse(readFileSync(join(REPO_ROOT, METHOD_SET_REL), 'utf8'));
  const gateA = { ud1_status: {} };
  assert.throws(() => deriveAuthorizedCandidates({
    methodSet,
    g0: { method_ids: [...AUTHORIZED_METHODS, 'route-with-no-candidate'], contact_params: {} },
    gateA,
  }), AcquisitionRefusal);
  // …and the happy path yields exactly the frozen route table's route classes.
  const ok = deriveAuthorizedCandidates({ methodSet, g0: { method_ids: [...AUTHORIZED_METHODS], contact_params: {} }, gateA });
  assert.deepEqual(ok.map(c => c.route_class), AUTHORIZED_METHODS.map(id => ROUTES[id].route_class));
});

// ─── R-4: acquisition is ONE-SHOT per authorized run ──────────────────────────
//
// The C-1 gate made a re-run after a CONTAMINATION impossible, but a CLEAN run —
// which the HALT gate correctly does not block — could still be repeated: `contactSeq`
// restarts at 0 on every entry to `acquirePool`, so two successive `--execute` runs
// appended `seq [0, 1, 2, 3, 0, 1, 2, 3]` to one `contact-log.jsonl` and left the
// provenance rows' `contact_refs` resolving to two different contacts each
// (21-cycle-005-pre-g0-c1-c5-c6-correction-review.md §5 R-4).
//
// The state is derived from the durable evidence a run already wrote — no new marker
// file, no resume protocol. `--preflight` is deliberately still available: it contacts
// nothing and appends nothing, and an operator holding a completed run needs to be
// able to inspect the authority chain.

/** The three run-evidence ledgers, and the bytes each holds. */
const evidenceSnapshot = (dir) => Object.fromEntries(
  ['contact-log.jsonl', 'acquisition-provenance.jsonl', 'contamination-events.jsonl']
    .filter(n => existsSync(join(dir, n)))
    .map(n => [n, readFileSync(join(dir, n), 'utf8')]),
);

test('R-4: a completed clean run cannot be re-run — zero transport, evidence byte-identical', async () => {
  const fx = synthAuthority();
  const calls = [];
  const first = await runMain(['--execute'], fx, { fetchImpl: transport(OK_BODIES(), calls), preparePinInvariance: PIN_OK });
  assert.equal(first.code, 0, 'run 1 completes');
  assert.equal(calls.length, 4, 'run 1 contacted the four authorized candidates');
  const after1 = evidenceSnapshot(fx.evidenceDir);

  const second = await runMain(['--execute'], fx, {
    fetchImpl: transport(OK_BODIES(), calls),
    preparePinInvariance: () => { throw new Error('pin-invariance must not be prepared for a re-run'); },
  });
  assert.equal(second.code, 1, 'run 2 is a refusal, not a completed run');
  assert.match(second.err, /Cycle-005 acquisition evidence already exists/);
  assert.match(second.err, /ONE-SHOT per authorized run/);
  assert.match(second.err, /contact-log\.jsonl \[\d+ bytes\]/, 'the refusal names the evidence it found');
  assert.match(second.err, /operator-governed decision/, 'resuming or restarting is operator-reserved');
  assert.equal(calls.length, 4, 'zero additional transport across the second invocation');
  assert.deepEqual(evidenceSnapshot(fx.evidenceDir), after1, 'every run-evidence ledger is byte-identical');

  // The identities R-4 exists to protect: no duplicate seq, no duplicate contact_ref.
  const log = readLedger(join(fx.evidenceDir, 'contact-log.jsonl'));
  assert.deepEqual(log.map(l => l.seq), [0, 1, 2, 3], 'sequence numbering never restarted');
  assert.equal(new Set(log.map(l => l.seq)).size, log.length, 'every seq is unique');
  const refs = readLedger(join(fx.evidenceDir, 'acquisition-provenance.jsonl')).flatMap(p => p.contact_refs);
  assert.ok(refs.every(r => log.filter(l => l.seq === r).length === 1), 'every contact_ref resolves to exactly ONE contact-log line');
});

test('R-4: a partial / interrupted run cannot silently restart', async () => {
  // A run that died part-way through the pool leaves a contact log with fewer lines
  // than candidates. That is evidence contact BEGAN, and it is exactly the state a
  // silent restart would corrupt.
  const fx = synthAuthority();
  const calls = [];
  const partial = [
    JSON.stringify({ record_kind: 'contact-log', seq: 0, candidate_rank: 1, outcome_class: 'contact_refused' }),
    JSON.stringify({ record_kind: 'contact-log', seq: 1, candidate_rank: 2, outcome_class: 'ok' }),
    '',
  ].join('\n');
  writeFileSync(join(fx.evidenceDir, 'contact-log.jsonl'), partial);

  const { code, err } = await runMain(['--execute'], fx, {
    fetchImpl: transport(OK_BODIES(), calls),
    preparePinInvariance: () => { throw new Error('pin-invariance must not be prepared for a partial re-run'); },
  });
  assert.equal(code, 1);
  assert.match(err, /Cycle-005 acquisition evidence already exists/);
  assert.match(err, /completed, class-3, halted or interrupted run/);
  assert.equal(calls.length, 0, 'zero transport');
  assert.equal(readFileSync(join(fx.evidenceDir, 'contact-log.jsonl'), 'utf8'), partial, 'the partial evidence is byte-identical');
});

test('R-4: evidence in provenance or the contamination ledger alone also refuses', async () => {
  for (const name of ['acquisition-provenance.jsonl', 'contamination-events.jsonl']) {
    const fx = synthAuthority();
    const calls = [];
    const bytes = JSON.stringify({ record_kind: 'x', seq: 0 }) + '\n';
    writeFileSync(join(fx.evidenceDir, name), bytes);
    const { code, err } = await runMain(['--execute'], fx, {
      fetchImpl: transport(OK_BODIES(), calls),
      preparePinInvariance: () => { throw new Error(`pin-invariance must not be prepared with ${name} present`); },
    });
    assert.equal(code, 1, name);
    assert.match(err, new RegExp(`${name.replace('.', '\\.')} \\[\\d+ bytes\\]`), `${name}: named in the refusal`);
    assert.equal(calls.length, 0, `${name}: zero transport`);
    assert.equal(readFileSync(join(fx.evidenceDir, name), 'utf8'), bytes, `${name}: byte-identical`);
  }
});

test('R-4: a terminal contamination HALT stays governed by the HALT rule, not the one-shot rule', async () => {
  const fx = synthAuthority();
  const bodies = OK_BODIES();
  bodies['waterservices.usgs.gov'] = { body: usgsFixture('catalog_with_observation_row'), contentType: 'text/plain' };
  const calls = [];
  const first = await runMain(['--execute'], fx, { fetchImpl: transport(bodies, calls), preparePinInvariance: PIN_OK });
  assert.equal(first.code, 2, 'run 1 halts on the contamination');
  const after1 = evidenceSnapshot(fx.evidenceDir);

  const second = await runMain(['--execute'], fx, {
    fetchImpl: transport(bodies, calls),
    preparePinInvariance: () => { throw new Error('pin-invariance must not be prepared after a terminal HALT'); },
  });
  assert.equal(second.code, 1);
  assert.match(second.err, /a governing Cycle-005 HALT record is already on disk/, 'the HALT rule governs');
  assert.doesNotMatch(second.err, /acquisition evidence already exists/, 'the one-shot rule does not displace it');
  assert.equal(calls.length, 1, 'zero additional transport');
  assert.deepEqual(evidenceSnapshot(fx.evidenceDir), after1, 'evidence byte-identical');
});

test('R-4: acquirePool itself refuses over prior evidence (direct caller, no CLI)', async () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), 'c005-cli-oneshot-pool-'));
  const bytes = JSON.stringify({ record_kind: 'contact-log', seq: 0 }) + '\n';
  writeFileSync(join(evidenceDir, 'contact-log.jsonl'), bytes);
  const calls = [];
  await assert.rejects(
    () => acquirePool({
      candidates: [{ rank: 1, provider: 'USGS', product: 'river stage', route_method_id: 'usgs-nwis-site-metadata', contact_params: { sites: '01646500' }, authored_inputs: {}, measured_methods: {} }],
      evidenceDir,
      io: { fetchImpl: transport(OK_BODIES(), calls), env: {} },
      now: () => '2026-01-01T00:00:00Z',
    }),
    AcquisitionRefusal,
  );
  assert.equal(calls.length, 0, 'the pool gate precedes the first contact');
  assert.equal(readFileSync(join(evidenceDir, 'contact-log.jsonl'), 'utf8'), bytes);
});

test('R-4: --preflight remains available after a completed run and still contacts nothing', async () => {
  const fx = synthAuthority();
  const calls = [];
  await runMain(['--execute'], fx, { fetchImpl: transport(OK_BODIES(), calls), preparePinInvariance: PIN_OK });
  assert.equal(calls.length, 4);
  const after1 = evidenceSnapshot(fx.evidenceDir);

  const pre = await runMain(['--preflight'], fx, { fetchImpl: transport(OK_BODIES(), calls) });
  assert.equal(pre.code, 0, 'the operator may still inspect the authority chain');
  assert.match(pre.out, /authority verified/);
  assert.match(pre.out, /no provider was contacted/);
  assert.equal(calls.length, 4, 'preflight contacts nothing');
  assert.deepEqual(evidenceSnapshot(fx.evidenceDir), after1, 'preflight appends nothing');
});

test('R-4: an unwritten evidence directory is not a prior run', () => {
  const fx = synthAuthority();
  // Nothing written yet.
  assert.deepEqual(findPriorAcquisitionEvidence(fx.evidenceDir), []);
  assert.doesNotThrow(() => assertNoPriorAcquisition(fx.evidenceDir));
  // The tracked, never-written baseline state: present at ZERO bytes is not evidence.
  for (const n of ['contact-log.jsonl', 'acquisition-provenance.jsonl', 'contamination-events.jsonl']) writeFileSync(join(fx.evidenceDir, n), '');
  assert.deepEqual(findPriorAcquisitionEvidence(fx.evidenceDir), []);
  assert.doesNotThrow(() => assertNoPriorAcquisition(fx.evidenceDir));
  // An absent evidence directory carries no prior run (and does not throw).
  assert.deepEqual(findPriorAcquisitionEvidence(join(tmpdir(), 'c005-no-such-evidence-dir')), []);
  // An EMPTY census-input directory is likewise not a run.
  mkdirSync(join(fx.evidenceDir, 'metadata'));
  assert.deepEqual(findPriorAcquisitionEvidence(fx.evidenceDir), []);
  assert.doesNotThrow(() => assertNoPriorAcquisition(fx.evidenceDir));
  // One byte is enough.
  writeFileSync(join(fx.evidenceDir, 'contact-log.jsonl'), '\n');
  assert.deepEqual(findPriorAcquisitionEvidence(fx.evidenceDir), [{ name: 'contact-log.jsonl', detail: '1 bytes' }]);
  assert.throws(() => assertNoPriorAcquisition(fx.evidenceDir), AcquisitionRefusal);
});

test('R-4: run evidence that is not a regular file fails closed', () => {
  const fx = synthAuthority();
  mkdirSync(join(fx.evidenceDir, 'contact-log.jsonl'));
  assert.deepEqual(findPriorAcquisitionEvidence(fx.evidenceDir), [{ name: 'contact-log.jsonl', detail: 'present but not a regular file — fails closed' }]);
  assert.throws(() => assertNoPriorAcquisition(fx.evidenceDir), /present but not a regular file — fails closed/);
});

test('R-4: a census-input file from a prior run refuses even with the ledgers removed', async () => {
  // Unreachable from any path a run can take (a census-input file only ever follows a
  // contact-log line), so this is the hand-edited-evidence-directory case: the results
  // of a completed acquisition are still on disk and must not be silently overwritten.
  const fx = synthAuthority();
  mkdirSync(join(fx.evidenceDir, 'metadata'));
  const bytes = JSON.stringify({ rank: 1, provider: 'USGS' }) + '\n';
  writeFileSync(join(fx.evidenceDir, 'metadata', 'rank-1.json'), bytes);
  assert.deepEqual(findPriorAcquisitionEvidence(fx.evidenceDir), [{ name: 'metadata/', detail: '1 census-input file(s)' }]);
  const calls = [];
  const { code, err } = await runMain(['--execute'], fx, {
    fetchImpl: transport(OK_BODIES(), calls),
    preparePinInvariance: () => { throw new Error('pin-invariance must not be prepared over prior census-input files'); },
  });
  assert.equal(code, 1);
  assert.match(err, /metadata\/ \[1 census-input file\(s\)\]/);
  assert.equal(calls.length, 0, 'zero transport');
  assert.equal(readFileSync(join(fx.evidenceDir, 'metadata', 'rank-1.json'), 'utf8'), bytes, 'byte-identical');
});

test('R-4: no override, resume flag or environment escape exists', () => {
  const src = readFileSync(join(REPO_ROOT, 'lab/acquisition/acquire.js'), 'utf8');
  assert.doesNotMatch(src, /--resume|--force|--again|--rerun|LOA_[A-Z_]*(FORCE|RESUME|OVERRIDE)/, 'no bypass flag or env escape is offered');
  // `--execute` and `--preflight` remain the ONLY accepted arguments (fail-closed).
  assert.throws(() => parseArgs(['--resume']), AcquisitionRefusal);
  assert.throws(() => parseArgs(['--force']), AcquisitionRefusal);
});
