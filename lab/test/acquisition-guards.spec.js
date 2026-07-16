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

import { guardResponse, RESPONSE_DECLS, redactUrl, GUARD_OUTCOME, VALUE_EXPOSURE } from '../acquisition/guards.js';
import { assertDatePinning, ROUTES, matchRoute } from '../acquisition/routes.js';
import { acquirePool } from '../acquisition/acquire.js';
import { readLedger } from '../harness/ledgers.js';

const buf = (s) => Buffer.from(s, 'utf8');
const resp = (body, { status = 200, contentType = 'application/json', truncated = false } = {}) => ({ status, contentType, bodyBuffer: buf(body), truncated });

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
  const allWritten = ['contact-log.jsonl', 'contamination-events.jsonl'].map(f => existsSync(join(evidenceDir, f)) ? readFileSync(join(evidenceDir, f), 'utf8') : '').join('\n');
  assert.ok(!allWritten.includes(String(CONTAMINATING_VALUE)), 'the exposed value never reaches any persisted artifact (G3 zero-raw-persistence)');
  assert.ok(!allWritten.includes(PLANTED_KEY), 'the credential never reaches any persisted artifact (G4)');
  // No census-input metadata file was written for the contaminated candidate.
  assert.ok(!existsSync(join(evidenceDir, 'metadata')), 'no metadata written on a contaminating run');
});
