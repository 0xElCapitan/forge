/**
 * src/theatres/threshold-gate.js
 * Generalized threshold gate theatre — binary prediction market for threshold crossings.
 *
 * Generalized from: TREMOR MagGate, CORONA FlareGate/GeomagGate/CMEArrivalGate,
 *                   BREATH AQIGate.
 *
 * Theatre lifecycle: create → process (per evidence bundle) → expire
 *
 * Params:
 *   threshold         {number|string|null} - crossing threshold; null = bundle.value is probability
 *   window_hours      {number}             - market duration in hours
 *   base_rate         {number|null}        - prior probability (default: 0.5)
 *   input_mode        {'single'|'multi'}   - single source or multi-source aggregation
 *   threshold_type    {string|null}        - 'regulatory'|'statistical'|'physical'
 *   settlement_source {string|null}        - source ID authorised to settle this theatre
 *
 * EvidenceBundle contract:
 *   { value, timestamp, doubt_price, quality, evidence_class, sources? }
 *   sources: Array<{ value, doubt_price }> — required for input_mode='multi'
 *
 * @module theatres/threshold-gate
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute the probability that the true measurement exceeds `threshold`.
 *
 * - threshold null  : bundle.value is already a probability in [0, 1]
 * - threshold number: step function adjusted for doubt (uncertainty)
 * - threshold string: categorical equality check adjusted for doubt
 *
 * @param {number}          value       - primary measurement
 * @param {number|string|null} threshold
 * @param {number}          doubt_price - 0–1, measurement uncertainty
 * @returns {number} probability in [0, 1]
 */
function crossingProbability(value, threshold, doubt_price) {
  if (threshold === null) {
    return Math.max(0, Math.min(1, value));
  }

  const crossed = typeof threshold === 'number'
    ? value >= threshold
    : String(value) === String(threshold);  // categorical (e.g. 'M1.0')

  // Crossed: high probability, discounted by half the doubt.
  // Not crossed: low residual probability equal to half the doubt.
  return crossed
    ? (1 - doubt_price / 2)
    : (doubt_price / 2);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ThresholdGateTheatre
 * @property {'threshold_gate'} template
 * @property {Object}           params
 * @property {'open'|'resolved'|'expired'} status
 * @property {number}           created_at      - unix ms
 * @property {number}           expires_at      - unix ms
 * @property {number}           position_probability - 0–1
 * @property {Array<{timestamp: number, probability: number}>} position_history
 * @property {null|Object}      resolution
 */

/**
 * Create a new threshold gate theatre.
 *
 * @param {Object} params
 * @param {Object} [opts]
 * @param {number} [opts.now=Date.now()]  - injectable clock for testing
 * @returns {ThresholdGateTheatre}
 */
export function createThresholdGate(params, { now = Date.now() } = {}) {
  const window_ms = (params.window_hours ?? 24) * 3_600_000;
  return {
    template: 'threshold_gate',
    params,
    status: 'open',
    created_at: now,
    expires_at: now + window_ms,
    position_probability: params.base_rate ?? 0.5,
    position_history: [],
    resolution: null,
  };
}

/**
 * Process an evidence bundle and update the theatre's position probability.
 *
 * For `input_mode='multi'`: expects `bundle.sources` array; falls back to
 * single-source if absent.
 *
 * @param {ThresholdGateTheatre}  theatre
 * @param {Object}                bundle
 * @param {number}                bundle.value
 * @param {number}                [bundle.timestamp=Date.now()]
 * @param {number}                [bundle.doubt_price=0]
 * @param {Array}                 [bundle.sources]
 * @returns {ThresholdGateTheatre}
 */
export function processThresholdGate(theatre, bundle) {
  if (theatre.status !== 'open') return theatre;

  const { threshold, input_mode } = theatre.params;
  const ts = bundle.timestamp ?? Date.now();

  let probability;

  if (input_mode === 'multi' && Array.isArray(bundle.sources) && bundle.sources.length > 0) {
    // Average crossing probabilities across all sources.
    const sum = bundle.sources.reduce(
      (acc, s) => acc + crossingProbability(s.value, threshold, s.doubt_price ?? 0),
      0,
    );
    probability = sum / bundle.sources.length;
  } else {
    probability = crossingProbability(bundle.value, threshold, bundle.doubt_price ?? 0);
  }

  probability = Math.max(0, Math.min(1, probability));

  return {
    ...theatre,
    position_probability: probability,
    position_history: [...theatre.position_history, { timestamp: ts, probability }],
  };
}

/**
 * Expire the theatre at window close without a definitive resolution.
 *
 * @param {ThresholdGateTheatre} theatre
 * @param {Object} [opts]
 * @param {number} [opts.now=Date.now()]
 * @returns {ThresholdGateTheatre}
 */
export function expireThresholdGate(theatre, { now = Date.now() } = {}) {
  if (theatre.status !== 'open') return theatre;
  return {
    ...theatre,
    status: 'expired',
    resolution: {
      outcome: null,
      settled_at: now,
      settlement_class: 'expired',
    },
  };
}

/**
 * Resolve the theatre with a definitive outcome (e.g. from oracle confirmation).
 *
 * @param {ThresholdGateTheatre} theatre
 * @param {boolean}              outcome      - true = threshold was crossed
 * @param {string}               [settlement_class='oracle']
 * @param {Object}               [opts]
 * @param {number}               [opts.now=Date.now()]
 * @returns {ThresholdGateTheatre}
 */
export function resolveThresholdGate(theatre, outcome, settlement_class = 'oracle', { now = Date.now() } = {}) {
  if (theatre.status !== 'open') return theatre;
  return {
    ...theatre,
    status: 'resolved',
    position_probability: outcome ? 1 : 0,
    resolution: {
      outcome,
      settled_at: now,
      settlement_class,
    },
  };
}
