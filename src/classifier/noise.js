/**
 * src/classifier/noise.js
 * Q3: Noise Classifier — characterizes the noise pattern of a feed's value stream.
 *
 * Classifications:
 *   spike_driven     — occasional high-magnitude events against a quiet baseline
 *                      (earthquake significance, rare solar storms)
 *   mixed            — combination of noise patterns across sub-streams
 *                      (e.g. cyclical background + spike events)
 *   white_noise      — random variation with no spikes or structure
 *   low_noise        — very little variation (near-constant signal)
 *   cyclical         — periodic/sinusoidal variation
 *   trending         — monotonically increasing or decreasing with significant t-stat
 *   stable_with_drift — near-constant with slow drift
 *
 * @module classifier/noise
 */

// ─── Threshold constants ──────────────────────────────────────────────────────

/** Unix epoch ms lower bound — values above this are treated as timestamps, not measurements. */
const TIMESTAMP_THRESHOLD = 1e12;

// ─── Internal helpers ─────────────────────────────────────────────────────────

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
 * Compute standard deviation of a number array.
 * @param {number[]} values
 * @param {number} [mean] - precomputed mean (optional)
 * @returns {number}
 */
function computeStddev(values, mean) {
  if (values.length < 2) return 0;
  const m = mean !== undefined ? mean : computeMean(values);
  const variance = values.reduce((s, x) => s + (x - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Compute the median of a sorted number array.
 * @param {number[]} sorted - pre-sorted ascending array
 * @returns {number}
 */
function medianFromSorted(sorted) {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Compute spike rate using rolling median and MAD (Median Absolute Deviation).
 * A spike is a value where |value - rolling_median| > 2 × rolling_MAD.
 *
 * @param {number[]} values
 * @param {number} [window=20] - rolling window size
 * @returns {{ spike_rate: number, spike_count: number }}
 */
export function computeSpikes(values, window = 20) {
  if (values.length < 3) return { spike_rate: 0, spike_count: 0 };

  // For small arrays, use the global median/MAD rather than rolling
  const effectiveWindow = Math.min(window, values.length);
  let spikeCount = 0;

  for (let i = 0; i < values.length; i++) {
    // Window centered around i (or edge-aligned)
    const start = Math.max(0, i - Math.floor(effectiveWindow / 2));
    const end = Math.min(values.length, start + effectiveWindow);
    const windowVals = values.slice(start, end);
    const sorted = [...windowVals].sort((a, b) => a - b);
    const rollingMedian = medianFromSorted(sorted);
    const absDevs = sorted.map(v => Math.abs(v - rollingMedian));
    absDevs.sort((a, b) => a - b);
    const rollingMAD = medianFromSorted(absDevs);

    // MAD threshold: spike if |value - median| > 2 × MAD
    // Guard against zero MAD: when all window values are constant (MAD=0) but the
    // current value is far from the median, use 10% of the median as a floor.
    const effectiveMAD = rollingMAD > 0 ? rollingMAD : rollingMedian * 0.1;
    if (effectiveMAD > 0 && Math.abs(values[i] - rollingMedian) > 2 * effectiveMAD) {
      spikeCount++;
    }
  }

  return {
    spike_rate: spikeCount / values.length,
    spike_count: spikeCount,
  };
}

/**
 * Compute Pearson lag-1 autocorrelation.
 * Measures how much each value predicts the next — high autocorr = persistent/cyclical,
 * near-zero = random/white noise.
 *
 * @param {number[]} values
 * @returns {number} autocorrelation in [-1, 1]
 */
export function computeLag1Autocorr(values) {
  if (values.length < 3) return 0;
  const n = values.length;
  const mean = computeMean(values);
  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n - 1; i++) {
    numerator += (values[i] - mean) * (values[i + 1] - mean);
  }
  for (let i = 0; i < n; i++) {
    denominator += (values[i] - mean) ** 2;
  }

  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Compute the linear trend t-statistic (OLS slope / standard error).
 * Large |t| indicates a meaningful linear trend.
 *
 * @param {number[]} values
 * @returns {number} t-statistic (signed)
 */
export function computeLinearTrendTStat(values) {
  if (values.length < 3) return 0;
  const n = values.length;

  // x = [0, 1, ..., n-1]
  const xMean = (n - 1) / 2;
  const yMean = computeMean(values);

  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - xMean) * (values[i] - yMean);
    sxx += (i - xMean) ** 2;
  }

  if (sxx === 0) return 0;
  const slope = sxy / sxx;

  // Residual standard error
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const predicted = yMean + slope * (i - xMean);
    sse += (values[i] - predicted) ** 2;
  }
  const mse = sse / Math.max(1, n - 2);
  const se = Math.sqrt(mse / sxx);

  if (se === 0) {
    // Perfect linear fit: residuals are zero. Return a large signed value.
    return slope > 0 ? 1e9 : slope < 0 ? -1e9 : 0;
  }
  return slope / se;
}

/**
 * Detect spike-driven noise in a single-stream value array.
 * Uses right-skewness (mean > median) and tail ratio (max vs median).
 * Also accepts MAD-based spike detection as corroborating evidence.
 *
 * @param {number[]} values
 * @returns {boolean}
 */
export function isSpikeDriven(values) {
  if (values.length < 3) return false;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const median = medianFromSorted(sorted);
  const mean = computeMean(values);
  const stddev = computeStddev(values, mean);

  if (median === 0) return false;

  // Right-skewed distribution: mean noticeably above median
  const skewRatio = mean / median;

  // Significant spread relative to magnitude
  const cv = stddev / Math.abs(mean);

  // Tail: max value significantly above the 75th percentile
  const q75 = sorted[Math.floor(n * 0.75)];
  const tailRatio = q75 > 0 ? sorted[n - 1] / q75 : 0;

  // Spike-driven criteria (OR logic — any strong signal wins):
  //   1. Strong right skew (mean > 1.2× median) + any meaningful spread
  //   2. Large tail ratio (max > 1.4× 75th percentile)
  //   3. CV > 0.25 + mean > median (moderate skew + spread)
  return (
    (skewRatio > 1.2 && cv > 0.1) ||
    tailRatio > 1.4 ||
    (cv > 0.25 && mean > median)
  );
}

/**
 * Detect spike-driven noise in inter-event timing deltas.
 * Used when value field contains timestamps (not measurements).
 * Event-driven feeds with irregular timing exhibit spike-driven temporal patterns.
 *
 * @param {number[]} deltas - consecutive timestamp differences in ms
 * @returns {boolean}
 */
export function isTimingSpikeDriven(deltas) {
  if (deltas.length < 3) return false;
  const sorted = [...deltas].sort((a, b) => a - b);
  const n = sorted.length;
  const median = medianFromSorted(sorted);
  const mean = computeMean(deltas);

  if (median === 0) return false;

  // Right-skewed timing: mean > 1.1× median (occasional long gaps = "spikes" in time)
  const skewRatio = mean / median;
  // Large max gap relative to median
  const maxRatio = sorted[n - 1] / median;

  // Spike-driven timing: right-skewed AND max gap is significantly above median
  return skewRatio > 1.1 && maxRatio > 2.0;
}

/**
 * Check if a set of values look like Unix timestamps (not measurements).
 * @param {number[]} values
 * @returns {boolean}
 */
export function isTimestampLike(values) {
  if (values.length === 0) return false;
  // If most values are above the timestamp threshold, treat as timestamps
  const aboveThreshold = values.filter(v => v > TIMESTAMP_THRESHOLD).length;
  return aboveThreshold / values.length > 0.8;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify the noise pattern of a normalized event stream.
 *
 * @param {import('../ingester/generic.js').NormalizedEvent[]} events
 * @returns {{ classification: string, [key: string]: any }}
 */
export function classifyNoise(events) {
  if (events.length < 2) {
    return { classification: 'low_noise' };
  }

  // ── Multi-stream → mixed ──────────────────────────────────────────────────
  // Multiple streams (from combined_object feeds) inherently combine different
  // noise characteristics per stream — classified as mixed without further analysis.
  const streamIndices = new Set(
    events.map(e => e.metadata?.stream_index).filter(v => v !== undefined && v !== null)
  );
  if (streamIndices.size >= 2) {
    return {
      classification: 'mixed',
      stream_count: streamIndices.size,
    };
  }

  // ── Single-stream noise analysis ──────────────────────────────────────────
  const rawValues = events.map(e => e.value).filter(v => Number.isFinite(v));
  if (rawValues.length < 2) return { classification: 'low_noise' };

  // Detect if values are timestamps (ingester may select a timestamp field as highest-variance).
  // In that case, analyze inter-event timing patterns instead of values.
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const deltas = [];
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i].timestamp - sorted[i - 1].timestamp;
    if (d >= 0) deltas.push(d);
  }

  if (isTimestampLike(rawValues)) {
    // Values are timestamps — use timing deltas to detect noise pattern
    if (isTimingSpikeDriven(deltas)) {
      return { classification: 'spike_driven' };
    }
    // Uniform/regular timing → low noise or white noise
    const mean = computeMean(deltas);
    const stddev = computeStddev(deltas, mean);
    const cv = mean > 0 ? stddev / mean : 0;
    if (cv < 0.2) return { classification: 'low_noise' };
    return { classification: 'white_noise' };
  }

  // ── Value-based noise classification ─────────────────────────────────────

  // Spike-driven: right-skewed distribution with high tail values
  if (isSpikeDriven(rawValues)) {
    const { spike_rate } = computeSpikes(rawValues);
    return { classification: 'spike_driven', spike_rate };
  }

  const mean = computeMean(rawValues);
  const stddev = computeStddev(rawValues, mean);
  const cv = mean !== 0 ? stddev / Math.abs(mean) : 0;

  // Low noise: tight distribution relative to mean
  if (cv < 0.15) {
    return { classification: 'low_noise', cv };
  }

  // Trending: strong linear trend (large |t-statistic|)
  const tStat = computeLinearTrendTStat(rawValues);
  if (Math.abs(tStat) > 3.0) {
    return { classification: 'trending', t_stat: tStat };
  }

  // Cyclical: high lag-1 autocorrelation without strong trend
  const lag1 = computeLag1Autocorr(rawValues);
  if (lag1 > 0.7) {
    return { classification: 'cyclical', lag1_autocorr: lag1 };
  }

  // Default: white noise
  return { classification: 'white_noise', cv };
}
