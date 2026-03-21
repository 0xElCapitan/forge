/**
 * src/classifier/cadence.js
 * Q1: Cadence Classifier — analyzes the timing pattern of a NormalizedEvent stream.
 *
 * Classifications:
 *   seconds      — median_delta < 60s
 *   minutes      — 60s ≤ median_delta < 3600s
 *   hours        — 3600s ≤ median_delta < 86400s
 *   days         — median_delta ≥ 86400s
 *   event_driven — jitter_coefficient (stdev/median) > 2.0
 *   multi_cadence — bimodal/multimodal delta histogram (multiple stream indices present)
 *
 * @module classifier/cadence
 */

/**
 * Compute consecutive timestamp differences in milliseconds.
 * @param {import('../ingester/generic.js').NormalizedEvent[]} events - sorted by timestamp
 * @returns {number[]}
 */
export function computeDeltas(events) {
  const deltas = [];
  for (let i = 1; i < events.length; i++) {
    const d = events[i].timestamp - events[i - 1].timestamp;
    if (d >= 0) deltas.push(d); // skip negative (already sorted, but guard)
  }
  return deltas;
}

/**
 * Compute the median of a number array.
 * @param {number[]} nums
 * @returns {number}
 */
export function computeMedian(nums) {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Compute standard deviation of a number array.
 * @param {number[]} nums
 * @returns {number}
 */
function computeStddev(nums) {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((s, x) => s + (x - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

/**
 * Compute jitter coefficient = stdev / median.
 * Returns 0 if median is 0.
 * @param {number[]} deltas
 * @returns {number}
 */
export function computeJitterCoefficient(deltas) {
  if (deltas.length === 0) return 0;
  const median = computeMedian(deltas);
  if (median === 0) return 0;
  return computeStddev(deltas) / median;
}

/**
 * Detect if a delta array is bimodal (two clearly separated clusters).
 * Uses a simple histogram approach: find if there are two peaks separated
 * by a valley where the valley count < min(peak1, peak2) / 2.
 *
 * @param {number[]} deltas
 * @returns {{ isBimodal: boolean, peaks: number[] }}
 */
export function detectBimodal(deltas) {
  if (deltas.length < 4) return { isBimodal: false, peaks: [] };

  const sorted = [...deltas].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (max === min) return { isBimodal: false, peaks: [] };

  const BINS = 20;
  const binWidth = (max - min) / BINS;
  const counts = new Array(BINS).fill(0);
  for (const d of sorted) {
    const bin = Math.min(Math.floor((d - min) / binWidth), BINS - 1);
    counts[bin]++;
  }

  // Find local maxima (simple: a bin is a peak if it's > both neighbors)
  const peaks = [];
  for (let i = 1; i < BINS - 1; i++) {
    if (counts[i] > counts[i - 1] && counts[i] > counts[i + 1]) {
      peaks.push({ bin: i, count: counts[i], value: min + (i + 0.5) * binWidth });
    }
  }
  // Also check edges
  if (counts[0] > counts[1]) peaks.unshift({ bin: 0, count: counts[0], value: min + 0.5 * binWidth });
  if (counts[BINS - 1] > counts[BINS - 2]) peaks.push({ bin: BINS - 1, count: counts[BINS - 1], value: min + (BINS - 0.5) * binWidth });

  // Sort peaks by count desc
  peaks.sort((a, b) => b.count - a.count);

  if (peaks.length < 2) return { isBimodal: false, peaks: [] };

  // Check if top 2 peaks are separated by > 2× the smaller peak value
  const p1 = peaks[0];
  const p2 = peaks[1];
  const smallerPeak = Math.min(p1.value, p2.value);
  const largerPeak = Math.max(p1.value, p2.value);

  const isBimodal = largerPeak > 2 * smallerPeak;

  return {
    isBimodal,
    peaks: isBimodal ? [smallerPeak, largerPeak] : [],
  };
}

/**
 * Classify the cadence of a normalized event stream.
 *
 * @param {import('../ingester/generic.js').NormalizedEvent[]} events
 * @returns {import('../ingester/generic.js').CadenceProfile}
 */
export function classifyCadence(events) {
  if (events.length < 2) {
    return { classification: 'event_driven', median_ms: 0, jitter_coefficient: 0 };
  }

  // Sort events by timestamp ascending (GeoJSON arrives in descending order)
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  // ── Multi-cadence detection ───────────────────────────────────────────────
  // If events carry stream_index metadata and there are ≥2 distinct stream indices,
  // the feed is multi_cadence by definition (multiple streams with different cadences).
  const streamIndices = new Set(
    sorted.map(e => e.metadata?.stream_index).filter(v => v !== undefined && v !== null)
  );
  if (streamIndices.size >= 2) {
    // Compute per-stream median deltas to describe the streams
    const streamDeltas = {};
    for (const idx of streamIndices) {
      const streamEvents = sorted.filter(e => e.metadata?.stream_index === idx);
      if (streamEvents.length >= 2) {
        streamDeltas[idx] = computeMedian(computeDeltas(streamEvents));
      }
    }

    // Format stream descriptions as sorted cadence labels
    const streamLabels = Object.values(streamDeltas)
      .sort((a, b) => a - b)
      .map(ms => {
        if (ms < 60000) return `${Math.round(ms / 1000)}s`;
        if (ms < 3600000) return `${Math.round(ms / 60000)}min`;
        if (ms < 86400000) return `${Math.round(ms / 3600000)}hr`;
        return `${Math.round(ms / 86400000)}day`;
      });

    const overallDeltas = computeDeltas(sorted);
    const overallMedian = computeMedian(overallDeltas);

    return {
      classification: 'multi_cadence',
      median_ms: overallMedian,
      streams: streamLabels,
    };
  }

  // ── Single-stream cadence ─────────────────────────────────────────────────
  const deltas = computeDeltas(sorted);
  if (deltas.length === 0) {
    return { classification: 'event_driven', median_ms: 0, jitter_coefficient: 0 };
  }

  const median = computeMedian(deltas);
  const jitter = computeJitterCoefficient(deltas);

  // event_driven: high jitter coefficient OR large max/min ratio (sparse events)
  // Primary: stdev/median > 2.0 (PRD spec threshold)
  // Secondary: max_delta/min_delta > 5.0 AND jitter > 0.5 (catches sparse seismic/event feeds
  //   with small n where CV doesn't fully capture the irregularity)
  const nonZeroDeltas = deltas.filter(d => d > 0);
  const maxDelta = nonZeroDeltas.length > 0 ? Math.max(...nonZeroDeltas) : 0;
  const minDelta = nonZeroDeltas.length > 0 ? Math.min(...nonZeroDeltas) : 0;
  const rangeRatio = minDelta > 0 ? maxDelta / minDelta : 0;

  if (jitter > 2.0 || (rangeRatio > 5.0 && jitter > 0.5)) {
    return {
      classification: 'event_driven',
      median_ms: median,
      jitter_coefficient: jitter,
    };
  }

  // Regular cadence — classify by median interval
  let classification;
  if (median < 60_000) {
    classification = 'seconds';
  } else if (median < 3_600_000) {
    classification = 'minutes';
  } else if (median < 86_400_000) {
    classification = 'hours';
  } else {
    classification = 'days';
  }

  return {
    classification,
    median_ms: median,
    jitter_coefficient: jitter,
  };
}
