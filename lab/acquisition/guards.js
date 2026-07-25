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
 * for the contamination procedure (fail-closed; NFR-HALT parity). Every outcome also
 * carries a STABLE {@link GUARD_REASON} `reason_code` naming WHAT about the response
 * produced it (content-type, absent header, row bound, value rows …) so the recorded
 * evidence never attributes a rejection to an unexplained cause. Zero-raw-persistence
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

/**
 * STABLE machine reason codes: WHY the guard reached its outcome. The outcome says
 * what class the response is in; the code says what about the response put it there
 * — so a rejection is never recorded as an unexplained outcome (pre-G0 remediation
 * F3). Codes are part of the recorded evidence (`contact-log.jsonl.reason_code`) and
 * are therefore append-only in spirit: add, never re-purpose. They name STRUCTURE
 * only and never quote response content (G3).
 */
export const GUARD_REASON = Object.freeze({
  // Conformant.
  CONFORMANT: 'conformant',
  // Pre-structural (guardResponse itself).
  NO_DECLARATION: 'no_response_declaration',
  NO_BYTE_BODY: 'no_byte_body',
  TRUNCATED_AT_CAP: 'body_truncated_at_cap',
  EXCEEDS_CAP: 'body_exceeds_cap',
  CONTENT_TYPE_NOT_ALLOWLISTED: 'content_type_not_allowlisted',
  BODY_NOT_UTF8: 'body_not_utf8',
  VALIDATOR_THREW: 'validator_threw',
  VALIDATOR_SHAPE_UNRECOGNIZED: 'validator_returned_unrecognized_shape',
  // Structural (a declaration's own classifier).
  EMPTY_BODY: 'empty_body',
  OBSERVATION_ROWS_PRESENT: 'observation_rows_present',
  DECLARED_HEADER_ABSENT: 'declared_header_tokens_absent',
  ROW_COUNT_OVER_BOUND: 'row_count_exceeds_inventory_bound',
  MALFORMED_JSON: 'malformed_json',
  NOT_JSON_OBJECT: 'not_a_json_object',
  NO_RESPONSE_ENVELOPE: 'no_response_envelope',
  DATA_ROWS_DESPITE_LENGTH_ZERO: 'data_rows_despite_length_zero',
  DATA_PRESENT_NOT_ARRAY: 'data_present_not_array',
  AGGREGATE_TOTAL_ABSENT: 'aggregate_total_absent',
  VALUE_BEARING_ARRAY_PRESENT: 'value_bearing_array_present',
  NO_STATION_BLOCK: 'no_station_metadata_block',
  // A shape-compatible declaration that supplies no code of its own (fail-open on
  // the LABEL only — the outcome and the prose reasons are still authoritative).
  UNSPECIFIED: 'unspecified',
});

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB (DR-3 G2 default size cap)

/**
 * Redact credentials from any URL-or-string that leaves `contact.js` (G4/NFR-SEC).
 * Two classes are redacted:
 *
 *   - URL USERINFO (`scheme://<userinfo>@host…`) — the whole userinfo component is
 *     replaced, because every byte of it is a credential by definition. The `@`
 *     delimiter is KEPT so an auditor can still see that userinfo was present.
 *     `routes.js` refuses a userinfo-bearing URL before transport, so this is
 *     defence in depth: it guarantees that no provider- or caller-controlled
 *     userinfo can reach a refusal message, a log line or an evidence record even
 *     from a path that never consults the route primitive.
 *   - every value of a SENSITIVE QUERY PARAMETER, replaced with `REDACTED`. The set
 *     covers the EIA `api_key` plus common credential param names.
 *
 * Both replacements are verbatim-length-independent, so a planted secret never
 * survives into any artifact. Applied to whole message strings as well as bare
 * URLs, so the userinfo pattern is anchored on `scheme://` and stops at the first
 * `/`, `?`, `#` or whitespace — an `@` inside a path or a query value is untouched.
 *
 * @param {string} url
 * @param {ReadonlyArray<string>} [sensitiveParams]
 * @returns {string}
 */
export function redactUrl(url, sensitiveParams = ['api_key', 'apikey', 'token', 'key', 'access_token', 'secret']) {
  if (typeof url !== 'string') return url;
  const names = sensitiveParams.map(p => p.toLowerCase());
  return url
    // Userinfo: everything between `scheme://` and the LAST `@` of the authority.
    .replace(/([a-z][a-z0-9+.\-]*:\/\/)[^/?#\s]*@/gi, '$1REDACTED@')
    // `param=value` (value up to the next & or # or end) for any sensitive param.
    .replace(/([?&])([a-z0-9_\-]+)=([^&#]*)/gi, (m, sep, name, _val) => {
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
 *
 * `commentPrefix` (when a declaration sets one) names the provider's own comment /
 * preamble marker. Those lines are NOT observation rows — they are provider
 * metadata (a retrieval timestamp, a column legend, a contact address) — so they
 * are excluded from the observation-row scan, matching the line the extractor for
 * the same surface reads (`extract.js` parseRdb). They remain counted against
 * `maxInventoryRows`: an oversized body stays fail-closed exactly as before.
 */
function textShape({ text, declaredHeaderTokens, maxInventoryRows, valueRowRe, commentPrefix = null }) {
  const ls = lines(text);
  if (ls.length === 0) return { shape: GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, reasons: ['empty body'], code: GUARD_REASON.EMPTY_BODY };
  // A datetime+value observation pattern anywhere (outside the provider's own
  // comment preamble) is a value series → contamination.
  const scanned = commentPrefix ? ls.filter(l => !l.startsWith(commentPrefix)) : ls;
  const valueRows = valueRowRe ? scanned.filter(l => valueRowRe.test(l)).length : 0;
  if (valueRows > 0) {
    return { shape: GUARD_OUTCOME.VALUE_BEARING, reasons: [`${valueRows} row(s) match an observation datetime+value pattern (value-bearing series)`], code: GUARD_REASON.OBSERVATION_ROWS_PRESENT };
  }
  // The declared metadata header must be present (else this is not our surface).
  const headerPresent = declaredHeaderTokens.some(tok => text.includes(tok));
  if (!headerPresent) {
    return { shape: GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, reasons: ['declared metadata header tokens absent (wrong/foreign surface)'], code: GUARD_REASON.DECLARED_HEADER_ABSENT };
  }
  // A metadata/inventory surface is bounded. An unexpectedly large row count for a
  // single-candidate request cannot be ruled out as value rows → fail-closed.
  if (ls.length > maxInventoryRows) {
    return { shape: GUARD_OUTCOME.INDETERMINATE, reasons: [`row count ${ls.length} exceeds the declared inventory bound ${maxInventoryRows}; cannot rule out value rows`], code: GUARD_REASON.ROW_COUNT_OVER_BOUND };
  }
  return { shape: GUARD_OUTCOME.CONFORMANT, reasons: [], code: GUARD_REASON.CONFORMANT };
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
      if (j === PARSE_FAIL) return { shape: GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, reasons: ['malformed JSON'], code: GUARD_REASON.MALFORMED_JSON };
      if (j === null || typeof j !== 'object') return { shape: GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, reasons: ['not a JSON object'], code: GUARD_REASON.NOT_JSON_OBJECT };
      const resp = j.response;
      if (resp === null || typeof resp !== 'object') {
        return { shape: GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, reasons: ['no response envelope'], code: GUARD_REASON.NO_RESPONSE_ENVELOPE };
      }
      // Any non-empty data array = value rows returned despite length=0 → contamination.
      if (Array.isArray(resp.data) && resp.data.length > 0) {
        return { shape: GUARD_OUTCOME.VALUE_BEARING, reasons: [`response.data carries ${resp.data.length} row(s) despite length=0 (value-bearing)`], code: GUARD_REASON.DATA_ROWS_DESPITE_LENGTH_ZERO };
      }
      // `data` present-and-non-array, or any other observation-shaped array, cannot
      // be cleared as metadata-only → fail-closed indeterminate.
      if ('data' in resp && !Array.isArray(resp.data)) {
        return { shape: GUARD_OUTCOME.INDETERMINATE, reasons: ['response.data present but not an array; cannot rule out value payload'], code: GUARD_REASON.DATA_PRESENT_NOT_ARRAY };
      }
      if (resp.total === undefined || resp.total === null) {
        return { shape: GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, reasons: ['response.total (aggregate count) absent'], code: GUARD_REASON.AGGREGATE_TOTAL_ABSENT };
      }
      return { shape: GUARD_OUTCOME.CONFORMANT, reasons: [], code: GUARD_REASON.CONFORMANT };
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
      if (j === PARSE_FAIL) return { shape: GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, reasons: ['malformed JSON'], code: GUARD_REASON.MALFORMED_JSON };
      if (j === null || typeof j !== 'object') return { shape: GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, reasons: ['not a JSON object'], code: GUARD_REASON.NOT_JSON_OBJECT };
      const VALUE_KEYS = ['data', 'predictions', 'observations', 'values', 'series'];
      for (const k of VALUE_KEYS) {
        if (Array.isArray(j[k]) && j[k].length > 0) {
          return { shape: GUARD_OUTCOME.VALUE_BEARING, reasons: [`value-bearing array "${k}" (${j[k].length} rows) present on a metadata surface`], code: GUARD_REASON.VALUE_BEARING_ARRAY_PRESENT };
        }
      }
      if (!Array.isArray(j.stations) && (j.station === undefined)) {
        return { shape: GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, reasons: ['no station metadata block'], code: GUARD_REASON.NO_STATION_BLOCK };
      }
      return { shape: GUARD_OUTCOME.CONFORMANT, reasons: [], code: GUARD_REASON.CONFORMANT };
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
        // Every NWIS RDB body opens with a `#` preamble whose `# retrieved:
        // YYYY-MM-DD HH:MM:SS ...` line is a provider retrieval timestamp, not an
        // observation. Scanning it as data typed a benign catalog response
        // value_bearing; the extractor for this same surface has always dropped
        // `#` lines (extract.js parseRdb), so the guard was stricter than the
        // surface it guards by accident, not by design.
        commentPrefix: '#',
        // A site CATALOG carries date-only begin/end; a per-timestamp datetime (with
        // TIME) outside the preamble is an observation/value row — the value-bearing
        // signal (fail-closed).
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
 * `reason_code` is the STABLE {@link GUARD_REASON} label for the outcome — recorded
 * on the contact-log line so a rejection is never unexplained (F3).
 *
 * @param {Object} decl - a {@link RESPONSE_DECLS} entry (or a shape-compatible test decl)
 * @param {{status:number, contentType:(string|null), bodyBuffer:Buffer, truncated?:boolean}} resp
 * @returns {{outcome:string, value_exposure_status:string, reasons:string[], reason_code:string, guard_events:string[], parsed:(string|null)}}
 */
export function guardResponse(decl, resp) {
  const reasons = [];
  const guard_events = [];
  const done = (outcome, reason_code, extraReasons = [], parsed = null) => {
    reasons.push(...extraReasons);
    const value_exposure_status =
      outcome === GUARD_OUTCOME.VALUE_BEARING ? VALUE_EXPOSURE.DETECTED
        : outcome === GUARD_OUTCOME.INDETERMINATE ? VALUE_EXPOSURE.INDETERMINATE
          : VALUE_EXPOSURE.NONE;
    guard_events.push(`g2:${outcome}`);
    return { outcome, value_exposure_status, reasons, reason_code, guard_events, parsed };
  };

  if (decl === null || typeof decl !== 'object' || typeof decl.classify !== 'function') {
    // A missing/invalid declaration means the guard cannot clear the body → fail-closed.
    return done(GUARD_OUTCOME.INDETERMINATE, GUARD_REASON.NO_DECLARATION, ['no valid response declaration; cannot classify (fail-closed)']);
  }
  if (resp === null || typeof resp !== 'object' || !Buffer.isBuffer(resp.bodyBuffer)) {
    return done(GUARD_OUTCOME.INDETERMINATE, GUARD_REASON.NO_BYTE_BODY, ['response missing a byte body; cannot classify (fail-closed)']);
  }

  // Size-cap abort (streamed past the declared cap) → indeterminate (never conformant).
  if (resp.truncated === true) {
    return done(GUARD_OUTCOME.INDETERMINATE, GUARD_REASON.TRUNCATED_AT_CAP, [`body truncated at the ${decl.max_bytes ?? DEFAULT_MAX_BYTES}-byte cap; classification incomplete`]);
  }
  const maxBytes = decl.max_bytes ?? DEFAULT_MAX_BYTES;
  if (resp.bodyBuffer.length > maxBytes) {
    return done(GUARD_OUTCOME.INDETERMINATE, GUARD_REASON.EXCEEDS_CAP, [`body ${resp.bodyBuffer.length} B exceeds cap ${maxBytes} B; classification incomplete`]);
  }

  // Content-type allowlist (a wrong content-type is a foreign, non-value surface).
  const baseType = typeof resp.contentType === 'string' ? resp.contentType.split(';')[0].trim().toLowerCase() : '';
  const allowed = Array.isArray(decl.content_types) ? decl.content_types.map(t => t.toLowerCase()) : [];
  if (allowed.length > 0 && !allowed.includes(baseType)) {
    return done(GUARD_OUTCOME.NON_VALUE_INCOMPATIBLE, GUARD_REASON.CONTENT_TYPE_NOT_ALLOWLISTED, [`content-type "${baseType || '(none)'}" not in the declared allowlist [${allowed.join(', ')}]`]);
  }

  // Structural validation. Any THROW mid-classification is indeterminate (fail-closed).
  let text;
  try {
    text = resp.bodyBuffer.toString('utf8');
  } catch (e) {
    return done(GUARD_OUTCOME.INDETERMINATE, GUARD_REASON.BODY_NOT_UTF8, [`body is not decodable UTF-8: ${e.message}`]);
  }
  let result;
  try {
    result = decl.classify(text);
  } catch (e) {
    return done(GUARD_OUTCOME.INDETERMINATE, GUARD_REASON.VALIDATOR_THREW, [`structural validator threw mid-classification: ${e.message}`]);
  }
  if (result === null || typeof result !== 'object' || !Object.values(GUARD_OUTCOME).includes(result.shape)) {
    return done(GUARD_OUTCOME.INDETERMINATE, GUARD_REASON.VALIDATOR_SHAPE_UNRECOGNIZED, ['structural validator returned an unrecognized shape (fail-closed)']);
  }
  // On a conformant shape, hand the decoded text to extract.js — never the raw buffer.
  const parsed = result.shape === GUARD_OUTCOME.CONFORMANT ? text : null;
  // A declaration outside RESPONSE_DECLS may not supply a code; the outcome and the
  // prose reasons remain authoritative, the LABEL degrades to `unspecified`.
  const code = Object.values(GUARD_REASON).includes(result.code) ? result.code : GUARD_REASON.UNSPECIFIED;
  return done(result.shape, code, result.reasons || [], parsed);
}
