/**
 * lab/acquisition/routes.js
 *
 * Cycle-005 S01 (PRD FR-B1/FR-B2/FR-B3; SDD DR-3 G1 + G6; Sprint Plan T1.2).
 *
 * The G1 route-template ALLOWLIST and the G6 earliest-period date-pinning
 * validator. This module is a PURE, frozen-at-Gate-A data table plus matcher —
 * no network, no filesystem, no eligibility/selection logic. It is the sole
 * authority on which URLs `contact.js` may ever construct: `contact.js` accepts
 * a route object + params, NEVER a raw URL string, so a URL outside this table
 * is structurally unconstructable (FR-B3 prevention-by-construction).
 *
 * Every template targets a documentation / metadata surface only (aggregate
 * counts, period-of-record, station inventory) — NEVER a value-bearing series
 * endpoint (FR-B2). The templates are planning-grade modern surfaces
 * (research report §4/§13); their exact host/path is confirmed and frozen at
 * Gate A, then sealed by the DR-2 acquisition manifest (any later edit breaks
 * the accepted identity, FR-A4).
 *
 * G6 (defense-in-depth ONLY): any template with a date/window parameter MUST
 * pin it to the candidate's documented period-of-record START — never "latest",
 * never a default-now. This narrows exposure likelihood for a well-behaved
 * provider toward the training region; it is NOT a bound on what a misbehaving
 * provider returns, and confers no downgrade of a G2 value-bearing detection.
 *
 * @module lab/acquisition/routes
 */

/**
 * A route class names the kind of surface a template targets. Only
 * documentation / metadata surfaces are ever declared; there is no
 * `value-series` route class anywhere in this table (FR-B2, by construction).
 * @type {ReadonlyArray<string>}
 */
export const ROUTE_CLASSES = Object.freeze(['metadata', 'inventory', 'series-metadata']);

/**
 * The frozen-at-Gate-A route templates, keyed by `method_id`. Each entry is a
 * pure data record:
 *   - `method_id`     stable id (referenced by the method set + extractors)
 *   - `candidate_rank` the frozen pool rank this route serves
 *   - `route_class`   one of {@link ROUTE_CLASSES}
 *   - `scheme`        always `"https"` (TLS-only; G8)
 *   - `host`          the allowlisted host (no other host is contactable)
 *   - `path_template` a `/`-path with optional `{param}` placeholders
 *   - `query_template` query params; a `{param}` value is substituted, a literal
 *                      is emitted verbatim; `null` value = param omitted
 *   - `response_decl` id of the guards.js response-shape declaration (G2)
 *   - `date_pinning`  G6: `{ param, semantics:"period-of-record-start" }` when the
 *                     surface accepts a date/window, else `null`
 *   - `credential`    env var name for a required key, or `null` (aggregate-only,
 *                     GET-only; the key is a query param redacted by G4)
 *
 * @type {Readonly<Object<string, Object>>}
 */
export const ROUTES = Object.freeze({
  // Rank 1 — USGS NWIS river stage/discharge: site-service metadata (period of
  // record columns), RDB text surface. No value-series contact.
  'usgs-nwis-site-metadata': Object.freeze({
    method_id: 'usgs-nwis-site-metadata',
    candidate_rank: 1,
    route_class: 'metadata',
    scheme: 'https',
    host: 'waterservices.usgs.gov',
    path_template: '/nwis/site/',
    query_template: Object.freeze({ format: 'rdb', sites: '{sites}', seriesCatalogOutput: 'true', siteStatus: 'all' }),
    response_decl: 'usgs-nwis-site-rdb',
    date_pinning: null, // site catalog reports begin/end dates itself; no window param requested
    credential: null,
  }),

  // Rank 2 — NOAA CO-OPS coastal water level: Metadata API station record.
  'noaa-coops-station-metadata': Object.freeze({
    method_id: 'noaa-coops-station-metadata',
    candidate_rank: 2,
    route_class: 'metadata',
    scheme: 'https',
    host: 'api.tidesandcurrents.noaa.gov',
    path_template: '/mdapi/prod/webapi/stations/{station}/details.json',
    query_template: Object.freeze({ units: 'metric' }),
    response_decl: 'noaa-coops-mdapi-json',
    date_pinning: null, // details surface carries established/period fields directly
    credential: null,
  }),

  // Rank 3 — NOAA NDBC buoy significant wave height: station metadata surface.
  'noaa-ndbc-station-metadata': Object.freeze({
    method_id: 'noaa-ndbc-station-metadata',
    candidate_rank: 3,
    route_class: 'metadata',
    scheme: 'https',
    host: 'www.ndbc.noaa.gov',
    path_template: '/data/stations/station_table.txt',
    query_template: Object.freeze({}),
    response_decl: 'noaa-ndbc-station-table',
    date_pinning: null, // station table is an inventory; no per-request window
    credential: null,
  }),

  // Rank 4 — NWS/ISD station weather: ISD station inventory CSV (period-of-record
  // BEGIN/END columns). Inventory surface, not a value series.
  'nws-isd-station-inventory': Object.freeze({
    method_id: 'nws-isd-station-inventory',
    candidate_rank: 4,
    route_class: 'inventory',
    scheme: 'https',
    host: 'www.ncei.noaa.gov',
    path_template: '/pub/data/noaa/isd-history.csv',
    query_template: Object.freeze({}),
    response_decl: 'nws-isd-history-csv',
    date_pinning: null, // whole-inventory CSV; period-of-record is per-row BEGIN/END
    credential: null,
  }),

  // Rank 5 — EIA hourly electricity demand: v2 data envelope requested with
  // length=0 so ONLY the aggregate `total` (row count) is returned, never rows.
  // G6 date pinning fixes `start` to the documented period-of-record start as a
  // defense-in-depth measure (it does NOT bound what a misbehaving endpoint
  // returns; a data row arriving despite length=0 is a G2 value-bearing event).
  'eia-electricity-demand-count': Object.freeze({
    method_id: 'eia-electricity-demand-count',
    candidate_rank: 5,
    route_class: 'series-metadata',
    scheme: 'https',
    host: 'api.eia.gov',
    path_template: '/v2/electricity/rto/region-data/data/',
    query_template: Object.freeze({
      frequency: 'hourly',
      'data[0]': 'value',
      start: '{period_of_record_start}',
      length: '0',
      api_key: '{api_key}',
    }),
    response_decl: 'eia-v2-envelope',
    date_pinning: Object.freeze({ param: 'start', semantics: 'period-of-record-start' }),
    credential: 'FORGE_EIA_API_KEY',
  }),
});

/** A route validation / matching failure — refused before any contact. */
export class RouteRefusal extends Error {
  constructor(message) { super(message); this.name = 'RouteRefusal'; }
}

/**
 * G6 validator: every template that targets a date/window-capable surface MUST
 * pin the window to the period-of-record START. A template that declares
 * `date_pinning` must (a) name a `param`, (b) declare
 * `semantics:"period-of-record-start"`, and (c) actually carry that param in its
 * `query_template` bound to the `{period_of_record_start}` placeholder. Throws
 * {@link RouteRefusal} on any breach. Returns `true` when the whole table is
 * lawfully date-pinned.
 */
export function assertDatePinning(routes = ROUTES) {
  for (const [id, r] of Object.entries(routes)) {
    if (r.date_pinning === null) continue;
    const dp = r.date_pinning;
    if (dp === null || typeof dp !== 'object') throw new RouteRefusal(`route ${id}: date_pinning must be an object or null`);
    if (typeof dp.param !== 'string' || dp.param.length === 0) throw new RouteRefusal(`route ${id}: date_pinning.param required`);
    if (dp.semantics !== 'period-of-record-start') throw new RouteRefusal(`route ${id}: date_pinning.semantics must be "period-of-record-start" (never "latest"/default-now)`);
    const q = r.query_template || {};
    if (!(dp.param in q)) throw new RouteRefusal(`route ${id}: date-pinned param "${dp.param}" absent from query_template`);
    if (q[dp.param] !== '{period_of_record_start}') {
      throw new RouteRefusal(`route ${id}: date-pinned param "${dp.param}" must bind {period_of_record_start} (got ${JSON.stringify(q[dp.param])})`);
    }
  }
  return true;
}

/** Substitute `{param}` placeholders in a template string from `params`. Throws on a missing param. */
function fill(template, params, ctx) {
  return template.replace(/\{([a-z0-9_]+)\}/gi, (_, key) => {
    if (!(key in params)) throw new RouteRefusal(`${ctx}: missing required param "${key}"`);
    const v = params[key];
    if (v === null || v === undefined || String(v).length === 0) throw new RouteRefusal(`${ctx}: param "${key}" must be a non-empty value`);
    return String(v);
  });
}

/**
 * Resolve a route id + params into a concrete request plan WITHOUT contacting
 * anything. Returns `{ method_id, route_class, url, scheme, host, credential,
 * response_decl }`. The `url` is built ONLY from the allowlisted template — there
 * is no code path that accepts a caller-supplied URL. Throws {@link RouteRefusal}
 * for an unknown id, a non-https scheme, a missing param, or (when the template
 * is date-pinned) an absent `period_of_record_start`.
 *
 * @param {string} routeId
 * @param {Object} [params]
 * @returns {{method_id:string, route_class:string, url:string, scheme:string, host:string, credential:(string|null), response_decl:string, date_pinning:(Object|null)}}
 */
export function matchRoute(routeId, params = {}) {
  const r = ROUTES[routeId];
  if (!r) throw new RouteRefusal(`unknown route id "${routeId}" (not in the Gate-A allowlist)`);
  if (r.scheme !== 'https') throw new RouteRefusal(`route ${routeId}: only https is permitted (G8 TLS-only)`);
  if (r.date_pinning && !('period_of_record_start' in params)) {
    throw new RouteRefusal(`route ${routeId}: date-pinned surface requires a period_of_record_start param (G6)`);
  }
  const path = fill(r.path_template, params, `route ${routeId} path`);
  const query = [];
  for (const [k, tmpl] of Object.entries(r.query_template || {})) {
    if (tmpl === null) continue;
    const value = fill(String(tmpl), params, `route ${routeId} query "${k}"`);
    query.push(`${encodeURIComponent(k)}=${encodeURIComponent(value)}`);
  }
  const qs = query.length ? `?${query.join('&')}` : '';
  const url = `${r.scheme}://${r.host}${path}${qs}`;
  return {
    method_id: r.method_id,
    route_class: r.route_class,
    url,
    scheme: r.scheme,
    host: r.host,
    credential: r.credential,
    response_decl: r.response_decl,
    date_pinning: r.date_pinning,
  };
}

/** True when `host` is the exact host of some allowlisted route (redirect re-check authority, G8). */
export function isAllowlistedHost(host) {
  for (const r of Object.values(ROUTES)) if (r.host === host) return true;
  return false;
}

/** The set of allowlisted hosts (for G8 redirect re-validation). */
export function allowlistedHosts() {
  return Object.freeze([...new Set(Object.values(ROUTES).map(r => r.host))]);
}

// Validate the date-pinning invariant at module load: an ill-formed table is a
// specification error surfaced immediately, never a silent contact-time surprise.
assertDatePinning(ROUTES);
