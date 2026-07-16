/**
 * lab/acquisition/guards.js
 *
 * Cycle-005 S01 (PRD FR-B2/FR-B3, NFR-CONTAM-1..4, NFR-SEC; SDD DR-3 G2/G3/G4/G5;
 * Sprint Plan T1.2).
 *
 * The response-shape guard chain. Pure, deterministic, no network, no filesystem.
 * Every provider response is classified BEFORE any extraction into exactly one of
 * three outcomes (G2):
 *
 *   - `conformant`             matches the declared metadata-only shape → extract
 *   - `non_value_incompatible` differs from the declared shape but no value-bearing
 *                              rows/fields identified (wrong content-type, truncated,
 *                              malformed) → discarded unread, contact continues,
 *                              candidate trends class 3
 *   - `value_bearing`          contains — or the validator cannot rule out — rows/
 *                              fields beyond the declared metadata-only surface → a
 *                              contamination event (PRD class 4), NEVER discarded-
 *                              and-continued, NEVER downgraded to class 3
 *
 * An `indeterminate` structural outcome (the validator could not complete — size-cap
 * abort or a parse fault mid-classification) is treated IDENTICALLY to value_bearing
 * for the contamination procedure (fail-closed; NFR-HALT parity). Zero-raw-persistence
 * (G3) holds across all outcomes: this module never writes bytes anywhere, so
 * "went unpersisted" is never grounds to soften a value_bearing detection.
 *
 * @module lab/acquisition/guards
 */

/** The exact value-exposure statuses recorded on a contact-log line (DR-3 G2). */
export const VALUE_EXPOSURE = Object.freeze({
  NONE: 'none_detected',
  DETECTED: 'detected',
  INDETERMINATE: 'indeterminate',
});

/** The three-way (plus fail-closed indeterminate) guard outcomes. */
export const GUARD_OUTCOME = Object.freeze({
  CONFORMANT: 'conformant',
  NON_VALUE_INCOMPATIBLE: 'non_value_incompatible',
  VALUE_BEARING: 'value_bearing',
  INDETERMINATE: 'indeterminate',
});

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB (DR-3 G2 default size cap)

/**
 * Redact credentials from any URL-or-string that leaves `contact.js` (G4/NFR-SEC).
 * Every value of a sensitive query parameter is replaced with `REDACTED`. The set
 * covers the EIA `api_key` plus common credential param names; the replacement is
 * verbatim-length-independent so a planted key never survives into any artifact.
 *
 * @param {string} url
 * @param {ReadonlyArray<string>} [sensitiveParams]
 * @returns {string}
 */
export function redactUrl(url, sensitiveParams = ['api_key', 'apikey', 'token', 'key', 'access_token', 'secret']) {
  if (typeof url !== 'string') return url;
  const names = sensitiveParams.map(p => p.toLowerCase());
  // Replace `param=value` (value up to the next & or # or end) for any sensitive param.
  return url.replace(/([?&])([a-z0-9_\-]+)=([^&#]*)/gi, (m, sep, name, _val) => {
    return names.includes(name.toLowerCase()) ? `${sep}${name}=REDACTED` : m;
  });
}

// ─── Response declarations (the G2 metadata-only shape catalog) ────────────────
//
// Each declaration enumerates the COMPLETE expected metadata-only surface and a
// `classify(bodyText)` that returns { shape, reasons }. `shape` is one of the
// GUARD_OUTCOME values. A declaration NEVER declares a value/observation array as
// part of its conformant shape — a metadata surface has none by construction.

/** Parse helper: returns the parsed value or the sentinel {@link PARSE_FAIL}. */
const PARSE_FAIL = Symbol('parse-fail');
function tryJson(text) { try { return JSON.parse(text); } catch { return PARSE_FAIL; } }

/** Split a text body into non-empty lines (CSV/RDB/fixed-width row scans). */
function lines(text) { return text.split(/\r?\n/).filter(l => l.length > 0); }

/**
 * Generic value-bearing heuristic for tabular/text surfaces: a metadata/inventory
 * surface reports a SMALL, bounded set of rows (one per site/station, or a handful
 * of header+catalog lines). A large body of homogeneous rows carrying a datetime +
 * numeric value column is a value series. Fail-closed: any doubt returns
 * value_bearing / indeterminate rather than conformant.
 */
function textShape({ text, declaredHeaderTokens, maxInventoryRows, valueRowRe }) {
  const ls = lines(text);
  if (ls.length === 0) return { shape: GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, reasons: ['empty body'] };
  // A datetime+value observation pattern anywhere is a value series → contamination.
  const valueRows = valueRowRe ? ls.filter(l => valueRowRe.test(l)).length : 0;
  if (valueRows > 0) {
    return { shape: GUARD_OUTCOME.VALUE_BEARING, reasons: [`${valueRows} row(s) match an observation datetime+value pattern (value-bearing series)`] };
  }
  // The declared metadata header must be present (else this is not our surface).
  const headerPresent = declaredHeaderTokens.some(tok => text.includes(tok));
  if (!headerPresent) {
    return { shape: GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, reasons: ['declared metadata header tokens absent (wrong/foreign surface)'] };
  }
  // A metadata/inventory surface is bounded. An unexpectedly large row count for a
  // single-candidate request cannot be ruled out as value rows → fail-closed.
  if (ls.length > maxInventoryRows) {
    return { shape: GUARD_OUTCOME.INDETERMINATE, reasons: [`row count ${ls.length} exceeds the declared inventory bound ${maxInventoryRows}; cannot rule out value rows`] };
  }
  return { shape: GUARD_OUTCOME.CONFORMANT, reasons: [] };
}

/**
 * The response-declaration catalog, keyed by `decl_id` (referenced from
 * routes.js `response_decl`). `content_types` is the allowlist; `max_bytes` the
 * size cap; `classify` the structural validator.
 * @type {Readonly<Object<string, Object>>}
 */
export const RESPONSE_DECLS = Object.freeze({
  // EIA v2 envelope requested with length=0: the ONLY lawful body has an empty
  // `data` array and reports the aggregate `total`. A NON-EMPTY `data` array is the
  // "rows despite length=0" contamination case → value_bearing (never class 3).
  'eia-v2-envelope': Object.freeze({
    decl_id: 'eia-v2-envelope',
    format: 'json',
    content_types: Object.freeze(['application/json']),
    max_bytes: DEFAULT_MAX_BYTES,
    declared_fields: Object.freeze(['response.total']),
    classify(text) {
      const j = tryJson(text);
      if (j === PARSE_FAIL) return { shape: GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, reasons: ['malformed JSON'] };
      if (j === null || typeof j !== 'object') return { shape: GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, reasons: ['not a JSON object'] };
      const resp = j.response;
      if (resp === null || typeof resp !== 'object') {
        return { shape: GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, reasons: ['no response envelope'] };
      }
      // Any non-empty data array = value rows returned despite length=0 → contamination.
      if (Array.isArray(resp.data) && resp.data.length > 0) {
        return { shape: GUARD_OUTCOME.VALUE_BEARING, reasons: [`response.data carries ${resp.data.length} row(s) despite length=0 (value-bearing)`] };
      }
      // `data` present-and-non-array, or any other observation-shaped array, cannot
      // be cleared as metadata-only → fail-closed indeterminate.
      if ('data' in resp && !Array.isArray(resp.data)) {
        return { shape: GUARD_OUTCOME.INDETERMINATE, reasons: ['response.data present but not an array; cannot rule out value payload'] };
      }
      if (resp.total === undefined || resp.total === null) {
        return { shape: GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, reasons: ['response.total (aggregate count) absent'] };
      }
      return { shape: GUARD_OUTCOME.CONFORMANT, reasons: [] };
    },
  }),

  // NOAA CO-OPS Metadata API station details JSON: station identity + period
  // fields. A `data`/`predictions`/observations array is value-bearing.
  'noaa-coops-mdapi-json': Object.freeze({
    decl_id: 'noaa-coops-mdapi-json',
    format: 'json',
    content_types: Object.freeze(['application/json']),
    max_bytes: DEFAULT_MAX_BYTES,
    declared_fields: Object.freeze(['stations']),
    classify(text) {
      const j = tryJson(text);
      if (j === PARSE_FAIL) return { shape: GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, reasons: ['malformed JSON'] };
      if (j === null || typeof j !== 'object') return { shape: GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, reasons: ['not a JSON object'] };
      const VALUE_KEYS = ['data', 'predictions', 'observations', 'values', 'series'];
      for (const k of VALUE_KEYS) {
        if (Array.isArray(j[k]) && j[k].length > 0) {
          return { shape: GUARD_OUTCOME.VALUE_BEARING, reasons: [`value-bearing array "${k}" (${j[k].length} rows) present on a metadata surface`] };
        }
      }
      if (!Array.isArray(j.stations) && (j.station === undefined)) {
        return { shape: GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, reasons: ['no station metadata block'] };
      }
      return { shape: GUARD_OUTCOME.CONFORMANT, reasons: [] };
    },
  }),

  // USGS NWIS site service, RDB (tab-delimited) site catalog. Value-bearing when a
  // per-timestamp observation row appears (a datetime + numeric value pattern).
  'usgs-nwis-site-rdb': Object.freeze({
    decl_id: 'usgs-nwis-site-rdb',
    format: 'rdb',
    content_types: Object.freeze(['text/plain', 'text/rdb', 'application/octet-stream']),
    max_bytes: DEFAULT_MAX_BYTES,
    declared_fields: Object.freeze(['site_no', 'begin_date', 'end_date', 'count_nu']),
    classify(text) {
      return textShape({
        text,
        declaredHeaderTokens: ['site_no', 'agency_cd'],
        maxInventoryRows: 5000, // a site/series catalog for one request is bounded
        // A site CATALOG carries date-only begin/end; a per-timestamp datetime (with
        // TIME) is an observation/value row — the value-bearing signal (fail-closed).
        valueRowRe: /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/,
      });
    },
  }),

  // NOAA NDBC station table: whitespace-delimited station inventory. Value-bearing
  // when per-observation rows (datetime + reading) appear.
  'noaa-ndbc-station-table': Object.freeze({
    decl_id: 'noaa-ndbc-station-table',
    format: 'text',
    content_types: Object.freeze(['text/plain', 'application/octet-stream']),
    max_bytes: DEFAULT_MAX_BYTES,
    declared_fields: Object.freeze(['STATION_ID', 'LAT', 'LON']),
    classify(text) {
      return textShape({
        text,
        declaredHeaderTokens: ['STATION_ID', '#STATION_ID', 'station_id'],
        maxInventoryRows: 20000, // the full NDBC station list is large but bounded
        valueRowRe: /(^|\s)\d{4}\s+\d{2}\s+\d{2}\s+\d{2}\s+\d{2}\s+-?\d+(\.\d+)?/, // YYYY MM DD hh mm value
      });
    },
  }),

  // NWS/ISD station inventory CSV: period-of-record BEGIN/END columns. Value-bearing
  // when per-observation weather rows (datetime + reading) appear.
  'nws-isd-history-csv': Object.freeze({
    decl_id: 'nws-isd-history-csv',
    format: 'csv',
    content_types: Object.freeze(['text/csv', 'text/plain', 'application/octet-stream']),
    max_bytes: DEFAULT_MAX_BYTES,
    declared_fields: Object.freeze(['USAF', 'WBAN', 'BEGIN', 'END']),
    classify(text) {
      return textShape({
        text,
        declaredHeaderTokens: ['USAF', 'BEGIN', 'END'],
        maxInventoryRows: 100000, // isd-history is a large station inventory, still bounded
        valueRowRe: /,\s*\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}\s*,\s*-?\d+(\.\d+)?/, // ...,datetime,value
      });
    },
  }),
});

/**
 * Guard a provider response (G2). PURE — no I/O, no persistence (G3): the response
 * bytes exist only in the caller's memory and this function never writes them.
 *
 * @param {Object} decl - a {@link RESPONSE_DECLS} entry (or a shape-compatible test decl)
 * @param {{status:number, contentType:(string|null), bodyBuffer:Buffer, truncated?:boolean}} resp
 * @returns {{outcome:string, value_exposure_status:string, reasons:string[], guard_events:string[], parsed:(string|null)}}
 */
export function guardResponse(decl, resp) {
  const reasons = [];
  const guard_events = [];
  const done = (outcome, extraReasons = [], parsed = null) => {
    reasons.push(...extraReasons);
    const value_exposure_status =
      outcome === GUARD_OUTCOME.VALUE_BEARING ? VALUE_EXPOSURE.DETECTED
        : outcome === GUARD_OUTCOME.INDETERMINATE ? VALUE_EXPOSURE.INDETERMINATE
          : VALUE_EXPOSURE.NONE;
    guard_events.push(`g2:${outcome}`);
    return { outcome, value_exposure_status, reasons, guard_events, parsed };
  };

  if (decl === null || typeof decl !== 'object' || typeof decl.classify !== 'function') {
    // A missing/invalid declaration means the guard cannot clear the body → fail-closed.
    return done(GUARD_OUTCOME.INDETERMINATE, ['no valid response declaration; cannot classify (fail-closed)']);
  }
  if (resp === null || typeof resp !== 'object' || !Buffer.isBuffer(resp.bodyBuffer)) {
    return done(GUARD_OUTCOME.INDETERMINATE, ['response missing a byte body; cannot classify (fail-closed)']);
  }

  // Size-cap abort (streamed past the declared cap) → indeterminate (never conformant).
  if (resp.truncated === true) {
    return done(GUARD_OUTCOME.INDETERMINATE, [`body truncated at the ${decl.max_bytes ?? DEFAULT_MAX_BYTES}-byte cap; classification incomplete`]);
  }
  const maxBytes = decl.max_bytes ?? DEFAULT_MAX_BYTES;
  if (resp.bodyBuffer.length > maxBytes) {
    return done(GUARD_OUTCOME.INDETERMINATE, [`body ${resp.bodyBuffer.length} B exceeds cap ${maxBytes} B; classification incomplete`]);
  }

  // Content-type allowlist (a wrong content-type is a foreign, non-value surface).
  const baseType = typeof resp.contentType === 'string' ? resp.contentType.split(';')[0].trim().toLowerCase() : '';
  const allowed = Array.isArray(decl.content_types) ? decl.content_types.map(t => t.toLowerCase()) : [];
  if (allowed.length > 0 && !allowed.includes(baseType)) {
    return done(GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, [`content-type "${baseType || '(none)'}" not in the declared allowlist [${allowed.join(', ')}]`]);
  }

  // Structural validation. Any THROW mid-classification is indeterminate (fail-closed).
  let text;
  try {
    text = resp.bodyBuffer.toString('utf8');
  } catch (e) {
    return done(GUARD_OUTCOME.INDETERMINATE, [`body is not decodable UTF-8: ${e.message}`]);
  }
  let result;
  try {
    result = decl.classify(text);
  } catch (e) {
    return done(GUARD_OUTCOME.INDETERMINATE, [`structural validator threw mid-classification: ${e.message}`]);
  }
  if (result === null || typeof result !== 'object' || !Object.values(GUARD_OUTCOME).includes(result.shape)) {
    return done(GUARD_OUTCOME.INDETERMINATE, ['structural validator returned an unrecognized shape (fail-closed)']);
  }
  // On a conformant shape, hand the decoded text to extract.js — never the raw buffer.
  const parsed = result.shape === GUARD_OUTCOME.CONFORMANT ? text : null;
  return done(result.shape, result.reasons || [], parsed);
}
