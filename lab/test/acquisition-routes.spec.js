// lab/test/acquisition-routes.spec.js
//
// Cycle-005 pre-G0 apparatus remediation, review finding F1 (PRD FR-B3, NFR-SEC;
// SDD DR-3 G1/G8; 17-cycle-005-pre-g0-apparatus-remediation-review.md §4 F-1).
//
// PATH-PARAMETER AUTHORITY. `routes.js` percent-encodes query values but used to
// substitute PATH placeholders verbatim, so a `station` value carrying path/query/
// fragment structure could make `matchRoute` emit a URL that `new URL()` normalizes
// onto a DIFFERENT path of the same allowlisted host (the review reproduced
// `/mdapi/prod/webapi/stations/{station}/details.json` collapsing to
// `/api/prod/datagetter`). This spec proves that
//
//   - the pinned identifiers still resolve byte-for-byte to the frozen template;
//   - every path-escape shape (`/`, `\`, `..`, encoded separators, query markers,
//     fragments, whitespace/control tricks, over-long values) is REFUSED, before any
//     transport, by a value that never reaches `fetch`;
//   - the probes are genuinely hostile: naive substitution of the same values DOES
//     normalize onto another path (non-vacuity control, not a replica of the fix);
//   - the structural back-stop refuses a URL that does not normalize onto the
//     authorized host + template path, independently of the charset gate;
//   - a hostile QUERY value cannot alter the path either (pre-existing encoding).
//
// No provider is contacted: every transport is an injected stub that FAILS the test
// if it is ever called.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ROUTES, matchRoute, templateParams, assertPathParamValue, assertUrlStructure, RouteRefusal } from '../acquisition/routes.js';
import { contactRoute } from '../acquisition/contact.js';

/** A transport that must never be reached; any call fails the test. */
function forbiddenTransport(calls) {
  return async (url) => {
    calls.push(url);
    throw new Error(`transport must never be reached (called with ${url})`);
  };
}

/**
 * Path-escape probes for the ONLY path-templated route
 * (`noaa-coops-station-metadata` → `/mdapi/prod/webapi/stations/{station}/details.json`).
 * Each is a value a G0 record or a direct caller could once have supplied; the
 * non-vacuity control below proves every one of them reaches a path OTHER than the
 * authorized one under naive substitution.
 */
const HOSTILE_STATION_VALUES = [
  { label: 'the reviewed reproduction (traversal + query + fragment)', value: '../../../../api/prod/datagetter?product=water_level&begin_date=20200101#' },
  { label: 'relative traversal after a valid id', value: '9414290/../../../api/prod/datagetter' },
  { label: 'a bare added path segment', value: '9414290/details' },
  { label: 'a leading slash', value: '/api/prod/datagetter' },
  { label: 'a protocol-relative authority', value: '//api.tidesandcurrents.noaa.gov/api/prod/datagetter' },
  { label: 'a backslash separator', value: '9414290\\..\\..\\datagetter' },
  { label: 'percent-encoded separators', value: '..%2F..%2Fapi%2Fprod%2Fdatagetter' },
  { label: 'percent-encoded dots', value: '%2e%2e/%2e%2e/datagetter' },
  { label: 'a query marker', value: '9414290?product=water_level' },
  { label: 'a fragment marker', value: '9414290#details' },
  { label: 'a colon (authority-ambiguous)', value: '9414290:8443' },
  { label: 'a bare relative segment', value: '..' },
  { label: 'a bare current segment', value: '.' },
  { label: 'a trailing space', value: '9414290 ' },
  { label: 'a leading space', value: ' 9414290' },
  { label: 'an embedded newline', value: '9414290\n/api/prod/datagetter' },
  { label: 'an embedded tab', value: '9414290\t/api/prod/datagetter' },
  { label: 'an embedded NUL', value: '9414290\u0000' },
  { label: 'an over-long value', value: '9'.repeat(129) },
];

const COOPS = 'noaa-coops-station-metadata';
const USGS = 'usgs-nwis-site-metadata';

// ─── The pinned identifiers still resolve, unchanged ──────────────────────────

test('F1: the pinned CO-OPS station id resolves to exactly the frozen template path', () => {
  const plan = matchRoute(COOPS, { station: '9414290' });
  assert.equal(plan.url, 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9414290/details.json?units=metric');
  assert.equal(new URL(plan.url).pathname, '/mdapi/prod/webapi/stations/9414290/details.json', 'the id lands in its own segment, unencoded');
  assert.equal(plan.host, ROUTES[COOPS].host);
  assert.equal(plan.route_class, 'metadata');
});

test('F1: the pinned USGS site id resolves and the paramless routes are unaffected', () => {
  const usgs = matchRoute(USGS, { sites: '01646500' });
  assert.equal(new URL(usgs.url).pathname, '/nwis/site/');
  assert.equal(new URL(usgs.url).searchParams.get('sites'), '01646500');
  assert.equal(new URL(matchRoute('noaa-ndbc-station-metadata').url).pathname, '/data/stations/station_table.txt');
  assert.equal(new URL(matchRoute('nws-isd-station-inventory').url).pathname, '/pub/data/noaa/isd-history.csv');
  // …and the date-pinned credentialed template still builds under G6 (never contacted here).
  const eia = matchRoute('eia-electricity-demand-count', { period_of_record_start: '2015-07-01', api_key: 'K' });
  assert.equal(new URL(eia.url).pathname, '/v2/electricity/rto/region-data/data/');
});

test('F1: lawful identifier shapes (digits, letters, dot, underscore, hyphen) still pass', () => {
  for (const v of ['9414290', '01646500', 'KDCA', 'station_1', 'a-b.c', '9'.repeat(128)]) {
    assert.doesNotThrow(() => assertPathParamValue('station', v, 'probe'), `"${v}" must remain lawful`);
  }
});

// ─── Every path-escape shape is refused, before any transport ─────────────────

for (const { label, value } of HOSTILE_STATION_VALUES) {
  test(`F1: matchRoute REFUSES a station value with ${label}`, () => {
    assert.throws(() => matchRoute(COOPS, { station: value }), RouteRefusal, `"${value}" must be refused`);
  });

  test(`F1: contactRoute performs ZERO transport for a station value with ${label}`, async () => {
    const calls = [];
    await assert.rejects(
      () => contactRoute(COOPS, { station: value }, { fetchImpl: forbiddenTransport(calls), env: {} }),
      RouteRefusal,
    );
    assert.equal(calls.length, 0, 'the refusal happens before the URL is ever handed to a transport');
  });
}

test('F1 non-vacuity: the probes really would have escaped under naive substitution', () => {
  const template = ROUTES[COOPS].path_template;
  const authorized = template.replace('{station}', '9414290');
  for (const { label, value } of HOSTILE_STATION_VALUES) {
    const naive = `https://${ROUTES[COOPS].host}${template.replace('{station}', value)}`;
    let pathname;
    try { pathname = new URL(naive).pathname; } catch { pathname = null; }
    assert.notEqual(pathname, authorized, `naive substitution of ${label} must resolve somewhere other than the authorized path`);
  }
  // The reviewed reproduction specifically collapses onto a value-serving path.
  const reproduction = HOSTILE_STATION_VALUES[0].value;
  const naive = new URL(`https://${ROUTES[COOPS].host}${template.replace('{station}', reproduction)}`);
  assert.equal(naive.pathname, '/api/prod/datagetter', 'the reviewed reproduction normalizes onto another path of the same allowlisted host');
  assert.equal(naive.host, ROUTES[COOPS].host, '…on the same allowlisted host — which is exactly why the charset gate, not the host allowlist, must catch it');
});

// ─── The structural back-stop, exercised directly (not a replica) ─────────────

test('F1: assertUrlStructure refuses a URL that does not normalize onto the authorized host + path', () => {
  const route = ROUTES[COOPS];
  const authorized = '/mdapi/prod/webapi/stations/9414290/details.json';
  // Same host, normalized-away path — the escape the charset gate now prevents upstream.
  assert.throws(
    () => assertUrlStructure(COOPS, `https://${route.host}/mdapi/prod/webapi/stations/../../../../api/prod/datagetter`, route, authorized),
    /path normalizes to .* instead of the authorized template path/,
  );
  // Foreign host.
  assert.throws(() => assertUrlStructure(COOPS, `https://evil.example.com${authorized}`, route, authorized), /not the allowlisted host/);
  // Non-https.
  assert.throws(() => assertUrlStructure(COOPS, `http://${route.host}${authorized}`, route, authorized), /is not the allowlisted "https:"/);
  // Fragment.
  assert.throws(() => assertUrlStructure(COOPS, `https://${route.host}${authorized}#x`, route, authorized), /carries a fragment/);
  // Unparseable.
  assert.throws(() => assertUrlStructure(COOPS, 'not-a-url', route, authorized), /not parseable/);
  // …and the authorized URL passes.
  assert.doesNotThrow(() => assertUrlStructure(COOPS, `https://${route.host}${authorized}?units=metric`, route, authorized));
});

// ─── Query values cannot alter the path either (pre-existing encoding, asserted) ──

test('F1: a hostile QUERY value is encoded and cannot alter the path or host', () => {
  const plan = matchRoute(USGS, { sites: '../../../../nwis/iv/?format=json&period=P7D#' });
  const u = new URL(plan.url);
  assert.equal(u.pathname, '/nwis/site/', 'the path template is untouched by a query value');
  assert.equal(u.host, ROUTES[USGS].host);
  assert.equal(u.hash, '', 'no fragment is introduced');
  assert.ok(plan.url.includes('sites=..%2F..%2F'), 'the separators are percent-encoded, not structural');
});

// ─── Placeholder position is derived from the frozen templates ────────────────

test('F1: templateParams splits placeholders by position, from the frozen templates', () => {
  assert.deepEqual(templateParams(COOPS), { path: ['station'], query: [] });
  assert.deepEqual(templateParams(USGS), { path: [], query: ['sites'] });
  assert.deepEqual(templateParams('noaa-ndbc-station-metadata'), { path: [], query: [] });
  assert.deepEqual(templateParams('nws-isd-station-inventory'), { path: [], query: [] });
  assert.deepEqual(templateParams('eia-electricity-demand-count'), { path: [], query: ['period_of_record_start', 'api_key'] });
  assert.throws(() => templateParams('not-a-route'), RouteRefusal);
  // Exactly one frozen route is path-templated — if that ever changes, this spec must grow.
  const pathTemplated = Object.keys(ROUTES).filter(id => templateParams(id).path.length > 0);
  assert.deepEqual(pathTemplated, [COOPS]);
});

test('F1: a missing path parameter is still refused (unconstructable URL, unchanged)', () => {
  assert.throws(() => matchRoute(COOPS, {}), /missing required param "station"/);
  assert.throws(() => matchRoute(COOPS, { station: '' }), RouteRefusal);
  assert.throws(() => matchRoute(COOPS, { station: null }), RouteRefusal);
});
