/**
 * src/theatres/cascade.js
 * Generalized cascade theatre — multi-class prediction market for count outcomes.
 *
 * Generalized from: TREMOR AftershockCascade, CORONA ProtonCascade, BREATH WildfireCascade.
 *
 * Theatre lifecycle: create → process (per event above trigger) → expire
 *
 * Resolution: 5 probability buckets for "how many trigger-crossing events
 * will occur in the window?"
 *   Bucket 0: 0 events
 *   Bucket 1: 1–2 events
 *   Bucket 2: 3–5 events
 *   Bucket 3: 6–10 events
 *   Bucket 4: 11+ events
 *
 * Params:
 *   trigger_threshold {number|string} - value that must be met/exceeded to count
 *   bucket_count      {number}        - must be 5
 *   window_hours      {number}        - market duration in hours
 *   prior_model       {'omori'|'wheatland'|'uniform'|null}
 *
 * EvidenceBundle: { value, timestamp, doubt_price }
 *
 * @module theatres/cascade
 */

// ─── Prior distributions ───────────────────────────────────────────────────────

/**
 * Initial 5-bucket probability distribution for each prior model.
 * Indices: [0 events, 1-2, 3-5, 6-10, 11+]
 */
const PRIOR_DISTRIBUTIONS = {
  omori:    [0.15, 0.35, 0.30, 0.15, 0.05],  // Omori decay: front-loaded
  wheatland:[0.25, 0.30, 0.25, 0.15, 0.05],  // ETAS-like: moderate decay
  uniform:  [0.20, 0.20, 0.20, 0.20, 0.20],  // Flat prior
};

/** @param {string|null} model */
function getPrior(model) {
  return [...(PRIOR_DISTRIBUTIONS[model] ?? PRIOR_DISTRIBUTIONS.uniform)];
}

// ─── Poisson helpers ───────────────────────────────────────────────────────────

/**
 * Poisson probability mass function P(X = k | lambda).
 *
 * @param {number} lambda - rate parameter (> 0)
 * @param {number} k      - non-negative integer
 * @returns {number}
 */
function poissonPmf(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k === 0) return Math.exp(-lambda);

  // log P = -lambda + k*ln(lambda) - ln(k!)
  let log_pmf = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) log_pmf -= Math.log(i);
  return Math.exp(log_pmf);
}

/**
 * Compute 5-bucket Poisson probabilities for expected rate `lambda`.
 *
 * @param {number} lambda
 * @returns {[number, number, number, number, number]}
 */
function bucketProbabilities(lambda) {
  const b0 = poissonPmf(lambda, 0);
  const b1 = poissonPmf(lambda, 1) + poissonPmf(lambda, 2);
  const b2 = poissonPmf(lambda, 3) + poissonPmf(lambda, 4) + poissonPmf(lambda, 5);
  let b3 = 0;
  for (let k = 6; k <= 10; k++) b3 += poissonPmf(lambda, k);
  const b4 = Math.max(0, 1 - b0 - b1 - b2 - b3);
  return [b0, b1, b2, b3, b4];
}

/**
 * Check if a value meets the trigger threshold.
 *
 * @param {number|string} value
 * @param {number|string} trigger
 * @returns {boolean}
 */
function meetsTrigger(value, trigger) {
  return typeof trigger === 'number'
    ? value >= trigger
    : String(value) === String(trigger);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} CascadeTheatre
 * @property {'cascade'} template
 * @property {Object}   params
 * @property {'open'|'resolved'|'expired'} status
 * @property {number}   created_at
 * @property {number}   expires_at
 * @property {number}   observed_count
 * @property {[number,number,number,number,number]} position_distribution - sums to 1
 * @property {Array<{timestamp: number, distribution: number[]}>} position_history
 * @property {null|Object} resolution
 */

/**
 * Create a new cascade theatre.
 *
 * @param {Object} params
 * @param {Object} [opts]
 * @param {number} [opts.now=Date.now()]
 * @returns {CascadeTheatre}
 */
export function createCascade(params, { now = Date.now() } = {}) {
  const window_ms = (params.window_hours ?? 72) * 3_600_000;
  return {
    template: 'cascade',
    params,
    status: 'open',
    created_at: now,
    expires_at: now + window_ms,
    observed_count: 0,
    position_distribution: getPrior(params.prior_model),
    position_history: [],
    resolution: null,
  };
}

/**
 * Process an evidence bundle. If bundle.value meets the trigger threshold,
 * increment observed_count and update position_distribution via Bayesian
 * Poisson update blended with the prior.
 *
 * @param {CascadeTheatre} theatre
 * @param {Object}         bundle
 * @param {number|string}  bundle.value
 * @param {number}         [bundle.timestamp=Date.now()]
 * @returns {CascadeTheatre}
 */
export function processCascade(theatre, bundle) {
  if (theatre.status !== 'open') return theatre;

  const { trigger_threshold, window_hours, prior_model } = theatre.params;
  const ts = bundle.timestamp ?? Date.now();

  if (!meetsTrigger(bundle.value, trigger_threshold)) {
    // No new trigger event — no distribution change.
    return theatre;
  }

  const new_count = theatre.observed_count + 1;

  // Bayesian Poisson rate estimate: (observed + 1) / (elapsed_hours + 1) × window_hours.
  // Smoothed to avoid instability at t≈0.
  const elapsed_hours = Math.max(0.1, (ts - theatre.created_at) / 3_600_000);
  const rate = ((new_count + 1) / (elapsed_hours + 1)) * (window_hours ?? 72);
  const poisson_dist = bucketProbabilities(rate);

  // Blend toward prior (30% prior weight) for stability when count is low.
  const prior = getPrior(prior_model);
  const new_dist = poisson_dist.map((p, i) => 0.7 * p + 0.3 * prior[i]);

  // Normalise to ensure sum = 1 (floating-point safety).
  const total = new_dist.reduce((s, v) => s + v, 0);
  const normalised = new_dist.map(v => v / total);

  return {
    ...theatre,
    observed_count: new_count,
    position_distribution: normalised,
    position_history: [...theatre.position_history, { timestamp: ts, distribution: [...normalised] }],
  };
}

/**
 * Expire the cascade theatre at window close.
 *
 * @param {CascadeTheatre} theatre
 * @param {Object} [opts]
 * @param {number} [opts.now=Date.now()]
 * @returns {CascadeTheatre}
 */
export function expireCascade(theatre, { now = Date.now() } = {}) {
  if (theatre.status !== 'open') return theatre;
  return {
    ...theatre,
    status: 'expired',
    resolution: {
      outcome: null,
      observed_count: theatre.observed_count,
      settled_at: now,
      settlement_class: 'expired',
    },
  };
}

/**
 * Resolve the cascade with a definitive observed count.
 *
 * @param {CascadeTheatre} theatre
 * @param {number}         final_count  - actual total events in window
 * @param {string}         [settlement_class='oracle']
 * @param {Object}         [opts]
 * @param {number}         [opts.now=Date.now()]
 * @returns {CascadeTheatre}
 */
export function resolveCascade(theatre, final_count, settlement_class = 'oracle', { now = Date.now() } = {}) {
  if (theatre.status !== 'open') return theatre;
  // Assign outcome bucket.
  const bucket = final_count === 0 ? 0
    : final_count <= 2   ? 1
    : final_count <= 5   ? 2
    : final_count <= 10  ? 3
    : 4;
  const resolved_dist = [0, 0, 0, 0, 0];
  resolved_dist[bucket] = 1;
  return {
    ...theatre,
    status: 'resolved',
    position_distribution: resolved_dist,
    resolution: {
      outcome: final_count,
      outcome_bucket: bucket,
      settled_at: now,
      settlement_class,
    },
  };
}
