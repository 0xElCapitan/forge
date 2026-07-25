// lab/test/acquisition-guards.spec.js
//
// Cycle-005 S01 (PRD FR-B2/FR-B3, NFR-CONTAM-1..4, NFR-SEC; SDD DR-3 G2/G4/G6;
// Sprint Plan T1.8). The G2 three-way response classification, the DR-3 contamination
// procedure end-to-end (EIA rows-despite-length=0 → class 4 + HALT + NOT_ATTEMPTED,
// zero persistence), G4 redaction, and G6 date-pinning-is-defense-in-depth-only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { guardResponse, RESPONSE_DECLS, redactUrl, GUARD_OUTCOME, GUARD_REASON, VALUE_EXPOSURE } from '../acquisition/guards.js';
import { assertDatePinning, ROUTES, matchRoute } from '../acquisition/routes.js';
import { acquirePool, HALT_RECORD_NAME } from '../acquisition/acquire.js';
import { extractors } from '../acquisition/extract.js';
import { readLedger } from '../harness/ledgers.js';
import { contentAddress } from '../harness/manifests.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const buf = (s) => Buffer.from(s, 'utf8');
const resp = (body, { status = 200, contentType = 'application/json', truncated = false } = {}) => ({ status, contentType, bodyBuffer: buf(body), truncated });

/** Load one rehearsal provider-response body from the Lane A fixture set (LF-joined). */
function fixtureBody(file, name) {
  const f = JSON.parse(readFileSync(join(REPO_ROOT, 'lab/acquisition/fixtures/provider-responses', file), 'utf8'));
  const r = f.responses[name];
  assert.ok(r, `fixture ${file} carries response "${name}"`);
  return { body: r.body_lines.join('\n'), contentType: r.content_type };
}

test('G2: EIA clean count (data:[]) → conformant / none_detected', () => {
  const g = guardResponse(RESPONSE_DECLS['eia-v2-envelope'], resp(JSON.stringify({ response: { total: '87600', data: [] } })));
  assert.equal(g.outcome, GUARD_OUTCOME.CONFORMANT);
  assert.equal(g.value_exposure_status, VALUE_EXPOSURE.NONE);
  assert.ok(g.parsed, 'conformant body is handed on to extract');
});

test('G2: EIA rows despite length=0 → value_bearing / detected (NEVER downgraded to class 3)', () => {
  const g = guardResponse(RESPONSE_DECLS['eia-v2-envelope'], resp(JSON.stringify({ response: { total: '5', data: [{ period: '2020-01-01T00', value: 4321.7 }] } })));
  assert.equal(g.outcome, GUARD_OUTCOME.VALUE_BEARING);
  assert.equal(g.value_exposure_status, VALUE_EXPOSURE.DETECTED);
  assert.equal(g.parsed, null, 'a value-bearing body is NEVER handed on');
});

test('G2: EIA data present-but-not-array → indeterminate (fail-closed, treated as detected)', () => {
  const g = guardResponse(RESPONSE_DECLS['eia-v2-envelope'], resp(JSON.stringify({ response: { total: '5', data: { rows: 1 } } })));
  assert.equal(g.outcome, GUARD_OUTCOME.INDETERMINATE);
  assert.equal(g.value_exposure_status, VALUE_EXPOSURE.INDETERMINATE);
});

test('G2: wrong content-type → non_value_incompatible (discard, continue, none_detected)', () => {
  const g = guardResponse(RESPONSE_DECLS['eia-v2-envelope'], resp(JSON.stringify({ response: { total: '1', data: [] } }), { contentType: 'text/html' }));
  assert.equal(g.outcome, GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE);
  assert.equal(g.value_exposure_status, VALUE_EXPOSURE.NONE);
});

test('G2: truncated (size-cap abort) → indeterminate (never conformant)', () => {
  const g = guardResponse(RESPONSE_DECLS['eia-v2-envelope'], resp(JSON.stringify({ response: { total: '1', data: [] } }), { truncated: true }));
  assert.equal(g.outcome, GUARD_OUTCOME.INDETERMINATE);
});

test('G2: malformed JSON → non_value_incompatible', () => {
  const g = guardResponse(RESPONSE_DECLS['eia-v2-envelope'], resp('{not json', {}));
  assert.equal(g.outcome, GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE);
});

test('G2: a USGS RDB body carrying per-timestamp observation rows → value_bearing', () => {
  const rdb = 'agency_cd\tsite_no\tdatetime\tvalue\n5s\t15s\t20d\t14n\nUSGS\t01646500\t2020-01-01 00:00\t3.14\nUSGS\t01646500\t2020-01-01 00:15\t3.15\n';
  const g = guardResponse(RESPONSE_DECLS['usgs-nwis-site-rdb'], resp(rdb, { contentType: 'text/plain' }));
  assert.equal(g.outcome, GUARD_OUTCOME.VALUE_BEARING);
});

// ─── M1 (pre-G0 remediation): the USGS RDB comment preamble is metadata ────────
//
// Every NWIS RDB body opens with a `#` preamble carrying `# retrieved: YYYY-MM-DD
// HH:MM:SS ...`. The pre-remediation scan read that provider header as an
// observation row and typed a benign catalog response class-4 contamination
// (15-cycle-005-g0-decision-brief.md §1.3 M1).

test('M1: a realistic USGS RDB catalog with a `# retrieved:` preamble → conformant / none_detected', () => {
  const { body, contentType } = fixtureBody('usgs-nwis-site-rdb.json', 'catalog_conformant');
  assert.match(body, /^# retrieved: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/m, 'the fixture really carries a datetime-bearing preamble line');
  const g = guardResponse(RESPONSE_DECLS['usgs-nwis-site-rdb'], resp(body, { contentType }));
  assert.equal(g.outcome, GUARD_OUTCOME.CONFORMANT);
  assert.equal(g.value_exposure_status, VALUE_EXPOSURE.NONE);
  assert.ok(g.parsed, 'a conformant catalog body is handed on to extract');
});

test('M1: the same catalog with a genuine non-comment observation row → value_bearing / detected', () => {
  const { body, contentType } = fixtureBody('usgs-nwis-site-rdb.json', 'catalog_with_observation_row');
  const g = guardResponse(RESPONSE_DECLS['usgs-nwis-site-rdb'], resp(body, { contentType }));
  assert.equal(g.outcome, GUARD_OUTCOME.VALUE_BEARING);
  assert.equal(g.value_exposure_status, VALUE_EXPOSURE.DETECTED);
  assert.equal(g.parsed, null, 'a value-bearing body is NEVER handed on');
});

test('M1 mutation evidence: the pre-remediation guard FAILS this regression (non-vacuous)', () => {
  // A verbatim replica of the pre-remediation `usgs-nwis-site-rdb` classifier: the
  // observation scan read EVERY non-empty line, comment lines included.
  const preRemediation = {
    decl_id: 'usgs-nwis-site-rdb@pre-remediation',
    content_types: ['text/plain', 'text/rdb', 'application/octet-stream'],
    max_bytes: 5 * 1024 * 1024,
    classify(text) {
      const ls = text.split(/\r?\n/).filter(l => l.length > 0);
      const valueRows = ls.filter(l => /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(l)).length;
      if (valueRows > 0) return { shape: GUARD_OUTCOME.VALUE_BEARING, reasons: [`${valueRows} row(s) match an observation datetime+value pattern (value-bearing series)`] };
      if (!['site_no', 'agency_cd'].some(tok => text.includes(tok))) return { shape: GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, reasons: ['declared metadata header tokens absent (wrong/foreign surface)'] };
      if (ls.length > 5000) return { shape: GUARD_OUTCOME.INDETERMINATE, reasons: ['row count exceeds the declared inventory bound'] };
      return { shape: GUARD_OUTCOME.CONFORMANT, reasons: [] };
    },
  };
  const { body, contentType } = fixtureBody('usgs-nwis-site-rdb.json', 'catalog_conformant');
  const before = guardResponse(preRemediation, resp(body, { contentType }));
  assert.equal(before.outcome, GUARD_OUTCOME.VALUE_BEARING, 'the pre-remediation guard false-positives the benign catalog');
  assert.equal(before.value_exposure_status, VALUE_EXPOSURE.DETECTED);
  const after = guardResponse(RESPONSE_DECLS['usgs-nwis-site-rdb'], resp(body, { contentType }));
  assert.equal(after.outcome, GUARD_OUTCOME.CONFORMANT, 'the remediated guard passes it as metadata');
  // …and both agree the genuine observation body is value-bearing (the fix is narrow).
  const obs = fixtureBody('usgs-nwis-site-rdb.json', 'catalog_with_observation_row');
  assert.equal(guardResponse(preRemediation, resp(obs.body, { contentType: obs.contentType })).outcome, GUARD_OUTCOME.VALUE_BEARING);
  assert.equal(guardResponse(RESPONSE_DECLS['usgs-nwis-site-rdb'], resp(obs.body, { contentType: obs.contentType })).outcome, GUARD_OUTCOME.VALUE_BEARING);
});

test('M1: guard and extractor now read the SAME body identically (the asymmetry is closed)', () => {
  const { body, contentType } = fixtureBody('usgs-nwis-site-rdb.json', 'catalog_conformant');
  const g = guardResponse(RESPONSE_DECLS['usgs-nwis-site-rdb'], resp(body, { contentType }));
  assert.equal(g.outcome, GUARD_OUTCOME.CONFORMANT);
  const e = extractors['usgs-nwis-site-metadata'](g.parsed);
  assert.ok(Number.isFinite(e.fields.history_years) && e.fields.history_years > 3, 'period of record extracted from the same body');
  assert.equal(e.fields.n_observations, null, 'n_observations stays class 3 for this surface (Gate-A UD-1)');
});

test('M1: fail-closed behavior is unchanged — a truncated USGS body is still indeterminate', () => {
  const { body, contentType } = fixtureBody('usgs-nwis-site-rdb.json', 'catalog_conformant');
  const g = guardResponse(RESPONSE_DECLS['usgs-nwis-site-rdb'], resp(body, { contentType, truncated: true }));
  assert.equal(g.outcome, GUARD_OUTCOME.INDETERMINATE);
  // …a foreign surface is still non_value_incompatible…
  const foreign = guardResponse(RESPONSE_DECLS['usgs-nwis-site-rdb'], resp('# retrieved: 2026-07-24 18:22:31\n#\n', { contentType }));
  assert.equal(foreign.outcome, GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE);
  // …and a comment-only body never becomes a lawful catalog.
  assert.equal(foreign.value_exposure_status, VALUE_EXPOSURE.NONE);
});

test('G2: an invalid/missing declaration → indeterminate (fail-closed)', () => {
  const g = guardResponse(null, resp('{}'));
  assert.equal(g.outcome, GUARD_OUTCOME.INDETERMINATE);
});

test('G4: redactUrl strips credential params; a planted key never survives', () => {
  const url = matchRoute('eia-electricity-demand-count', { period_of_record_start: '2015-01-01', api_key: 'PLANTED_SECRET_KEY_123' }).url;
  assert.ok(url.includes('PLANTED_SECRET_KEY_123'), 'the live url carries the key');
  const red = redactUrl(url);
  assert.ok(!red.includes('PLANTED_SECRET_KEY_123'), 'the redacted url carries no key');
  assert.match(red, /api_key=REDACTED/);
});

test('G6: the route table is lawfully date-pinned (period-of-record-start, never latest)', () => {
  assert.ok(assertDatePinning(ROUTES));
  // the EIA template is the only date-pinned one and binds period_of_record_start
  assert.equal(ROUTES['eia-electricity-demand-count'].date_pinning.semantics, 'period-of-record-start');
});

test('DR-3 contamination procedure end-to-end: value-bearing → class 4 + HALT + NOT_ATTEMPTED + zero persistence', async () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), 'c005-contam-'));
  const PLANTED_KEY = 'FAKE_EIA_KEY_XYZ';
  const CONTAMINATING_VALUE = 4321.7;
  // Injected fetch: the EIA endpoint returns a data row despite length=0 (the R4 hazard).
  const fetchImpl = async () => ({
    status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    arrayBuffer: async () => Buffer.from(JSON.stringify({ response: { total: '5', data: [{ period: '2020-01-01T00', value: CONTAMINATING_VALUE }] } })),
    body: null,
  });

  const candidates = [
    { rank: 1, provider: 'EIA', product: 'hourly electricity demand', route_method_id: 'eia-electricity-demand-count', route_class: 'series-metadata', contact_params: { period_of_record_start: '2015-01-01' }, authored_inputs: {}, measured_methods: {} },
    { rank: 2, provider: 'USGS', product: 'NWIS river stage/discharge', route_method_id: 'usgs-nwis-site-metadata', route_class: 'metadata', contact_params: { sites: '01646500' }, authored_inputs: {}, measured_methods: {} },
  ];
  const out = await acquirePool({ candidates, evidenceDir, io: { fetchImpl, env: { FORGE_EIA_API_KEY: PLANTED_KEY } }, now: () => '2026-01-01T00:00:00Z' });

  assert.equal(out.halted, true, 'the run HALTED on contamination');
  assert.equal(out.results[0].status, 'class4_contamination', 'the contaminating candidate is class 4 (never class 3)');
  assert.equal(out.results[1].status, 'NOT_ATTEMPTED_DUE_TERMINAL_HALT', 'the later candidate is NOT_ATTEMPTED');

  // The contamination event is recorded (class 4), and the exposed value is NEVER persisted (G3).
  const contam = readLedger(join(evidenceDir, 'contamination-events.jsonl'));
  assert.equal(contam.length, 1);
  assert.equal(contam[0].resulting_classification, 'class4_contamination');
  const allWritten = ['contact-log.jsonl', 'contamination-events.jsonl', HALT_RECORD_NAME].map(f => existsSync(join(evidenceDir, f)) ? readFileSync(join(evidenceDir, f), 'utf8') : '').join('\n');
  assert.ok(!allWritten.includes(String(CONTAMINATING_VALUE)), 'the exposed value never reaches any persisted artifact (G3 zero-raw-persistence)');
  assert.ok(!allWritten.includes(PLANTED_KEY), 'the credential never reaches any persisted artifact (G4)');
  // No census-input metadata file was written for the contaminated candidate.
  assert.ok(!existsSync(join(evidenceDir, 'metadata')), 'no metadata written on a contaminating run');

  // F2 (DR-3 step 5): the governing HALT record is durable, and BOTH the contamination
  // event and the orphaned later candidate resolve to that same one record.
  assert.equal(contam[0].halt_ref, HALT_RECORD_NAME);
  const halt = JSON.parse(readFileSync(join(evidenceDir, contam[0].halt_ref), 'utf8'));
  const { record_id, ...rest } = halt;
  assert.equal(record_id, contentAddress(rest), 'the HALT record verifies its own content id');
  assert.equal(contam[0].halt_record_id, record_id);
  assert.equal(out.results[0].halt_ref, HALT_RECORD_NAME);
  assert.equal(out.results[1].governing_halt_ref, HALT_RECORD_NAME);
  assert.equal(out.results[1].governing_halt_record_id, record_id, 'the NOT_ATTEMPTED candidate names the SAME governing HALT identity');
  assert.deepEqual(halt.blast_radius.not_attempted_ranks, [2]);
});

test('F2: the INDETERMINATE class-4 path writes the same durable HALT record (fail-closed parity)', async () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), 'c005-contam-indet-'));
  // `response.data` present but not an array → indeterminate → treated as detected.
  const fetchImpl = async () => ({
    status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    arrayBuffer: async () => Buffer.from(JSON.stringify({ response: { total: '5', data: { rows: 1 } } })),
    body: null,
  });
  const candidates = [
    { rank: 1, provider: 'EIA', product: 'hourly electricity demand', route_method_id: 'eia-electricity-demand-count', contact_params: { period_of_record_start: '2015-01-01' }, authored_inputs: {}, measured_methods: {} },
    { rank: 2, provider: 'USGS', product: 'NWIS river stage/discharge', route_method_id: 'usgs-nwis-site-metadata', contact_params: { sites: '01646500' }, authored_inputs: {}, measured_methods: {} },
    { rank: 3, provider: 'NOAA', product: 'buoy wave height', route_method_id: 'noaa-ndbc-station-metadata', contact_params: {}, authored_inputs: {}, measured_methods: {} },
  ];
  const out = await acquirePool({ candidates, evidenceDir, io: { fetchImpl, env: { FORGE_EIA_API_KEY: 'K' } }, now: () => '2026-01-01T00:00:00Z' });

  assert.equal(out.halted, true);
  assert.equal(out.results[0].status, 'class4_contamination', 'indeterminate is class 4, never class 3');
  const contam = readLedger(join(evidenceDir, 'contamination-events.jsonl'));
  assert.equal(contam[0].exposure_class, VALUE_EXPOSURE.INDETERMINATE);
  const haltPath = join(evidenceDir, contam[0].halt_ref);
  assert.ok(existsSync(haltPath), 'an indeterminate class-4 path also leaves a resolvable halt_ref');
  const halt = JSON.parse(readFileSync(haltPath, 'utf8'));
  assert.equal(halt.class, 'contamination');
  assert.equal(halt.evidence.exposure_class, VALUE_EXPOSURE.INDETERMINATE);
  assert.deepEqual(halt.evidence.guard_events, ['g2:indeterminate']);
  assert.deepEqual(halt.blast_radius.not_attempted_ranks, [2, 3]);
  // Both orphaned candidates are governed by the one HALT identity.
  const governing = new Set(out.results.slice(1).map(r => r.governing_halt_record_id));
  assert.equal(governing.size, 1);
  assert.deepEqual([...governing], [halt.record_id]);
});

// ─── F3: stable guard reason codes ────────────────────────────────────────────

test('F3: every guard path carries a stable reason code naming WHY, not just the outcome', () => {
  const cases = [
    ['conformant EIA count', RESPONSE_DECLS['eia-v2-envelope'], resp(JSON.stringify({ response: { total: '1', data: [] } })), GUARD_REASON.CONFORMANT],
    ['EIA rows despite length=0', RESPONSE_DECLS['eia-v2-envelope'], resp(JSON.stringify({ response: { total: '1', data: [{ v: 1 }] } })), GUARD_REASON.DATA_ROWS_DESPITE_LENGTH_ZERO],
    ['EIA data not an array', RESPONSE_DECLS['eia-v2-envelope'], resp(JSON.stringify({ response: { total: '1', data: {} } })), GUARD_REASON.DATA_PRESENT_NOT_ARRAY],
    ['EIA total absent', RESPONSE_DECLS['eia-v2-envelope'], resp(JSON.stringify({ response: { data: [] } })), GUARD_REASON.AGGREGATE_TOTAL_ABSENT],
    ['EIA no envelope', RESPONSE_DECLS['eia-v2-envelope'], resp(JSON.stringify({ nope: 1 })), GUARD_REASON.NO_RESPONSE_ENVELOPE],
    ['malformed JSON', RESPONSE_DECLS['eia-v2-envelope'], resp('{not json'), GUARD_REASON.MALFORMED_JSON],
    ['not a JSON object', RESPONSE_DECLS['eia-v2-envelope'], resp('42'), GUARD_REASON.NOT_JSON_OBJECT],
    ['wrong content-type', RESPONSE_DECLS['eia-v2-envelope'], resp('{}', { contentType: 'text/html' }), GUARD_REASON.CONTENT_TYPE_NOT_ALLOWLISTED],
    ['truncated at the cap', RESPONSE_DECLS['eia-v2-envelope'], resp('{}', { truncated: true }), GUARD_REASON.TRUNCATED_AT_CAP],
    ['CO-OPS value array present', RESPONSE_DECLS['noaa-coops-mdapi-json'], resp(JSON.stringify({ stations: [{}], predictions: [{ t: 1 }] })), GUARD_REASON.VALUE_BEARING_ARRAY_PRESENT],
    ['CO-OPS no station block', RESPONSE_DECLS['noaa-coops-mdapi-json'], resp(JSON.stringify({ metadata: {} })), GUARD_REASON.NO_STATION_BLOCK],
    ['USGS observation rows', RESPONSE_DECLS['usgs-nwis-site-rdb'], resp('agency_cd\tsite_no\tdatetime\nUSGS\t01646500\t2020-01-01 00:00\t3.14\n', { contentType: 'text/plain' }), GUARD_REASON.OBSERVATION_ROWS_PRESENT],
    ['USGS foreign surface', RESPONSE_DECLS['usgs-nwis-site-rdb'], resp('nothing\tuseful\n', { contentType: 'text/plain' }), GUARD_REASON.DECLARED_HEADER_ABSENT],
    ['empty body', RESPONSE_DECLS['usgs-nwis-site-rdb'], resp('', { contentType: 'text/plain' }), GUARD_REASON.EMPTY_BODY],
    ['no declaration', null, resp('{}'), GUARD_REASON.NO_DECLARATION],
    ['no byte body', RESPONSE_DECLS['eia-v2-envelope'], { status: 200, contentType: 'application/json' }, GUARD_REASON.NO_BYTE_BODY],
  ];
  for (const [label, decl, response, expected] of cases) {
    const g = guardResponse(decl, response);
    assert.equal(g.reason_code, expected, `${label} → ${expected} (got ${g.reason_code})`);
    assert.ok(Object.values(GUARD_REASON).includes(g.reason_code), `${label}: the code is a declared GUARD_REASON`);
    if (g.outcome !== GUARD_OUTCOME.CONFORMANT) assert.ok(g.reasons.length > 0, `${label}: a prose reason accompanies the code`);
  }
  // The row-count bound and the validator-throw paths.
  const flood = 'site_no\n' + Array.from({ length: 5001 }, (_, i) => `row-${i}`).join('\n');
  assert.equal(guardResponse(RESPONSE_DECLS['usgs-nwis-site-rdb'], resp(flood, { contentType: 'text/plain' })).reason_code, GUARD_REASON.ROW_COUNT_OVER_BOUND);
  const thrower = { decl_id: 't', content_types: ['application/json'], classify() { throw new Error('boom'); } };
  assert.equal(guardResponse(thrower, resp('{}')).reason_code, GUARD_REASON.VALIDATOR_THREW);
  const badShape = { decl_id: 't', content_types: ['application/json'], classify() { return { shape: 'nonsense' }; } };
  assert.equal(guardResponse(badShape, resp('{}')).reason_code, GUARD_REASON.VALIDATOR_SHAPE_UNRECOGNIZED);
  // A shape-compatible declaration that supplies no code degrades the LABEL only.
  const codeless = { decl_id: 't', content_types: ['application/json'], classify() { return { shape: GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, reasons: ['no code supplied'] }; } };
  const g = guardResponse(codeless, resp('{}'));
  assert.equal(g.reason_code, GUARD_REASON.UNSPECIFIED);
  assert.equal(g.outcome, GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, 'the outcome and reasons stay authoritative');
});

test('F3: no guard reason code or prose reason quotes response content (G3)', () => {
  const SECRET = 'S3CRET-ROW-VALUE-98765';
  const probes = [
    guardResponse(RESPONSE_DECLS['eia-v2-envelope'], resp(JSON.stringify({ response: { total: '1', data: [{ period: '2020-01-01T00', value: SECRET }] } }))),
    guardResponse(RESPONSE_DECLS['usgs-nwis-site-rdb'], resp(`agency_cd\tsite_no\tdatetime\nUSGS\t01646500\t2020-01-01 00:00\t${SECRET}\n`, { contentType: 'text/plain' })),
    guardResponse(RESPONSE_DECLS['noaa-coops-mdapi-json'], resp(JSON.stringify({ stations: [{}], data: [{ v: SECRET }] }))),
  ];
  for (const g of probes) {
    const text = JSON.stringify({ reason_code: g.reason_code, reasons: g.reasons, guard_events: g.guard_events });
    assert.ok(!text.includes(SECRET), 'a guard reason names structure only, never a response value');
    assert.equal(g.parsed, null, 'and a value-bearing body is never handed on');
  }
});
