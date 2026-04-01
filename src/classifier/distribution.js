/**
 * src/classifier/distribution.js
 * Q2: Distribution Classifier — characterizes the value distribution of a feed.
 *
 * Classifications:
 *   bounded_numeric   — values stay within a stable finite range (e.g., AQI 0-500)
 *   unbounded_numeric — no fixed upper bound; values grow or are theoretically open
 *   categorical       — discrete non-numeric or very-low-cardinality values
 *   composite         — multiple sub-streams with wildly different value scales
 *
 * @module classifier/distribution
 */

/**
 * Compute min and max of a number array.
 * @param {number[]} values
 * @returns {{ min: number, max: number }}
 */
export function computeBounds(values) {
  if (values.length === 0) return { min: 0, max: 0 };
  let min = values[0];
  let max = values[0];
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/**
 * Compute mean of a number array.
 * @param {number[]} values
 * @returns {number}
 */
function computeMean(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Compute rolling max growth coefficient across sub-windows.
 * Detects whether values are unbounded by checking if each rolling maximum
 * significantly exceeds the previous rolling maximum (growth rate > 0.1).
 *
 * @param {number[]} values
 * @returns {number} max growth coefficient (0 = bounded, >0.1 = potentially unbounded)
 */
export function computeMaxGrowthCoefficient(values) {
  if (values.length < 4) return 0;
  const windowSize = Math.max(2, Math.floor(values.length / 4));
  let maxGrowth = 0;
  let prevMax = Math.abs(values[0]);

  for (let i = windowSize; i < values.length; i += windowSize) {
    const window = values.slice(i, i + windowSize);
    const windowMax = Math.max(...window.map(Math.abs));
    if (prevMax > 0) {
      const growth = (windowMax - prevMax) / prevMax;
      if (growth > maxGrowth) maxGrowth = growth;
    }
    prevMax = Math.max(prevMax, windowMax);
  }
  return maxGrowth;
}

/**
 * Detect if values are categorical (very low unique ratio and non-continuous).
 * @param {number[]} values
 * @returns {boolean}
 */
export function detectCategorical(values) {
  if (values.length === 0) return false;
  const unique = new Set(values).size;
  const ratio = unique / values.length;
  // categorical: < 5% unique AND not a continuous range
  if (ratio >= 0.05) return false;
  // Check non-continuous: if sorted gaps are irregular, it's truly categorical
  return true;
}

/**
 * Detect if a multi-stream dataset has composite distribution.
 * Composite means either:
 *   1. Multiple streams with value ranges that differ by ≥ 100× (numeric divergence)
 *   2. At least one categorical stream (no positive numeric values) alongside
 *      at least one numeric stream (categorical-vs-numeric)
 *
 * @param {import('../ingester/generic.js').NormalizedEvent[]} events
 * @param {Set<number>} streamIndices
 * @returns {boolean}
 */
export function detectMultimodal(events, streamIndices) {
  if (streamIndices.size < 2) return false;

  // Compute value range per stream, tracking categorical (non-numeric) streams
  const streamRanges = {};
  const categoricalStreams = new Set();
  for (const idx of streamIndices) {
    const streamEvents = events.filter(e => e.metadata?.stream_index === idx);
    if (streamEvents.length === 0) continue;
    const vals = streamEvents
      .map(e => Math.abs(e.value))
      .filter(v => Number.isFinite(v) && v > 0);
    if (vals.length === 0) {
      // Stream has events but no positive numeric values → categorical
      categoricalStreams.add(idx);
      continue;
    }
    const maxVal = Math.max(...vals);
    const minVal = Math.min(...vals);
    streamRanges[idx] = { min: minVal, max: maxVal };
  }

  const numericStreamCount = Object.keys(streamRanges).length;

  // Categorical-vs-numeric: ≥1 categorical stream + ≥1 numeric stream → composite
  if (categoricalStreams.size > 0 && numericStreamCount > 0) return true;

  const ranges = Object.values(streamRanges);
  if (ranges.length < 2) return false;

  // Compare maximum values across streams: if any pair differs by > 100×, it's composite
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const r1max = ranges[i].max;
      const r2max = ranges[j].max;
      if (r1max === 0 || r2max === 0) continue;
      const ratio = Math.max(r1max, r2max) / Math.min(r1max, r2max);
      if (ratio >= 100) return true;
    }
  }
  return false;
}

/**
 * Classify the distribution of a normalized event stream.
 *
 * @param {import('../ingester/generic.js').NormalizedEvent[]} events
 * @returns {import('../ingester/generic.js').DistributionProfile}
 */
export function classifyDistribution(events) {
  if (events.length === 0) {
    return { type: 'bounded_numeric', bounds: { min: 0, max: 0 } };
  }

  const values = events.map(e => e.value).filter(v => typeof v === 'number' && Number.isFinite(v));
  if (values.length === 0) {
    return { type: 'bounded_numeric', bounds: { min: 0, max: 0 } };
  }

  // ── Multi-stream composite detection ─────────────────────────────────────
  // If events have stream_index metadata from ≥2 streams, check if the
  // streams have wildly different value scales (→ composite).
  const streamIndices = new Set(
    events.map(e => e.metadata?.stream_index).filter(v => v !== undefined && v !== null)
  );

  if (streamIndices.size >= 2) {
    if (detectMultimodal(events, streamIndices)) {
      // Different value scales or categorical-vs-numeric → composite
      const allSubTypes = [];
      for (const idx of streamIndices) {
        const streamEvents = events.filter(e => e.metadata?.stream_index === idx);
        if (streamEvents.length === 0) continue;
        const streamVals = streamEvents
          .map(e => e.value)
          .filter(v => typeof v === 'number' && Number.isFinite(v));
        const positiveVals = streamVals.filter(v => v > 0);
        if (positiveVals.length === 0) {
          // No positive numeric values → categorical sub-stream
          allSubTypes.push('categorical');
          continue;
        }
        const { min, max } = computeBounds(streamVals);
        // Sub-type heuristic per stream
        if (max <= 600 && min >= 0) {
          allSubTypes.push('bounded_numeric');
        } else {
          allSubTypes.push('unbounded_numeric');
        }
      }
      const subTypes = [...new Set(allSubTypes)];
      return {
        type: 'composite',
        sub_types: subTypes.length > 0 ? subTypes : ['bounded_numeric', 'categorical'],
      };
    }
    // Multiple streams but similar value scales → treat as single distribution
    // (will fall through to bounded_numeric / unbounded_numeric logic below)
  }

  // ── Single-stream (or same-scale multi-stream) distribution ───────────────
  const { min, max } = computeBounds(values);

  // Categorical detection: very few unique values
  if (detectCategorical(values)) {
    return { type: 'categorical', bounds: { min, max } };
  }

  // Bounded numeric: all values in [0, 600] range with max ≤ 600
  // This covers AQI (0-500), PM2.5 (0-300), Kp index (0-9), etc.
  if (min >= 0 && max <= 600) {
    return {
      type: 'bounded_numeric',
      bounds: { min, max },
    };
  }

  // Unbounded numeric: values exceed typical bounded ranges
  // or have a meaningful max growth coefficient
  const growthCoeff = computeMaxGrowthCoefficient(values);
  if (max > 600 || growthCoeff > 0.1) {
    return {
      type: 'unbounded_numeric',
      bounds: { min, max },
    };
  }

  // Default: bounded if range is finite and reasonable
  return {
    type: 'bounded_numeric',
    bounds: { min, max },
  };
}
