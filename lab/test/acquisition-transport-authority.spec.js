// lab/test/acquisition-transport-authority.spec.js
//
// Cycle-005 pre-G0 apparatus remediation, correction-review findings C-5 and C-6
// (PRD FR-B2/FR-B3, NFR-SEC; SDD DR-3 G1/G4/G8;
// 19-cycle-005-pre-g0-f1-f3-correction-review.md §7 C-5, C-6).
//
// TRANSPORT-LEVEL ROUTE AUTHORITY — the two properties `contact.js` owns once a
// response (or a redirect) actually arrives:
//
//   C-5  a FINAL (post-redirect) response outside the accepted HTTP success range
//        is not a successful contact. It is refused with its ACTUAL status and the
//        G4-redacted route, its body is never read (so it can reach neither the
//        guard nor the extractor nor any record), and a status alone is never
//        grounds for contamination. 2xx behaviour is unchanged; 3xx keeps its own
//        distinct redirect handling.
//
//   C-6  a redirect may be followed ONLY when the target is the same frozen,
//        G0-authorized route: same https scheme, same allowlisted host, same route
//        identity and template path, same authorized path-placeholder values, and
//        the same query parameter keys AND values with only ORDER free to differ.
//        Any other target — another path on the same allowlisted host, another
//        frozen method, an added/removed/changed parameter, a fragment, an encoded
//        path escape — is refused BEFORE the target is contacted. The 3-hop
//        ceiling is unchanged.
//
// Every transport is an injected stub. No provider is contacted, and every stub
// records the URLs it was handed so "refused before transport" is proven by the
// absence of a call, not by inspection of the implementation.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { contactRoute, ContactRefusal } from '../acquisition/contact.js';
import { ROUTES, matchRoute, assertAuthorizedRouteUrl, assertUrlStructure, RouteRefusal } from '../acquisition/routes.js';
import { redactUrl } from '../acquisition/guards.js';

const USGS = 'usgs-nwis-site-metadata';
const COOPS = 'noaa-coops-station-metadata';
const NDBC = 'noaa-ndbc-station-metadata';
const EIA = 'eia-electricity-demand-count';

const USGS_PARAMS = Object.freeze({ sites: '01646500' });
const COOPS_PARAMS = Object.freeze({ station: '9414290' });

const RDB_BODY = ['# comment', 'agency_cd\tsite_no\tbegin_date\tend_date', 'USGS\t01646500\t1930-01-01\t2026-01-01', ''].join('\n');

/** The URL `matchRoute` builds for a route — the authorized request itself. */
const authorizedUrl = (routeId, params) => matchRoute(routeId, params).url;

/**
 * A scripted transport: `steps[i]` answers the i-th request. Each step is
 * `{ status?, contentType?, location?, body? }`, or `{ throws }`. Every requested
 * URL is pushed to `calls`, and running past the end of the script fails the test.
 */
function scriptedTransport(steps, calls, { bodyReadTripwire = false } = {}) {
  let i = 0;
  return async (url) => {
    calls.push(url);
    assert.ok(i < steps.length, `transport called ${i + 1} time(s) but only ${steps.length} step(s) were scripted (last url: ${url})`);
    const step = steps[i++];
    if (step.throws) throw new Error(step.throws);
    const headers = { 'content-type': step.contentType ?? null, location: step.location ?? null };
    return {
      status: step.status ?? 200,
      headers: { get: (h) => headers[h.toLowerCase()] ?? null },
      arrayBuffer: async () => {
        if (bodyReadTripwire) assert.fail('the response body must not be read on a non-success final status');
        return Buffer.from(step.body ?? '', 'utf8');
      },
      body: null,
    };
  };
}

// ─── C-5: a non-success final status is an evidenced refusal, not a contact ────

const NON_SUCCESS = [400, 401, 403, 404, 410, 418, 429, 500, 502, 503, 504];

for (const status of NON_SUCCESS) {
  test(`C-5: a final HTTP ${status} is refused as http_error carrying its real status`, async () => {
    const calls = [];
    let caught;
    try {
      await contactRoute(USGS, USGS_PARAMS, {
        fetchImpl: scriptedTransport([{ status, contentType: 'text/html', body: '<html>error</html>' }], calls, { bodyReadTripwire: true }),
        env: {},
      });
    } catch (e) { caught = e; }
    assert.ok(caught instanceof ContactRefusal, `expected a ContactRefusal, got ${caught}`);
    assert.equal(caught.outcome_class, 'http_error', 'a stable reason code, distinct from timeout / redirect_refused');
    assert.equal(caught.http_status, status, 'the ACTUAL status is carried, never a fabricated one');
    assert.ok(caught.url_redacted.startsWith('https://'), 'the refusal carries redacted route information');
    assert.equal(calls.length, 1, 'one attempt, no retry');
  });
}

test('C-5: the body of a non-success response is never read (tripwire on arrayBuffer)', async () => {
  // `bodyReadTripwire` fails the test if the body is ever read — the guard and the
  // extractor are downstream of that read, so neither can be reached either.
  const calls = [];
  await assert.rejects(
    () => contactRoute(USGS, USGS_PARAMS, {
      fetchImpl: scriptedTransport([{ status: 503, contentType: 'text/plain', body: RDB_BODY }], calls, { bodyReadTripwire: true }),
      env: {},
    }),
    ContactRefusal,
  );
  assert.equal(calls.length, 1);
});

test('C-5: a 503 whose body WOULD satisfy the declaration is still refused (status is adjudicated)', async () => {
  // The reviewed C-5 reproduction: before this correction the same response
  // recorded `outcome_class: ok` and proceeded to extraction and provenance.
  const calls = [];
  let caught;
  try {
    await contactRoute(USGS, USGS_PARAMS, { fetchImpl: scriptedTransport([{ status: 503, contentType: 'text/plain', body: RDB_BODY }], calls), env: {} });
  } catch (e) { caught = e; }
  assert.ok(caught instanceof ContactRefusal);
  assert.equal(caught.outcome_class, 'http_error');
  assert.equal(caught.http_status, 503);
});

test('C-5: 2xx behaviour is unchanged — the body is read, guarded and returned', async () => {
  for (const status of [200, 201, 204, 299]) {
    const calls = [];
    const r = await contactRoute(USGS, USGS_PARAMS, { fetchImpl: scriptedTransport([{ status, contentType: 'text/plain', body: RDB_BODY }], calls), env: {} });
    assert.equal(r.status, status);
    assert.equal(r.contentType, 'text/plain');
    assert.equal(r.bodyBuffer.toString('utf8'), RDB_BODY);
    assert.equal(r.truncated, false);
    assert.equal(r.hops, 0);
  }
});

test('C-5: 3xx keeps its distinct redirect handling and never becomes http_error', async () => {
  const calls = [];
  let caught;
  try {
    await contactRoute(USGS, USGS_PARAMS, {
      fetchImpl: scriptedTransport([{ status: 302, location: 'https://evil.example.com/nwis/site/' }], calls),
      env: {},
    });
  } catch (e) { caught = e; }
  assert.ok(caught instanceof ContactRefusal);
  assert.equal(caught.outcome_class, 'redirect_refused', 'a redirect is adjudicated as a redirect, not as a status error');
  assert.equal(caught.http_status, null, 'no FINAL response existed — the status is never fabricated');
  assert.ok(!calls.some(u => u.includes('evil.example.com')));
});

test('C-5: a 3xx with no Location header remains a redirect refusal, not an http_error', async () => {
  const calls = [];
  let caught;
  try {
    await contactRoute(USGS, USGS_PARAMS, { fetchImpl: scriptedTransport([{ status: 301 }], calls), env: {} });
  } catch (e) { caught = e; }
  assert.ok(caught instanceof ContactRefusal);
  assert.equal(caught.outcome_class, 'redirect_refused');
});

test('C-5: the http_error refusal carries no credential and no response content', async () => {
  const PLANTED = 'PLANTED_SECRET_XYZ_789';
  const SECRET_BODY = 'S3CRET-BODY-TOKEN';
  const calls = [];
  let caught;
  try {
    await contactRoute(EIA, { period_of_record_start: '2015-01-01' }, {
      fetchImpl: scriptedTransport([{ status: 500, contentType: 'application/json', body: SECRET_BODY }], calls),
      env: { FORGE_EIA_API_KEY: PLANTED },
    });
  } catch (e) { caught = e; }
  assert.ok(caught instanceof ContactRefusal);
  assert.equal(caught.http_status, 500);
  assert.ok(!caught.message.includes(PLANTED), 'no credential in the refusal message');
  assert.ok(!caught.message.includes(SECRET_BODY), 'no response content in the refusal message');
  assert.ok(!caught.url_redacted.includes(PLANTED), 'no credential in the recorded route');
  assert.match(caught.url_redacted, /api_key=REDACTED/);
});

// ─── C-6: a redirect is bound to the exact authorized route ───────────────────

/** The authorized USGS request, with its query parameters emitted in another order. */
function reorderedUsgsUrl() {
  const u = new URL(authorizedUrl(USGS, USGS_PARAMS));
  const pairs = [...u.searchParams].reverse();
  const out = new URL(`${u.protocol}//${u.host}${u.pathname}`);
  for (const [k, v] of pairs) out.searchParams.append(k, v);
  return out.toString();
}

test('C-6: a redirect to the IDENTICAL authorized route is followed and succeeds', async () => {
  const calls = [];
  const target = authorizedUrl(USGS, USGS_PARAMS);
  const r = await contactRoute(USGS, USGS_PARAMS, {
    fetchImpl: scriptedTransport([
      { status: 302, location: target },
      { status: 200, contentType: 'text/plain', body: RDB_BODY },
    ], calls),
    env: {},
  });
  assert.equal(r.status, 200);
  assert.equal(r.hops, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], target);
});

test('C-6: harmless query REORDERING does not create a false refusal', async () => {
  const reordered = reorderedUsgsUrl();
  assert.notEqual(reordered, authorizedUrl(USGS, USGS_PARAMS), 'the probe really is a different byte string');
  const calls = [];
  const r = await contactRoute(USGS, USGS_PARAMS, {
    fetchImpl: scriptedTransport([
      { status: 301, location: reordered },
      { status: 200, contentType: 'text/plain', body: RDB_BODY },
    ], calls),
    env: {},
  });
  assert.equal(r.status, 200, 'a reordered query string is the same authorized request');
  assert.equal(calls[1], reordered);
});

/**
 * Redirect targets that leave the exact authorized scope. Each is refused BEFORE the
 * target is contacted; the assertion below proves the transport saw exactly one call
 * (the original request) and never the target.
 */
const OUT_OF_SCOPE_REDIRECTS = [
  {
    label: 'another path on the SAME allowlisted host',
    route: COOPS, params: COOPS_PARAMS,
    location: 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_level&station=9414290',
  },
  {
    label: 'a changed station (path-placeholder) value',
    route: COOPS, params: COOPS_PARAMS,
    location: 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/8454000/details.json?units=metric',
  },
  {
    label: 'a changed site (query) value',
    route: USGS, params: USGS_PARAMS,
    location: 'https://waterservices.usgs.gov/nwis/site/?format=rdb&sites=09380000&seriesCatalogOutput=true&siteStatus=all',
  },
  {
    label: 'an ADDED query parameter',
    route: USGS, params: USGS_PARAMS,
    location: 'https://waterservices.usgs.gov/nwis/site/?format=rdb&sites=01646500&seriesCatalogOutput=true&siteStatus=all&period=P7D',
  },
  {
    label: 'a REMOVED query parameter',
    route: USGS, params: USGS_PARAMS,
    location: 'https://waterservices.usgs.gov/nwis/site/?format=rdb&sites=01646500&seriesCatalogOutput=true',
  },
  {
    label: 'a fragment appended to the authorized route',
    route: USGS, params: USGS_PARAMS,
    location: 'https://waterservices.usgs.gov/nwis/site/?format=rdb&sites=01646500&seriesCatalogOutput=true&siteStatus=all#values',
  },
  {
    label: 'an encoded path escape',
    route: COOPS, params: COOPS_PARAMS,
    location: 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9414290/%2e%2e/%2e%2e/datagetter?units=metric',
  },
  {
    label: 'a sibling path segment',
    route: COOPS, params: COOPS_PARAMS,
    location: 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9414290/details.json/extra?units=metric',
  },
  {
    label: 'ANOTHER frozen method on another allowlisted host',
    route: USGS, params: USGS_PARAMS,
    location: 'https://www.ndbc.noaa.gov/data/stations/station_table.txt',
  },
  {
    label: 'another frozen method reached by a relative Location',
    route: COOPS, params: COOPS_PARAMS,
    location: '/mdapi/prod/webapi/stations.json?units=metric',
  },
  {
    label: 'the site root of the authorized host',
    route: USGS, params: USGS_PARAMS,
    location: 'https://waterservices.usgs.gov/',
  },
  {
    label: 'a DUPLICATED query parameter',
    route: USGS, params: USGS_PARAMS,
    location: 'https://waterservices.usgs.gov/nwis/site/?format=rdb&sites=01646500&sites=09380000&seriesCatalogOutput=true&siteStatus=all',
  },
  {
    label: 'a case-changed parameter NAME',
    route: USGS, params: USGS_PARAMS,
    location: 'https://waterservices.usgs.gov/nwis/site/?FORMAT=rdb&sites=01646500&seriesCatalogOutput=true&siteStatus=all',
  },
  {
    label: 'a case-changed parameter VALUE',
    route: USGS, params: USGS_PARAMS,
    location: 'https://waterservices.usgs.gov/nwis/site/?format=RDB&sites=01646500&seriesCatalogOutput=true&siteStatus=all',
  },
  {
    label: 'an empty-valued added parameter',
    route: USGS, params: USGS_PARAMS,
    location: 'https://waterservices.usgs.gov/nwis/site/?format=rdb&sites=01646500&seriesCatalogOutput=true&siteStatus=all&x=',
  },
  {
    label: 'a bare trailing fragment delimiter',
    route: USGS, params: USGS_PARAMS,
    location: 'https://waterservices.usgs.gov/nwis/site/?format=rdb&sites=01646500&seriesCatalogOutput=true&siteStatus=all#',
  },
  {
    label: 'a double-slash path',
    route: USGS, params: USGS_PARAMS,
    location: 'https://waterservices.usgs.gov//nwis/site/?format=rdb&sites=01646500&seriesCatalogOutput=true&siteStatus=all',
  },
  {
    label: 'a trailing-slash path drift',
    route: USGS, params: USGS_PARAMS,
    location: 'https://waterservices.usgs.gov/nwis/site?format=rdb&sites=01646500&seriesCatalogOutput=true&siteStatus=all',
  },
];

for (const { label, route, params, location } of OUT_OF_SCOPE_REDIRECTS) {
  test(`C-6: a redirect to ${label} is refused BEFORE the target is contacted`, async () => {
    const calls = [];
    let caught;
    try {
      await contactRoute(route, params, { fetchImpl: scriptedTransport([{ status: 302, location }], calls), env: {} });
    } catch (e) { caught = e; }
    assert.ok(caught instanceof ContactRefusal, `expected a ContactRefusal, got ${caught}`);
    assert.equal(caught.outcome_class, 'redirect_refused');
    assert.equal(calls.length, 1, 'exactly the original request — the refused target received no transport');
    assert.equal(calls[0], authorizedUrl(route, params));
  });
}

test('C-6 non-vacuity: every out-of-scope probe passes the host allowlist it must not rely on', () => {
  // If these targets were only host-checked (the pre-correction behaviour), all but
  // the deliberately-foreign ones would have been FOLLOWED. This asserts the probes
  // are genuinely hostile rather than caught by the pre-existing G8 host gate.
  const hosts = new Set(Object.values(ROUTES).map(r => r.host));
  for (const { label, route, params, location } of OUT_OF_SCOPE_REDIRECTS) {
    const resolved = new URL(location, authorizedUrl(route, params));
    assert.equal(resolved.protocol, 'https:', `${label}: https`);
    assert.ok(hosts.has(resolved.host), `${label}: the target host IS allowlisted — only the exact-route binding can refuse it`);
  }
});

test('C-6: only MECHANICALLY IRRELEVANT differences are followed, and they resolve to the same wire request', async () => {
  // Each of these serializes back to the authorized request byte-for-byte under
  // WHATWG URL normalization: an ASCII-case-insensitive host, the default https
  // port, a percent-encoding of the SAME parameter value, dot segments that
  // resolve onto the authorized path, and query order. They are followed
  // deliberately — the assertion pins that the request actually sent is the
  // authorized one, not merely that the target was accepted.
  const authorized = authorizedUrl(USGS, USGS_PARAMS);
  const IRRELEVANT = [
    ['an ASCII-case-differing host', 'https://WATERSERVICES.USGS.GOV/nwis/site/?format=rdb&sites=01646500&seriesCatalogOutput=true&siteStatus=all'],
    ['the explicit default :443 port', 'https://waterservices.usgs.gov:443/nwis/site/?format=rdb&sites=01646500&seriesCatalogOutput=true&siteStatus=all'],
    ['a percent-encoding of the same value', 'https://waterservices.usgs.gov/nwis/site/?format=%72db&sites=01646500&seriesCatalogOutput=true&siteStatus=all'],
    ['dot segments that resolve onto the authorized path', 'https://waterservices.usgs.gov/nwis/x/../site/?format=rdb&sites=01646500&seriesCatalogOutput=true&siteStatus=all'],
    ['query order', reorderedUsgsUrl()],
  ];
  for (const [label, location] of IRRELEVANT) {
    const calls = [];
    const r = await contactRoute(USGS, USGS_PARAMS, {
      fetchImpl: scriptedTransport([{ status: 302, location }, { status: 200, contentType: 'text/plain', body: RDB_BODY }], calls),
      env: {},
    });
    assert.equal(r.status, 200, label);
    const sent = new URL(calls[1]);
    const want = new URL(authorized);
    assert.equal(sent.protocol, want.protocol, `${label}: same scheme on the wire`);
    assert.equal(sent.host, want.host, `${label}: same host on the wire`);
    assert.equal(sent.pathname, want.pathname, `${label}: same path on the wire`);
    assert.equal(sent.hash, '', `${label}: no fragment on the wire`);
    assert.deepEqual([...sent.searchParams].map(p => p.join('=')).sort(), [...want.searchParams].map(p => p.join('=')).sort(), `${label}: same parameters on the wire`);
  }
});

test('C-6: a non-https, off-allowlist, ported or userinfo-spoofed redirect is refused by the host gates', async () => {
  for (const location of [
    'http://waterservices.usgs.gov/nwis/site/?format=rdb&sites=01646500&seriesCatalogOutput=true&siteStatus=all',
    'https://evil.example.com/nwis/site/',
    'https://waterservices.usgs.gov:8443/nwis/site/?format=rdb&sites=01646500&seriesCatalogOutput=true&siteStatus=all',
    'https://waterservices.usgs.gov@evil.example.com/nwis/site/?format=rdb&sites=01646500&seriesCatalogOutput=true&siteStatus=all',
    'https://xn--waterservices-usgs.gov/nwis/site/?format=rdb&sites=01646500&seriesCatalogOutput=true&siteStatus=all',
  ]) {
    const calls = [];
    await assert.rejects(
      () => contactRoute(USGS, USGS_PARAMS, { fetchImpl: scriptedTransport([{ status: 307, location }], calls), env: {} }),
      (e) => e instanceof ContactRefusal && e.outcome_class === 'redirect_refused',
    );
    assert.equal(calls.length, 1);
  }
});

test('C-6: the 3-hop redirect ceiling is preserved', async () => {
  const target = authorizedUrl(USGS, USGS_PARAMS);
  const calls = [];
  let caught;
  try {
    await contactRoute(USGS, USGS_PARAMS, {
      fetchImpl: scriptedTransport(Array.from({ length: 4 }, () => ({ status: 302, location: target })), calls),
      env: {},
    });
  } catch (e) { caught = e; }
  assert.ok(caught instanceof ContactRefusal);
  assert.equal(caught.outcome_class, 'redirect_refused');
  assert.match(caught.message, /exceeded 3 redirect hops/);
  assert.equal(calls.length, 4, 'three hops were followed, the fourth was refused before transport');
});

test('C-6: a redirect refusal on the credentialed route leaks no key', async () => {
  const PLANTED = 'PLANTED_SECRET_XYZ_789';
  const calls = [];
  let caught;
  try {
    await contactRoute(EIA, { period_of_record_start: '2015-01-01' }, {
      fetchImpl: scriptedTransport([{ status: 302, location: 'https://api.eia.gov/v2/electricity/rto/region-data/data/?frequency=hourly&data[0]=value&start=2015-01-01&length=5000&api_key=' + PLANTED }], calls),
      env: { FORGE_EIA_API_KEY: PLANTED },
    });
  } catch (e) { caught = e; }
  assert.ok(caught instanceof ContactRefusal);
  assert.equal(caught.outcome_class, 'redirect_refused');
  assert.ok(!caught.message.includes(PLANTED), 'the refusal names differing parameter KEYS, never a value');
  assert.match(caught.message, /changed \[length\]/, 'the changed parameter is named by key');
  assert.equal(calls.length, 1);
});

// ─── The route-authority primitive itself (unit level, one interpretation) ─────

test('C-6: assertAuthorizedRouteUrl accepts the authorized URL and a reordered query', () => {
  const authorized = authorizedUrl(USGS, USGS_PARAMS);
  assert.doesNotThrow(() => assertAuthorizedRouteUrl(USGS, authorized, authorized));
  assert.doesNotThrow(() => assertAuthorizedRouteUrl(USGS, reorderedUsgsUrl(), authorized));
});

test('C-6: assertAuthorizedRouteUrl refuses scheme, host, path, fragment and parameter drift', () => {
  const authorized = authorizedUrl(USGS, USGS_PARAMS);
  const cases = [
    ['http://waterservices.usgs.gov/nwis/site/?format=rdb&sites=01646500&seriesCatalogOutput=true&siteStatus=all', /is not the allowlisted "https:"/],
    ['https://evil.example.com/nwis/site/?format=rdb&sites=01646500&seriesCatalogOutput=true&siteStatus=all', /not the allowlisted host/],
    ['https://waterservices.usgs.gov/nwis/iv/?format=rdb&sites=01646500&seriesCatalogOutput=true&siteStatus=all', /path normalizes to/],
    [`${authorized}#frag`, /carries a fragment/],
    [`${authorized}&extra=1`, /added \[extra\]/],
    ['https://waterservices.usgs.gov/nwis/site/?format=rdb&sites=01646500&seriesCatalogOutput=true', /removed \[siteStatus\]/],
    ['https://waterservices.usgs.gov/nwis/site/?format=json&sites=01646500&seriesCatalogOutput=true&siteStatus=all', /changed \[format\]/],
    ['not-a-url', /not parseable/],
  ];
  for (const [url, expected] of cases) {
    assert.throws(() => assertAuthorizedRouteUrl(USGS, url, authorized), expected, `expected refusal for ${url}`);
  }
  assert.throws(() => assertAuthorizedRouteUrl('not-a-route', authorized, authorized), RouteRefusal);
});

test('C-6: a paramless frozen route binds exactly as strictly', () => {
  const authorized = authorizedUrl(NDBC);
  assert.doesNotThrow(() => assertAuthorizedRouteUrl(NDBC, authorized, authorized));
  assert.throws(() => assertAuthorizedRouteUrl(NDBC, `${authorized}?x=1`, authorized), /added \[x\]/);
  assert.throws(() => assertAuthorizedRouteUrl(NDBC, 'https://www.ndbc.noaa.gov/data/stations/', authorized), /path normalizes to/);
});

// ─── R-1: URL userinfo is never an authorized route ───────────────────────────
//
// `assertUrlStructure` examined scheme, host, path and fragment but NOT the URL's
// userinfo component, so a redirect to
// `https://<provider-chosen-userinfo>@<authorized-host><authorized-path>?<authorized-params>`
// was FOLLOWED: the second request went out carrying credentials the operator never
// authorized, and the provider-controlled string was written verbatim into the
// contact log's `url_redacted` on the SUCCESS path
// (21-cycle-005-pre-g0-c1-c5-c6-correction-review.md §4.3 / §5 R-1).
//
// The check now lives in `assertUrlStructure` itself — the one structural primitive
// `matchRoute` applies at construction and `assertAuthorizedRouteUrl` applies to every
// redirect hop — so both paths share one interpretation. A userinfo value is never
// echoed into a refusal, and `redactUrl` strips userinfo independently.

/** A conspicuous provider-controlled token; it must appear in NO message. */
const USERINFO_TOKEN = 'provider-controlled-token-ABCDEF';

/** The userinfo shapes a provider could put on an otherwise-authorized redirect. */
const USERINFO_SHAPES = [
  ['username and password', `${USERINFO_TOKEN}:pw@`, ['username', 'password']],
  ['username only', `${USERINFO_TOKEN}@`, ['username']],
  ['password only', `:${USERINFO_TOKEN}@`, ['password']],
  ['percent-encoded username', `%70%72%6f%76-${USERINFO_TOKEN}@`, ['username']],
  ['an encoded @ inside the username', `${USERINFO_TOKEN}%40x:pw@`, ['username', 'password']],
  ['a second @ inside the userinfo', `${USERINFO_TOKEN}:pw@@`, ['username', 'password']],
];

for (const [label, userinfo, expected] of USERINFO_SHAPES) {
  test(`R-1: a SAME-HOST redirect carrying ${label} is refused before transport`, async () => {
    const authorized = authorizedUrl(USGS, USGS_PARAMS);
    const location = authorized.replace('https://', `https://${userinfo}`);
    const calls = [];
    let caught;
    try {
      await contactRoute(USGS, USGS_PARAMS, {
        // Step 2 is scripted but must never run: reaching it would mean the userinfo
        // target was contacted. Running past the script end fails the test as well.
        fetchImpl: scriptedTransport([{ status: 302, location }, { status: 200, contentType: 'text/plain', body: RDB_BODY }], calls),
        env: {},
      });
    } catch (e) { caught = e; }
    assert.ok(caught instanceof ContactRefusal, `expected a ContactRefusal, got ${caught}`);
    assert.equal(caught.outcome_class, 'redirect_refused');
    assert.equal(calls.length, 1, 'the userinfo target was NEVER contacted');
    assert.match(caught.message, /carries URL userinfo/, 'the refusal names the userinfo component');
    for (const component of expected) {
      assert.ok(caught.message.includes(component), `${label}: the refusal names the "${component}" component structurally`);
    }
    assert.ok(!caught.message.includes(USERINFO_TOKEN), `${label}: no userinfo VALUE is echoed into the refusal`);
    assert.ok(!caught.message.includes('%70%72%6f%76'), `${label}: not even an encoded userinfo value is echoed`);
  });
}

test('R-1: userinfo is refused on a LATER hop too — the hop budget is not a way past it', async () => {
  const authorized = authorizedUrl(USGS, USGS_PARAMS);
  const calls = [];
  let caught;
  try {
    await contactRoute(USGS, USGS_PARAMS, {
      fetchImpl: scriptedTransport([
        { status: 302, location: authorized },                                                   // hop 1: a lawful re-serve
        { status: 302, location: authorized.replace('https://', `https://${USERINFO_TOKEN}@`) },  // hop 2: userinfo
        { status: 200, contentType: 'text/plain', body: RDB_BODY },
      ], calls),
      env: {},
    });
  } catch (e) { caught = e; }
  assert.ok(caught instanceof ContactRefusal);
  assert.equal(caught.outcome_class, 'redirect_refused');
  assert.match(caught.message, /carries URL userinfo/);
  assert.equal(calls.length, 2, 'the lawful hop was followed; the userinfo hop was not contacted');
  assert.ok(!caught.message.includes(USERINFO_TOKEN));
});

test('R-1: on the credentialed route, userinfo is refused and the planted key never leaks', async () => {
  const PLANTED = 'PLANTED-EIA-KEY-9999';
  const params = { period_of_record_start: '2019-01-01T00' };
  const authorized = matchRoute(EIA, { ...params, api_key: PLANTED }).url;
  const calls = [];
  let caught;
  try {
    await contactRoute(EIA, params, {
      fetchImpl: scriptedTransport([{ status: 307, location: authorized.replace('https://', `https://${USERINFO_TOKEN}:pw@`) }], calls),
      env: { FORGE_EIA_API_KEY: PLANTED },
    });
  } catch (e) { caught = e; }
  assert.ok(caught instanceof ContactRefusal);
  assert.equal(caught.outcome_class, 'redirect_refused');
  assert.equal(calls.length, 1);
  assert.ok(!caught.message.includes(PLANTED), 'the credential never enters the refusal message');
  assert.ok(!caught.message.includes(USERINFO_TOKEN), 'the userinfo value never enters the refusal message');
});

test('R-1: an EMPTY userinfo delimiter carries no credentials and is the authorized request on the wire', async () => {
  // WHATWG: a URL "includes credentials" only when username or password is non-empty.
  // `https://@host/p` has neither — the serializer drops the delimiter, so the bytes
  // reaching the wire are byte-identical to the authorized request. This is the same
  // inert class as an explicit `:443` or a dot segment (§4.1), NOT an unchecked
  // userinfo path: the assertions below prove the request carries no credentials and
  // that nothing resembling userinfo reaches the evidence.
  const authorized = authorizedUrl(USGS, USGS_PARAMS);
  for (const delimiter of ['@', ':@']) {
    const calls = [];
    const r = await contactRoute(USGS, USGS_PARAMS, {
      fetchImpl: scriptedTransport([
        { status: 302, location: authorized.replace('https://', `https://${delimiter}`) },
        { status: 200, contentType: 'text/plain', body: RDB_BODY },
      ], calls),
      env: {},
    });
    assert.equal(r.status, 200, delimiter);
    assert.equal(calls[1], authorized, `${delimiter}: the second request is BYTE-IDENTICAL to the authorized URL`);
    const sent = new URL(calls[1]);
    assert.equal(sent.username, '', `${delimiter}: no username reaches the wire`);
    assert.equal(sent.password, '', `${delimiter}: no password reaches the wire`);
    assert.ok(!r.url_redacted.includes('@'), `${delimiter}: no userinfo delimiter reaches the evidence`);
  }
});

test('R-1: redactUrl strips userinfo, and leaves an @ that is not userinfo alone', () => {
  const authorized = authorizedUrl(USGS, USGS_PARAMS);
  const red = redactUrl(authorized.replace('https://', `https://${USERINFO_TOKEN}:pw@`));
  assert.ok(!red.includes(USERINFO_TOKEN), 'the username is redacted out');
  assert.ok(!red.includes(':pw@'), 'the password is redacted out');
  assert.match(red, /^https:\/\/REDACTED@waterservices\.usgs\.gov\/nwis\/site\//, 'the delimiter is kept so an auditor sees userinfo WAS present');
  assert.equal(redactUrl(authorized), authorized, 'an authorized URL is unchanged');
  assert.equal(
    redactUrl('https://waterservices.usgs.gov/nwis/si@te/?q=a@b'),
    'https://waterservices.usgs.gov/nwis/si@te/?q=a@b',
    'an @ in the path or the query is not userinfo and is not touched',
  );
  // Applied to a whole message string, both redaction classes still hold.
  const msg = redactUrl(`ContactRefusal: transport error contacting https://${USERINFO_TOKEN}@api.eia.gov/v2/?api_key=SEKRET: boom`);
  assert.ok(!msg.includes(USERINFO_TOKEN) && !msg.includes('SEKRET'), 'neither userinfo nor a credential param survives in a message');
});

test('R-1: the route-authority primitive refuses userinfo on the CONSTRUCTION path as well', () => {
  const authorized = authorizedUrl(USGS, USGS_PARAMS);
  const route = ROUTES[USGS];
  // `assertUrlStructure` is what `matchRoute` calls on the URL it has just built, so a
  // userinfo-bearing URL is unconstructable, not merely unfollowable.
  for (const userinfo of [`${USERINFO_TOKEN}:pw@`, `${USERINFO_TOKEN}@`, `:${USERINFO_TOKEN}@`]) {
    const url = authorized.replace('https://', `https://${userinfo}`);
    assert.throws(() => assertUrlStructure(USGS, url, route, '/nwis/site/'), RouteRefusal, `construction path refuses ${userinfo}`);
    assert.throws(() => assertUrlStructure(USGS, url, route, '/nwis/site/'), /carries URL userinfo/);
    assert.throws(() => assertAuthorizedRouteUrl(USGS, url, authorized), /carries URL userinfo/, `redirect path refuses ${userinfo}`);
  }
  // …and an authorized URL still passes both primitives unchanged.
  assert.doesNotThrow(() => assertUrlStructure(USGS, authorized, route, '/nwis/site/'));
  assert.doesNotThrow(() => assertAuthorizedRouteUrl(USGS, authorized, authorized));
});

test('R-1: userinfo is refused for EVERY frozen route, paramless and path-placeholder alike', () => {
  for (const [routeId, params] of [[USGS, USGS_PARAMS], [COOPS, COOPS_PARAMS], [NDBC, undefined]]) {
    const authorized = authorizedUrl(routeId, params);
    const url = authorized.replace('https://', `https://${USERINFO_TOKEN}:pw@`);
    assert.throws(() => assertAuthorizedRouteUrl(routeId, url, authorized), /carries URL userinfo/, routeId);
  }
});
