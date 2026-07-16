/**
 * lab/acquisition/extract.js
 *
 * Cycle-005 S01 (PRD FR-A1/FR-A6; SDD DR-3, DR-7, §6.4 Lane A; Sprint Plan T1.4).
 *
 * Per-provider extractors. Each consumes a body that guards.js has already
 * classified `conformant` (metadata-only) and returns ONLY the declared measured
 * fields — `history_years`, `span`, `n_observations` — plus a per-field
 * extraction note. Stdlib parsing only (JSON / tab-RDB / CSV / whitespace text);
 * NO value-level series is ever read (guards.js guarantees the body carries none).
 *
 * `history_years` is derived by the DR-7 documented-equivalence method:
 *   history_years = (end_ms - start_ms) / YEAR_MS,  YEAR_MS = 365.25 * 86_400_000
 * which restates the documented period-of-record span and is conservative for the
 * `>= 3y` gate (365.25 vs 365.0 yields the smaller year count). It is an INTENDED
 * class-(ii) input — lawful only after the operator accepts it at Gate A (UD-1);
 * extract.js records the value + method, classify.js records the realized class.
 *
 * `n_observations` is extracted ONLY where a lawful aggregate COUNT surface exists
 * (EIA v2 `response.total`); for every flat-file / value-paging provider it is
 * `null` with a note — never an inflating `cadence x span` estimate (DR-7).
 *
 * @module lab/acquisition/extract
 */

/** Exact-arithmetic year length used for the DR-7 documented-equivalence derivation. */
export const YEAR_MS = 365.25 * 86_400_000;

/** An extraction failure — malformed / unparseable conformant body (invalid input). */
export class ExtractionError extends Error {
  constructor(message) { super(message); this.name = 'ExtractionError'; }
}

/** Conservative documented-equivalence history_years from two epoch-ms endpoints. */
export function historyYearsFromSpan(startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) throw new ExtractionError('historyYearsFromSpan: non-finite endpoints');
  if (endMs < startMs) throw new ExtractionError('historyYearsFromSpan: end precedes start');
  return (endMs - startMs) / YEAR_MS;
}

/** Parse an ISO-8601 date/datetime (or `YYYY-MM-DD`) to epoch ms; throws on invalid. */
function isoToMs(s, label) {
  if (typeof s !== 'string' || s.length === 0) throw new ExtractionError(`${label}: missing date`);
  const ms = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s);
  if (!Number.isFinite(ms)) throw new ExtractionError(`${label}: unparseable date "${s}"`);
  return ms;
}

/** Split an RDB (USGS) body into non-comment rows; the first non-comment row is the header. */
function parseRdb(text) {
  const rows = text.split(/\r?\n/).filter(l => l.length > 0 && !l.startsWith('#'));
  if (rows.length < 2) throw new ExtractionError('RDB: no data rows');
  const header = rows[0].split('\t');
  // RDB carries a type-definition row (e.g. "5s\t15s\t...") right after the header; skip it.
  const dataRows = rows.slice(rows[1] && /^\d+[sdn]$/.test(rows[1].split('\t')[0]) ? 2 : 1);
  return { header, dataRows: dataRows.map(r => r.split('\t')) };
}

/** Column index by name in a header array (case-insensitive), or -1. */
function col(header, name) {
  const i = header.findIndex(h => h.trim().toLowerCase() === name.toLowerCase());
  return i;
}

/**
 * The per-`method_id` extractor table. Each extractor returns:
 *   { fields: { history_years?, span?, n_observations? }, notes: { <field>: <string> } }
 * with `n_observations: null` where no lawful count surface exists.
 * @type {Readonly<Object<string, (text:string)=>{fields:Object, notes:Object}>>}
 */
export const extractors = Object.freeze({
  // USGS NWIS site catalog (RDB): begin_date / end_date period of record; count_nu
  // is a per-series count of RECORDS which is NOT the observation count contract →
  // n_observations stays null (class 3), never a paged value count.
  'usgs-nwis-site-metadata'(text) {
    const { header, dataRows } = parseRdb(text);
    const bi = col(header, 'begin_date'), ei = col(header, 'end_date');
    if (bi < 0 || ei < 0) throw new ExtractionError('USGS RDB: begin_date/end_date columns absent');
    let earliest = Infinity, latest = -Infinity;
    for (const r of dataRows) {
      if (r[bi]) earliest = Math.min(earliest, isoToMs(r[bi], 'USGS begin_date'));
      if (r[ei]) latest = Math.max(latest, isoToMs(r[ei], 'USGS end_date'));
    }
    if (!Number.isFinite(earliest) || !Number.isFinite(latest)) throw new ExtractionError('USGS RDB: no period-of-record dates');
    return {
      fields: { history_years: historyYearsFromSpan(earliest, latest), span: { start_ms: earliest, end_ms: latest }, n_observations: null },
      notes: { history_years: 'DR-7 documented-equivalence over site-catalog begin_date/end_date', n_observations: 'no lawful aggregate count surface (flat/paged); class 3' },
    };
  },

  // NOAA CO-OPS Metadata API station details JSON: established/period fields.
  'noaa-coops-station-metadata'(text) {
    let j;
    try { j = JSON.parse(text); } catch (e) { throw new ExtractionError(`CO-OPS JSON: ${e.message}`); }
    const st = Array.isArray(j.stations) ? j.stations[0] : (j.station || j);
    if (!st || typeof st !== 'object') throw new ExtractionError('CO-OPS: no station record');
    const start = st.established || st.period_start || st.begin_date;
    const end = st.period_end || st.end_date || st.retrieved || st.last_observation;
    const startMs = isoToMs(start, 'CO-OPS established');
    const endMs = isoToMs(end, 'CO-OPS period end');
    return {
      fields: { history_years: historyYearsFromSpan(startMs, endMs), span: { start_ms: startMs, end_ms: endMs }, n_observations: null },
      notes: { history_years: 'DR-7 documented-equivalence over CO-OPS established/period fields', n_observations: 'value paging forbidden (FR-B2); no aggregate count surface; class 3' },
    };
  },

  // NOAA NDBC station table (whitespace text): station identity + deployment period.
  'noaa-ndbc-station-metadata'(text) {
    const rows = text.split(/\r?\n/).filter(l => l.length > 0 && !l.startsWith('#') === true || /^#STATION_ID/i.test(l));
    const header = rows.find(l => /station_id/i.test(l));
    if (!header) throw new ExtractionError('NDBC: no station header');
    // Deployment period columns are provider-specific; require an explicit period pair.
    const startMatch = text.match(/deploy(?:ed|ment)_start[^\dA-Za-z]*(\d{4}-\d{2}-\d{2})/i);
    const endMatch = text.match(/deploy(?:ed|ment)_end[^\dA-Za-z]*(\d{4}-\d{2}-\d{2})/i);
    if (!startMatch || !endMatch) {
      return { fields: { history_years: null, span: null, n_observations: null }, notes: { history_years: 'NDBC deployment period not present on this surface; class 3 pending Gate-A confirmation', n_observations: 'flat-file provider; counting = value download (forbidden); class 3' } };
    }
    const startMs = isoToMs(startMatch[1], 'NDBC start'), endMs = isoToMs(endMatch[1], 'NDBC end');
    return {
      fields: { history_years: historyYearsFromSpan(startMs, endMs), span: { start_ms: startMs, end_ms: endMs }, n_observations: null },
      notes: { history_years: 'DR-7 documented-equivalence over NDBC deployment period', n_observations: 'flat-file provider; counting = value download (forbidden); class 3' },
    };
  },

  // NWS/ISD station inventory CSV: BEGIN / END period-of-record columns.
  'nws-isd-station-inventory'(text) {
    const rows = text.split(/\r?\n/).filter(l => l.length > 0);
    if (rows.length < 2) throw new ExtractionError('ISD CSV: no data rows');
    const header = rows[0].split(',').map(h => h.trim());
    const bi = col(header, 'BEGIN'), ei = col(header, 'END');
    if (bi < 0 || ei < 0) throw new ExtractionError('ISD CSV: BEGIN/END columns absent');
    let earliest = Infinity, latest = -Infinity;
    for (const line of rows.slice(1)) {
      const c = line.split(',');
      const b = c[bi] && c[bi].trim(), e = c[ei] && c[ei].trim();
      if (b && /^\d{8}$/.test(b)) earliest = Math.min(earliest, isoToMs(`${b.slice(0, 4)}-${b.slice(4, 6)}-${b.slice(6, 8)}`, 'ISD BEGIN'));
      if (e && /^\d{8}$/.test(e)) latest = Math.max(latest, isoToMs(`${e.slice(0, 4)}-${e.slice(4, 6)}-${e.slice(6, 8)}`, 'ISD END'));
    }
    if (!Number.isFinite(earliest) || !Number.isFinite(latest)) throw new ExtractionError('ISD CSV: no BEGIN/END period');
    return {
      fields: { history_years: historyYearsFromSpan(earliest, latest), span: { start_ms: earliest, end_ms: latest }, n_observations: null },
      notes: { history_years: 'DR-7 documented-equivalence over ISD BEGIN/END columns', n_observations: 'flat-file provider; counting = value download (forbidden); class 3' },
    };
  },

  // EIA v2 envelope (length=0): response.total is the exact aggregate row count —
  // the sole lawful class-(i) n_observations path. Series start/end give the span.
  'eia-electricity-demand-count'(text) {
    let j;
    try { j = JSON.parse(text); } catch (e) { throw new ExtractionError(`EIA JSON: ${e.message}`); }
    const resp = j.response;
    if (!resp || typeof resp !== 'object') throw new ExtractionError('EIA: no response envelope');
    const totalRaw = resp.total;
    const total = typeof totalRaw === 'string' ? Number(totalRaw) : totalRaw;
    if (!Number.isFinite(total)) throw new ExtractionError('EIA: response.total absent/non-numeric');
    const n = Number.isInteger(total) ? total : Math.trunc(total);
    const fields = { n_observations: n };
    const notes = { n_observations: 'DR-7 class-(i) exact count: EIA v2 response.total requested with length=0' };
    // Series period, when the envelope reports it, gives history_years by the same DR-7 method.
    const startPeriod = resp.startPeriod || resp.start;
    const endPeriod = resp.endPeriod || resp.end;
    if (typeof startPeriod === 'string' && typeof endPeriod === 'string') {
      const startMs = isoToMs(startPeriod, 'EIA start');
      const endMs = isoToMs(endPeriod, 'EIA end');
      fields.history_years = historyYearsFromSpan(startMs, endMs);
      fields.span = { start_ms: startMs, end_ms: endMs };
      notes.history_years = 'DR-7 documented-equivalence over EIA series start/end period';
    } else {
      fields.history_years = null;
      fields.span = null;
      notes.history_years = 'EIA series period absent from count envelope; obtain from series-metadata surface (class 3 pending)';
    }
    return { fields, notes };
  },
});
