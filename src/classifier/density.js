/**
 * src/classifier/density.js
 * Q4: Density Classifier — characterizes the sensor/source deployment topology.
 *
 * Classifications:
 *   single_point              — single observation point (local point sensor)
 *   single_global_instrument  — single device with planetary coverage (e.g. GOES satellite, NOAA Kp)
 *   sparse_network            — geographically distributed sensors, relatively few
 *   dense_network             — many closely-spaced sensors
 *   multi_tier                — multiple tiers of sensors (raw consumer + official, different quality)
 *
 * @module classifier/density
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Minimum column count for array_row events to be considered a sensor grid.
 * Wide tables (many columns per row) indicate multi-parameter sensor readings
 * typical of sensor array exports (e.g. PurpleAir: 9 columns).
 * Narrow tables (few columns) indicate simple time-series data (e.g. Kp: 4 columns).
 */
const SENSOR_GRID_MIN_COLS = 6;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Extract the sensor count from event metadata.
 * Returns the sensor_count if present on any event.
 *
 * @param {import('../ingester/generic.js').NormalizedEvent[]} events
 * @returns {number|null}
 */
export function extractSensorCount(events) {
  for (const e of events) {
    if (typeof e.metadata?.sensor_count === 'number') {
      return e.metadata.sensor_count;
    }
  }
  return null;
}

/**
 * Count events with geographic coordinates (has_coords: true).
 * @param {import('../ingester/generic.js').NormalizedEvent[]} events
 * @returns {number}
 */
export function countCoordEvents(events) {
  return events.filter(e => e.metadata?.has_coords === true).length;
}

/**
 * Count events with geojson_feature shape.
 * GeoJSON features are always geographic even if has_coords detection is unreliable
 * post-anonymization (the shape field is set by ingester code, not field names).
 *
 * @param {import('../ingester/generic.js').NormalizedEvent[]} events
 * @returns {number}
 */
export function countGeoJsonFeatures(events) {
  return events.filter(e => e.metadata?.shape === 'geojson_feature').length;
}

/**
 * Detect if any stream in a multi-stream feed is a sensor grid (array_row with many columns).
 * A wide array_row stream (col_count >= SENSOR_GRID_MIN_COLS) indicates a sensor array
 * export where each row represents a sensor with multiple measurement columns.
 * This is structurally preserved after anonymization (col_count is positional metadata).
 *
 * @param {import('../ingester/generic.js').NormalizedEvent[]} events
 * @param {Set<number>} streamIndices
 * @returns {boolean}
 */
export function hasSensorGridStream(events, streamIndices) {
  for (const idx of streamIndices) {
    const streamEvents = events.filter(e => e.metadata?.stream_index === idx);
    if (streamEvents.length === 0) continue;
    const sample = streamEvents[0];
    if (
      sample.metadata?.shape === 'array_row' &&
      typeof sample.metadata?.col_count === 'number' &&
      sample.metadata.col_count >= SENSOR_GRID_MIN_COLS
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Detect multi-tier deployment from event metadata.
 * Multi-tier requires:
 *   1. Multiple stream indices (different source tiers), AND
 *   2. Evidence of a sensor grid — either explicit sensor_count OR a wide array_row stream.
 *
 * Works in both raw mode (sensor_count present) and anonymized mode
 * (sensor_count absent but col_count signal preserved).
 *
 * @param {import('../ingester/generic.js').NormalizedEvent[]} events
 * @param {Set<number>} streamIndices
 * @returns {boolean}
 */
export function detectMultiTier(events, streamIndices) {
  if (streamIndices.size < 2) return false;
  // Explicit sensor_count (raw mode — PurpleAir shape detected)
  const hasSensorCount = events.some(e => typeof e.metadata?.sensor_count === 'number');
  if (hasSensorCount) return true;
  // Structural sensor grid signal (both raw and anonymized)
  return hasSensorGridStream(events, streamIndices);
}

/**
 * Compute Haversine distance between two lat/lon points in kilometers.
 *
 * @param {{ lat: number, lon: number }} a
 * @param {{ lat: number, lon: number }} b
 * @returns {number} distance in km
 */
export function computeHaversineDistance(a, b) {
  const R = 6371; // Earth radius in km
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const sinDlat = Math.sin(dLat / 2);
  const sinDlon = Math.sin(dLon / 2);
  const x =
    sinDlat * sinDlat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinDlon * sinDlon;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify the sensor/source deployment density of a normalized event stream.
 *
 * @param {import('../ingester/generic.js').NormalizedEvent[]} events
 * @returns {{ classification: string, [key: string]: any }}
 */
export function classifyDensity(events) {
  if (events.length === 0) {
    return { classification: 'single_point' };
  }

  const streamIndices = new Set(
    events.map(e => e.metadata?.stream_index).filter(v => v !== undefined && v !== null)
  );

  // ── Multi-tier: sensor grid with multiple quality tiers ───────────────────
  // Detected by: sensor_count metadata (raw mode) OR wide array_row stream (both modes).
  // Example: PurpleAir (9-column sensor grid) + AirNow (official readings).
  if (detectMultiTier(events, streamIndices)) {
    return {
      classification: 'multi_tier',
      tier_count: streamIndices.size,
    };
  }

  // ── GeoJSON features → geographically distributed network ─────────────────
  // GeoJSON features represent geographic events/observations from distinct locations.
  // This signal is preserved in both raw and anonymized modes because the shape field
  // is set by the ingester's structural detection, not by field names.
  const geoJsonCount = countGeoJsonFeatures(events);
  if (geoJsonCount > 0 && streamIndices.size < 2) {
    // Single-stream GeoJSON → sparse or dense geographic distribution
    const n = events.length;
    if (n < 200) {
      return {
        classification: 'sparse_network',
        sensor_count: n,
      };
    }
    return {
      classification: 'dense_network',
      sensor_count: n,
    };
  }

  // ── Has-coords single stream (non-GeoJSON) → sparse/dense network ─────────
  // Fallback for single-stream object feeds with coordinate metadata.
  if (streamIndices.size < 2) {
    const coordCount = countCoordEvents(events);
    if (coordCount > 0) {
      const n = events.length;
      return {
        classification: n < 200 ? 'sparse_network' : 'dense_network',
        sensor_count: n,
      };
    }
  }

  // ── Single global instrument: planetary-scale coverage from a single device ──
  // A sensor that monitors a planetary-scale phenomenon (e.g. GOES satellite, NOAA Kp)
  // is not equivalent to a local single_point sensor. Detected via metadata.coverage.
  const hasGlobalCoverage = events.some(e => e.metadata?.coverage === 'global');
  if (hasGlobalCoverage) {
    return { classification: 'single_global_instrument' };
  }

  // ── Single point: local sensor or multi-stream without sensor grid ──
  return { classification: 'single_point' };
}
