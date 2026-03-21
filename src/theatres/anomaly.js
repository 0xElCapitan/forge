/**
 * src/theatres/anomaly.js
 * Generalized anomaly theatre — binary prediction market for statistical outliers.
 *
 * Generalized from: TREMOR SwarmWatch (Gutenberg-Richter b-value anomaly).
 *
 * Theatre lifecycle: create → process (per bundle) → expire
 *
 * Binary question: "Is the current measurement anomalously high (z-score > sigma_threshold)?"
 *
 * Params:
 *   baseline_metric {string}        - name of the metric being tracked (for documentation)
 *   sigma_threshold {number|null}   - z-score that triggers anomaly; null → default 2.0
 *   window_hours    {number}        - market duration
 *
 * EvidenceBundle: { value, timestamp, doubt_price }
 *
 * Baseline computation: rolling mean and standard deviation over all observed
 * values so far (up to 200 values retained; older values dropped to bound memory).
 *
 * @module theatres/anomaly
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASELINE_WINDOW = 200;

/** @param {number[]} values @returns {{ mean: number, std: number }} */
function computeStats(values) {
  const n = values.length;
  if (n === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (n === 1) return { mean, std: 0 };
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return { mean, std: Math.sqrt(variance) };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} AnomalyTheatre
 * @property {'anomaly'} template
 * @property {Object}    params
 * @property {'open'|'resolved'|'expired'} status
 * @property {number}    created_at
 * @property {number}    expires_at
 * @property {number}    position_probability - P(anomaly)
 * @property {number[]}  baseline_values      - rolling window of observed values
 * @property {number}    current_zscore       - most recent z-score
 * @property {Array<{timestamp: number, probability: number, zscore: number}>} position_history
 * @property {null|Object} resolution
 */

/**
 * Create a new anomaly theatre.
 *
 * @param {Object} params
 * @param {Object} [opts]
 * @param {number} [opts.now=Date.now()]
 * @returns {AnomalyTheatre}
 */
export function createAnomaly(params, { now = Date.now() } = {}) {
  const window_ms = (params.window_hours ?? 168) * 3_600_000;
  return {
    template: 'anomaly',
    params,
    status: 'open',
    created_at: now,
    expires_at: now + window_ms,
    position_probability: 0.5,
    baseline_values: [],
    current_zscore: 0,
    position_history: [],
    resolution: null,
  };
}

/**
 * Process an evidence bundle. Append the value to the rolling baseline,
 * compute z-score against it, and update position_probability.
 *
 * With fewer than 3 baseline observations the standard deviation is unreliable;
 * probability stays at 0.5 (uninformed prior).
 *
 * @param {AnomalyTheatre} theatre
 * @param {Object}         bundle
 * @param {number}         bundle.value
 * @param {number}         [bundle.timestamp=Date.now()]
 * @param {number}         [bundle.doubt_price=0]
 * @returns {AnomalyTheatre}
 */
export function processAnomaly(theatre, bundle) {
  if (theatre.status !== 'open') return theatre;

  const ts = bundle.timestamp ?? Date.now();
  const doubt = bundle.doubt_price ?? 0;
  const sigma_threshold = theatre.params.sigma_threshold ?? 2.0;

  // Append to rolling baseline (cap at BASELINE_WINDOW entries).
  const baseline_values = [...theatre.baseline_values, bundle.value];
  if (baseline_values.length > BASELINE_WINDOW) baseline_values.shift();

  const { mean, std } = computeStats(baseline_values);

  let probability = 0.5;
  let zscore = 0;

  if (baseline_values.length >= 3 && std > 0) {
    zscore = (bundle.value - mean) / std;
    const anomalous = zscore > sigma_threshold;
    probability = anomalous
      ? (1 - doubt / 2)
      : (doubt / 2);
  }

  return {
    ...theatre,
    baseline_values,
    current_zscore: zscore,
    position_probability: probability,
    position_history: [...theatre.position_history, { timestamp: ts, probability, zscore }],
  };
}

/**
 * Expire the anomaly theatre at window close.
 *
 * @param {AnomalyTheatre} theatre
 * @param {Object} [opts]
 * @param {number} [opts.now=Date.now()]
 * @returns {AnomalyTheatre}
 */
export function expireAnomaly(theatre, { now = Date.now() } = {}) {
  if (theatre.status !== 'open') return theatre;
  return {
    ...theatre,
    status: 'expired',
    resolution: {
      outcome: null,
      peak_zscore: theatre.current_zscore,
      settled_at: now,
      settlement_class: 'expired',
    },
  };
}

/**
 * Resolve the anomaly theatre with a definitive outcome.
 *
 * @param {AnomalyTheatre} theatre
 * @param {boolean}        outcome       - true = anomaly confirmed
 * @param {string}         [settlement_class='oracle']
 * @param {Object}         [opts]
 * @param {number}         [opts.now=Date.now()]
 * @returns {AnomalyTheatre}
 */
export function resolveAnomaly(theatre, outcome, settlement_class = 'oracle', { now = Date.now() } = {}) {
  if (theatre.status !== 'open') return theatre;
  return {
    ...theatre,
    status: 'resolved',
    position_probability: outcome ? 1 : 0,
    resolution: {
      outcome,
      peak_zscore: theatre.current_zscore,
      settled_at: now,
      settlement_class,
    },
  };
}
