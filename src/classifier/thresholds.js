/**
 * src/classifier/thresholds.js
 * Q5: Threshold Type Classifier — determines whether feed thresholds are
 * statistical, regulatory, or absolute.
 *
 * Classifications:
 *   statistical  — thresholds derived from data statistics (percentiles, stddev
 *                  multiples). Natural fit for single-source event-driven data
 *                  where there is no regulatory standard (earthquake magnitude).
 *   regulatory   — fixed threshold levels defined by authorities or regulatory
 *                  bodies (AQI categories, solar storm G-scales). Used in
 *                  official monitoring systems.
 *   absolute     — fixed absolute thresholds not tied to statistical distribution
 *                  or regulation (e.g. hard physical limits).
 *
 * Detection heuristics:
 *   1. Multi-stream (≥2 stream_index values) → regulatory.
 *      Combined official/regulated sources always operate under regulatory frameworks.
 *   2. Single-stream, values bounded in [0, 600] → regulatory.
 *      Known regulatory ranges: AQI [0-500], Kp [0-9], radiation scales [0-5].
 *   3. Single-stream, values unbounded OR event-driven pattern → statistical.
 *
 * @module classifier/thresholds
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ─── Regulatory table loading ─────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load all regulatory threshold tables from the data directory.
 * Returns an array of table objects, each with { name, breakpoints }.
 *
 * This function reads from disk; callers should cache the result if called
 * in a hot path. The module-level `REGULATORY_TABLES` constant is pre-loaded.
 *
 * @returns {Array<{ name: string, breakpoints: number[] }>}
 */
export function loadRegulatoryTables() {
  const dataDir = join(__dirname, 'data');
  const tableFiles = [
    'regulatory-epa-aqi.json',
    'regulatory-noaa-kp.json',
    'regulatory-noaa-r.json',
  ];
  return tableFiles.map(f => JSON.parse(readFileSync(join(dataDir, f), 'utf8')));
}

/** Module-level cache of regulatory tables (loaded once). */
const REGULATORY_TABLES = loadRegulatoryTables();

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Detect if a set of values falls within a known regulatory bounded range.
 * Regulatory feeds tend to have values in a defined range with a stable max.
 *
 * Known regulatory ranges:
 *   - AQI: [0, 500]
 *   - Kp index: [0, 9]
 *   - Radiation scales: [0, 5]
 *   - NOAA G/S/R scales: bounded small integers
 *
 * Upper bound of 600 provides a generous margin above the largest standard
 * AQI scale (500) to catch regulatory feeds with occasional overflow readings.
 *
 * @param {number[]} values
 * @returns {boolean}
 */
export function isRegulatedRange(values) {
  if (values.length === 0) return false;
  const min = Math.min(...values);
  const max = Math.max(...values);
  // All non-negative and max within the regulatory ceiling
  return min >= 0 && max <= 600;
}

/**
 * Compute histogram of values with a fixed number of bins.
 *
 * @param {number[]} values
 * @param {number} [bins=50]
 * @returns {{ bins: number, counts: number[], edges: number[] }}
 */
export function computeHistogram(values, bins = 50) {
  if (values.length === 0) {
    return { bins: 0, counts: [], edges: [] };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    // Degenerate: all values identical → single bin
    return { bins: 1, counts: [values.length], edges: [min, max + 1] };
  }
  const binWidth = (max - min) / bins;
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    const bin = Math.min(Math.floor((v - min) / binWidth), bins - 1);
    counts[bin]++;
  }
  const edges = Array.from({ length: bins + 1 }, (_, i) => min + i * binWidth);
  return { bins, counts, edges };
}

/**
 * Detect breakpoints in a histogram by finding sharp density transitions.
 * A breakpoint is the edge value where a non-empty bin follows an empty bin
 * (or vice versa), or where the count derivative has a large magnitude.
 *
 * @param {{ bins: number, counts: number[], edges: number[] }} histogram
 * @returns {number[]} detected breakpoint edge values
 */
export function detectBreakpoints(histogram) {
  const { counts, edges } = histogram;
  if (counts.length < 2) return [];

  const breakpoints = [];
  for (let i = 1; i < counts.length; i++) {
    const prev = counts[i - 1];
    const curr = counts[i];
    // Sharp transition: from empty to non-empty or vice versa
    if ((prev === 0 && curr > 0) || (prev > 0 && curr === 0)) {
      breakpoints.push(edges[i]);
    }
  }
  return breakpoints;
}

/**
 * Check whether detected breakpoints cluster near known regulatory table values.
 * Uses a 10% relative tolerance.
 *
 * @param {number[]} breakpoints - detected breakpoint values
 * @param {Array<{ name: string, breakpoints: number[] }>} tables
 * @returns {{ matched: boolean, table_name: string|null }}
 */
export function matchRegulatoryTable(breakpoints, tables) {
  if (breakpoints.length === 0) return { matched: false, table_name: null };

  for (const table of tables) {
    const tableBreaks = table.breakpoints;
    let matchCount = 0;
    for (const bp of breakpoints) {
      for (const tbp of tableBreaks) {
        const tol = Math.abs(tbp) * 0.10 + 1; // 10% + absolute floor of 1
        if (Math.abs(bp - tbp) <= tol) {
          matchCount++;
          break;
        }
      }
    }
    // Match if at least 2 detected breakpoints align with a table, or if all
    // detected breakpoints (when < 2) align with the table.
    const threshold = Math.min(2, breakpoints.length);
    if (matchCount >= threshold) {
      return { matched: true, table_name: table.name };
    }
  }
  return { matched: false, table_name: null };
}

/**
 * Compute percentile-based statistical thresholds.
 *
 * @param {number[]} values
 * @returns {{ p95: number, p99: number, sigma3: number }}
 */
export function computePercentileThresholds(values) {
  if (values.length === 0) return { p95: 0, p99: 0, sigma3: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const p95 = sorted[Math.floor(n * 0.95)] ?? sorted[n - 1];
  const p99 = sorted[Math.floor(n * 0.99)] ?? sorted[n - 1];
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const sigma3 = mean + 3 * Math.sqrt(variance);
  return { p95, p99, sigma3 };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify the threshold type of a normalized event stream.
 *
 * Classification uses structural heuristics (stream count, value range).
 * The module-level `REGULATORY_TABLES` constant is pre-loaded but not yet
 * consulted in this function — it is staged for Sprint 5 selector rules,
 * where breakpoint matching will inform template parameter generation
 * (e.g. threshold values for threshold_gate templates).
 *
 * @param {import('../ingester/generic.js').NormalizedEvent[]} events
 * @returns {{ type: string, [key: string]: any }}
 */
export function classifyThresholds(events) {
  if (events.length === 0) {
    return { type: 'statistical' };
  }

  const streamIndices = new Set(
    events.map(e => e.metadata?.stream_index).filter(v => v !== undefined && v !== null)
  );

  // ── Multi-stream → regulatory ─────────────────────────────────────────────
  // When a feed combines multiple official/regulated sources (CORONA = satellite +
  // space weather agencies; BREATH = PurpleAir + EPA AirNow), the threshold
  // framework is regulatory by definition. Multi-source feeds are assembled by
  // agencies that operate under regulatory thresholds.
  if (streamIndices.size >= 2) {
    return { type: 'regulatory', stream_count: streamIndices.size };
  }

  // ── Single-stream: check value range ─────────────────────────────────────
  const values = events
    .map(e => e.value)
    .filter(v => typeof v === 'number' && Number.isFinite(v));

  if (values.length > 0 && isRegulatedRange(values)) {
    // Values fall within a known regulatory range → regulatory
    return { type: 'regulatory' };
  }

  // ── Single-stream unbounded → statistical ─────────────────────────────────
  // Feeds with unbounded values (earthquake significance scores, raw sensor
  // readings without regulatory standard) use statistical thresholds derived
  // from the data distribution (percentiles, z-scores, anomaly detection).
  return { type: 'statistical' };
}
