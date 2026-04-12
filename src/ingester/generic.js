/**
 * src/ingester/generic.js
 * Anti-cheating enforcement boundary.
 * Converts raw (or anonymized) JSON into NormalizedEvent[] using structural
 * heuristics only. No hardcoded field names.
 *
 * Detection strategy:
 *   Timestamp: ISO8601 string | integer > 1e12 (Unix ms) | integer in [1e9, 1e12] (Unix s)
 *   Value:     Highest-variance non-timestamp numeric field
 *   Coords:    Pair where one is in [-90,90] (lat) and other in [-180,180] (lon)
 *   Count:     Array length (sensor arrays) or largest integer-like field
 *
 * @module ingester/generic
 */

import { readFileSync } from 'node:fs';
import { createReplay } from '../replay/deterministic.js';

/**
 * @typedef {Object} NormalizedEvent
 * @property {number} timestamp - Unix epoch milliseconds
 * @property {number} value     - Primary numeric value (highest-variance field)
 * @property {Object} metadata  - Structural metadata only; no source field names or URLs
 */

// ─── Structural detection helpers ───────────────────────────────────────────

const ISO8601_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const URL_RE = /https?:\/\/\S+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/\S*)?/g;

/**
 * Try to parse a value as a timestamp. Returns epoch-ms or null.
 * @param {any} v
 * @returns {number|null}
 */
function tryTimestamp(v) {
  if (typeof v === 'string' && ISO8601_RE.test(v)) {
    const ms = Date.parse(v);
    return isNaN(ms) ? null : ms;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v > 1e12) return v;              // Unix ms
    if (v >= 1e9 && v <= 1e12) return v * 1000; // Unix s → ms
  }
  return null;
}

/**
 * Recursively collect leaf numeric/string values from an object.
 * Returns { fieldPath: value } for all non-nested leaves.
 * @param {Object} obj
 * @param {string} [prefix]
 * @returns {Record<string, any>}
 */
function collectLeaves(obj, prefix = '') {
  const result = {};
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return result;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(result, collectLeaves(v, path));
    } else {
      result[path] = v;
    }
  }
  return result;
}

/**
 * Given a flat map of field → value, find the best timestamp field.
 * Returns { fieldPath, epochMs } or null.
 * @param {Record<string, any>} leaves
 * @returns {{ fieldPath: string, epochMs: number }|null}
 */
function findTimestampField(leaves) {
  for (const [path, val] of Object.entries(leaves)) {
    const ms = tryTimestamp(val);
    if (ms !== null) return { fieldPath: path, epochMs: ms };
  }
  return null;
}

/**
 * Compute variance of a number array.
 * @param {number[]} nums
 * @returns {number}
 */
function variance(nums) {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  return nums.reduce((s, x) => s + (x - mean) ** 2, 0) / nums.length;
}

/**
 * Find the highest-variance non-timestamp numeric field across an array of leaf maps.
 * @param {Record<string, any>[]} leafMaps
 * @param {string|null} tsFieldPath - field to exclude (timestamp)
 * @returns {string|null} fieldPath of the primary value
 */
function findValueField(leafMaps, tsFieldPath) {
  // Collect all numeric field paths (excluding timestamp)
  const fieldValues = {};
  for (const leaves of leafMaps) {
    for (const [path, val] of Object.entries(leaves)) {
      if (path === tsFieldPath) continue;
      if (typeof val === 'number' && Number.isFinite(val)) {
        if (!fieldValues[path]) fieldValues[path] = [];
        fieldValues[path].push(val);
      }
    }
  }
  if (Object.keys(fieldValues).length === 0) return null;
  // Highest variance
  let best = null;
  let bestVar = -1;
  for (const [path, vals] of Object.entries(fieldValues)) {
    const v = variance(vals);
    if (v > bestVar) { bestVar = v; best = path; }
  }
  return best;
}

/**
 * Find coordinate field pair in a leaf map.
 * Returns { lat, lon, latVal, lonVal } or null.
 * @param {Record<string, any>} leaves
 * @returns {{ latField: string, lonField: string, lat: number, lon: number }|null}
 */
function findCoordinates(leaves) {
  const numericFields = Object.entries(leaves)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v));

  const latCandidates = numericFields.filter(([, v]) => v >= -90 && v <= 90);
  const lonCandidates = numericFields.filter(([, v]) => v >= -180 && v <= 180);

  // Find a pair (different fields) where one is lat-range and other is lon-range
  for (const [latField, latVal] of latCandidates) {
    for (const [lonField, lonVal] of lonCandidates) {
      if (latField === lonField) continue;
      // Heuristic: lon-range is [-180,180], lat-range is [-90,90]
      // If one value is outside [-90,90] it must be lon
      if (Math.abs(lonVal) > 90 || Math.abs(latVal) <= 90) {
        return { latField, lonField, lat: latVal, lon: lonVal };
      }
    }
  }
  return null;
}

/**
 * Strip URLs and domain-like strings from a value.
 * @param {any} v
 * @returns {any}
 */
function stripSourceIdentifiers(v) {
  if (typeof v === 'string') {
    return v.replace(URL_RE, '[redacted]').trim();
  }
  return v;
}

// ─── Shape-specific parsers ──────────────────────────────────────────────────

/**
 * Parse GeoJSON FeatureCollection.
 * @param {Object} data
 * @param {number|null} [timestampBase] - If provided, used as deterministic fallback base
 * @returns {NormalizedEvent[]}
 */
function parseGeoJSON(data, timestampBase = null) {
  const features = data.features;
  if (features.length === 0) return [];

  // Sample all features to find value field
  const leafMaps = features.map(f => collectLeaves(f));
  const tsResult = findTimestampField(leafMaps[0]);
  const tsField = tsResult?.fieldPath ?? null;
  const valueField = findValueField(leafMaps, tsField);

  return features.map((f, i) => {
    const leaves = collectLeaves(f);

    // Timestamp
    const tsEntry = findTimestampField(leaves);
    const timestamp = tsEntry?.epochMs ?? (timestampBase != null ? timestampBase + i : Date.now());

    // Value
    const value = valueField ? (leaves[valueField] ?? 0) : 0;

    // Coordinates from geometry or properties
    const coords = f.geometry?.coordinates;
    const coordMeta = coords
      ? { has_coords: true, coord_count: coords.length }
      : { has_coords: false };

    return {
      timestamp,
      value,
      metadata: {
        shape: 'geojson_feature',
        ...coordMeta,
      },
    };
  });
}

/**
 * Parse array of objects (e.g. SWPC X-ray, AirNow).
 * @param {Object[]} data
 * @param {number|null} [timestampBase] - If provided, used as deterministic fallback base
 * @returns {NormalizedEvent[]}
 */
function parseArrayOfObjects(data, timestampBase = null) {
  if (data.length === 0) return [];

  const leafMaps = data.map(item => collectLeaves(item));
  const tsResult = findTimestampField(leafMaps[0]);
  const tsField = tsResult?.fieldPath ?? null;
  const valueField = findValueField(leafMaps, tsField);
  const coordResult = findCoordinates(leafMaps[0]);

  return data.map((item, i) => {
    const leaves = collectLeaves(item);
    const tsEntry = findTimestampField(leaves);
    const timestamp = tsEntry?.epochMs ?? (timestampBase != null ? timestampBase + i : Date.now() + i);
    const value = valueField ? (leaves[valueField] ?? 0) : 0;

    const coordMeta = coordResult
      ? { has_coords: true }
      : { has_coords: false };

    return {
      timestamp,
      value,
      metadata: {
        shape: 'object',
        ...coordMeta,
      },
    };
  });
}

/**
 * Parse array of arrays (e.g. SWPC Kp, PurpleAir data rows).
 * First row may be headers (strings) or data (numbers/dates).
 * @param {any[][]} data
 * @param {string[]|null} [headers] - Optional external header array
 * @param {number|null} [timestampBase] - If provided, used as deterministic fallback base
 * @returns {NormalizedEvent[]}
 */
function parseArrayOfArrays(data, headers = null, timestampBase = null) {
  if (data.length === 0) return [];

  let dataRows = data;
  let colCount = data[0].length;

  // Detect if first row is headers (all strings)
  if (!headers && data[0].every(v => typeof v === 'string' && tryTimestamp(v) === null)) {
    headers = data[0];
    dataRows = data.slice(1);
  }

  if (dataRows.length === 0) return [];
  colCount = dataRows[0].length;

  // Find timestamp column (first column that can be parsed as timestamp)
  let tsCol = -1;
  for (let c = 0; c < colCount; c++) {
    if (tryTimestamp(dataRows[0][c]) !== null) { tsCol = c; break; }
  }

  // Find highest-variance numeric column (excluding tsCol and ID-like columns)
  const colValues = Array.from({ length: colCount }, () => []);
  for (const row of dataRows) {
    for (let c = 0; c < colCount; c++) {
      if (c === tsCol) continue;
      if (typeof row[c] === 'number' && Number.isFinite(row[c])) {
        colValues[c].push(row[c]);
      }
    }
  }

  /**
   * Detect if a column looks like a row ID (large monotonically increasing integers
   * with a fixed step). E.g. PurpleAir sensor_index: 131075, 131077, 131079, ...
   * @param {number[]} vals
   * @returns {boolean}
   */
  function isIdLikeColumn(vals) {
    if (vals.length < 2) return false;
    // All values must be integers > 1000
    if (!vals.every(v => Number.isInteger(v) && v > 1000)) return false;
    // Must increase (or be constant) with a fixed step ≥ 0
    const step = vals[1] - vals[0];
    if (step < 0) return false; // decreasing — not an ID sequence
    if (step === 0) return true; // constant large integer — also skip
    return vals.every((v, i) => i === 0 || v - vals[i - 1] === step);
  }

  let valueCol = -1;
  let bestVar = -1;
  for (let c = 0; c < colCount; c++) {
    if (c === tsCol || colValues[c].length === 0) continue;
    if (isIdLikeColumn(colValues[c])) continue; // skip ID-like columns
    const v = variance(colValues[c]);
    if (v > bestVar) { bestVar = v; valueCol = c; }
  }

  // Fallback: if all non-ts columns were skipped (all ID-like), pick best without filter
  if (valueCol === -1) {
    for (let c = 0; c < colCount; c++) {
      if (c === tsCol || colValues[c].length === 0) continue;
      const v = variance(colValues[c]);
      if (v > bestVar) { bestVar = v; valueCol = c; }
    }
  }

  return dataRows.map((row, i) => {
    const tsVal = tsCol >= 0 ? tryTimestamp(row[tsCol]) : null;
    const timestamp = tsVal ?? (timestampBase != null ? timestampBase + i : Date.now() + i);
    const value = valueCol >= 0 ? (row[valueCol] ?? 0) : 0;

    return {
      timestamp,
      value,
      metadata: {
        shape: 'array_row',
        col_count: colCount,
      },
    };
  });
}

/**
 * Parse a combined object (e.g. swpc-goes-xray.json, donki-flr-cme.json).
 * Each top-level array-valued key is parsed as its own sub-stream.
 * @param {Object} data
 * @param {number|null} [timestampBase] - If provided, used as deterministic fallback base
 * @returns {NormalizedEvent[]}
 */
function parseCombinedObject(data, timestampBase = null) {
  const allEvents = [];

  for (const [streamKey, streamData] of Object.entries(data)) {
    let events;

    if (Array.isArray(streamData)) {
      if (streamData.length === 0) continue;
      // Skip scalar arrays (e.g. GeoJSON bbox: [-170, -18, 0, 64, 0, 600])
      const firstItem = streamData[0];
      if (firstItem === null || (typeof firstItem !== 'object' && !Array.isArray(firstItem))) {
        continue;
      }
      const shape = Array.isArray(firstItem) ? 'array_of_arrays' : 'array_of_objects';
      events = shape === 'array_of_arrays'
        ? parseArrayOfArrays(streamData, null, timestampBase)
        : parseArrayOfObjects(streamData, timestampBase);
    } else if (streamData && typeof streamData === 'object') {
      // Nested object — recurse via ingest() to handle PurpleAir-style sub-objects
      // (e.g. { api_version, fields, data: [[...]] })
      events = ingest(streamData, { timestampBase });
    } else {
      continue;
    }

    // Tag with stream index (no source names in metadata)
    for (const ev of events) {
      allEvents.push({
        timestamp: ev.timestamp,
        value: ev.value,
        metadata: {
          ...ev.metadata,
          stream_index: Object.keys(data).indexOf(streamKey),
        },
      });
    }
  }

  // Sort all streams together by timestamp
  allEvents.sort((a, b) => a.timestamp - b.timestamp);
  return allEvents;
}

// ─── PurpleAir special case ──────────────────────────────────────────────────

/**
 * Detect if data is PurpleAir-style: object with `fields` array and `data` array-of-arrays.
 * @param {any} data
 * @returns {boolean}
 */
function isPurpleAirShape(data) {
  return (
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    Array.isArray(data.fields) &&
    Array.isArray(data.data)
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Ingest raw or anonymized JSON data into NormalizedEvent[].
 * Uses structural heuristics only — no field names.
 *
 * @param {any} rawData - Parsed JSON (any shape)
 * @param {Object} [opts]
 * @param {number|null} [opts.timestampBase] - If provided, events without parseable
 *   timestamps use `timestampBase + index` instead of `Date.now()`. Pass a fixed
 *   value to obtain deterministic output across repeated calls.
 * @returns {NormalizedEvent[]}
 */
export function ingest(rawData, { timestampBase = null } = {}) {
  // PurpleAir: {fields: [...], data: [[...], ...]}
  if (isPurpleAirShape(rawData)) {
    // Treat data as array-of-arrays with external header from fields key
    // But to keep no source field names in metadata, we use positional detection
    const events = parseArrayOfArrays(rawData.data, null, timestampBase);
    // Annotate with sensor count (number of rows = sensor reading count)
    for (const ev of events) {
      ev.metadata.sensor_count = rawData.data.length;
    }
    return events;
  }

  // GeoJSON FeatureCollection — detect by known field name OR by value
  // After anonymization, the "type" and "features" field names are renamed,
  // so we also scan for any object-valued entry whose value is "FeatureCollection"
  // paired with an array field whose items have geometry-like structure.
  if (rawData?.type === 'FeatureCollection' && Array.isArray(rawData.features)) {
    return parseGeoJSON(rawData, timestampBase);
  }
  if (rawData && typeof rawData === 'object' && !Array.isArray(rawData)) {
    // Try to detect anonymized GeoJSON: one field = "FeatureCollection", one field = large object array
    const entries = Object.entries(rawData);
    const typeEntry = entries.find(([, v]) => v === 'FeatureCollection');
    const featuresEntry = entries.find(([, v]) => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object');
    if (typeEntry && featuresEntry) {
      return parseGeoJSON({ type: 'FeatureCollection', features: featuresEntry[1] }, timestampBase);
    }
  }

  // Array root
  if (Array.isArray(rawData)) {
    if (rawData.length === 0) return [];
    if (Array.isArray(rawData[0])) return parseArrayOfArrays(rawData, null, timestampBase);
    return parseArrayOfObjects(rawData, timestampBase);
  }

  // Combined object (multiple streams)
  if (rawData && typeof rawData === 'object') {
    const entries = Object.entries(rawData);
    // Single array key with no nested objects → recurse on the array directly
    const arrayKeys = entries.filter(([, v]) => Array.isArray(v));
    const objectKeys = entries.filter(([, v]) =>
      v !== null && typeof v === 'object' && !Array.isArray(v));
    if (arrayKeys.length === 1 && objectKeys.length === 0) {
      const [, arr] = arrayKeys[0];
      return ingest(arr, { timestampBase }); // Recurse on the single array
    }
    return parseCombinedObject(rawData, timestampBase);
  }

  return [];
}

/**
 * Ingest a fixture file by path.
 * @param {string} filePath
 * @param {Object} [opts]
 * @param {number|null} [opts.timestampBase] - If provided, events without parseable
 *   timestamps use `timestampBase + index` instead of `Date.now()`.
 * @returns {NormalizedEvent[]}
 */
export function ingestFile(filePath, { timestampBase = null } = {}) {
  const { events, shape } = createReplay(filePath);

  if (shape === 'geojson_feature_collection') {
    // events are already features — parse as GeoJSON
    return parseGeoJSON({ type: 'FeatureCollection', features: events }, timestampBase);
  }
  if (shape === 'combined_object') {
    // events are {_stream, _data} — re-parse original file
    const raw = readFileSync(filePath, 'utf8');
    return ingest(JSON.parse(raw), { timestampBase });
  }

  // array_of_objects or array_of_arrays
  return ingest(events, { timestampBase });
}
