/**
 * src/theatres/divergence.js
 * Generalized divergence theatre — binary prediction market for source disagreement.
 *
 * Generalized from: TREMOR OracleDivergence, CORONA SolarWindDivergence,
 *                   BREATH SensorDivergence.
 *
 * Theatre lifecycle: create → process (per bundle from source A or B) → expire/resolve
 *
 * Binary question: "Will source A and source B diverge beyond the threshold?"
 *
 * Params:
 *   source_a_type      {string}        - identifier for source A role
 *   source_b_type      {string}        - identifier for source B role
 *   divergence_threshold {number|null} - |A - B| magnitude that counts as divergence;
 *                                        null = use relative normalised difference
 *   resolution_mode    {'self-resolving'|'expiry'} - how the market closes
 *
 * EvidenceBundle: { source_id, value, timestamp, doubt_price }
 *   source_id must be either the source_a_type or source_b_type string.
 *   If source_id is absent, bundle is treated as source A.
 *
 * @module theatres/divergence
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute divergence probability from the current source readings.
 *
 * @param {number}        a_value
 * @param {number}        b_value
 * @param {number|null}   divergence_threshold
 * @param {number}        doubt_price - highest doubt across both readings
 * @returns {number} 0–1
 */
function divergenceProbability(a_value, b_value, divergence_threshold, doubt_price) {
  const diff = Math.abs(a_value - b_value);

  if (divergence_threshold !== null) {
    const crossed = diff >= divergence_threshold;
    return crossed
      ? (1 - doubt_price / 2)
      : (doubt_price / 2);
  }

  // threshold = null: normalised relative difference.
  const scale = Math.max(Math.abs(a_value), Math.abs(b_value), 1);
  return Math.min(1, diff / scale);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} DivergenceTheatre
 * @property {'divergence'} template
 * @property {Object}       params
 * @property {'open'|'resolved'|'expired'} status
 * @property {number}       created_at
 * @property {number}       expires_at
 * @property {number}       position_probability - 0–1 (P(divergence))
 * @property {{value: number, timestamp: number}|null} source_a_latest
 * @property {{value: number, timestamp: number}|null} source_b_latest
 * @property {Array<{timestamp: number, probability: number}>} position_history
 * @property {null|Object}  resolution
 */

/**
 * Create a new divergence theatre.
 *
 * @param {Object} params
 * @param {Object} [opts]
 * @param {number} [opts.now=Date.now()]
 * @returns {DivergenceTheatre}
 */
export function createDivergence(params, { now = Date.now() } = {}) {
  const window_ms = (params.window_hours ?? 48) * 3_600_000;
  return {
    template: 'divergence',
    params,
    status: 'open',
    created_at: now,
    expires_at: now + window_ms,
    position_probability: 0.5,
    source_a_latest: null,
    source_b_latest: null,
    position_history: [],
    resolution: null,
  };
}

/**
 * Process an evidence bundle from either source A or source B.
 *
 * Updates the relevant source reading and recomputes divergence probability.
 * For `self-resolving` mode: if both sources have been seen and probability
 * drops below 0.1, the theatre auto-resolves with outcome false (converged).
 *
 * @param {DivergenceTheatre} theatre
 * @param {Object}            bundle
 * @param {number}            bundle.value
 * @param {string}            [bundle.source_id]  - source_a_type or source_b_type
 * @param {number}            [bundle.timestamp=Date.now()]
 * @param {number}            [bundle.doubt_price=0]
 * @returns {DivergenceTheatre}
 */
export function processDivergence(theatre, bundle) {
  if (theatre.status !== 'open') return theatre;

  const { source_a_type, source_b_type, divergence_threshold, resolution_mode } = theatre.params;
  const ts = bundle.timestamp ?? Date.now();
  const doubt = bundle.doubt_price ?? 0;

  // Route bundle to source A or B.
  const is_b = bundle.source_id === source_b_type;
  const source_a_latest = is_b
    ? theatre.source_a_latest
    : { value: bundle.value, timestamp: ts };
  const source_b_latest = is_b
    ? { value: bundle.value, timestamp: ts }
    : theatre.source_b_latest;

  // Recompute probability only when both sources have readings.
  let probability = theatre.position_probability;
  if (source_a_latest !== null && source_b_latest !== null) {
    probability = divergenceProbability(
      source_a_latest.value,
      source_b_latest.value,
      divergence_threshold,
      doubt,
    );
  }

  let updated = {
    ...theatre,
    source_a_latest,
    source_b_latest,
    position_probability: probability,
    position_history: [...theatre.position_history, { timestamp: ts, probability }],
  };

  // Self-resolving: auto-close when sources converge (P < 0.1, both seen).
  if (
    resolution_mode === 'self-resolving' &&
    source_a_latest !== null &&
    source_b_latest !== null &&
    probability < 0.1
  ) {
    updated = resolveDivergence(updated, false, 'self-resolving', { now: ts });
  }

  return updated;
}

/**
 * Expire the divergence theatre at window close.
 *
 * @param {DivergenceTheatre} theatre
 * @param {Object} [opts]
 * @param {number} [opts.now=Date.now()]
 * @returns {DivergenceTheatre}
 */
export function expireDivergence(theatre, { now = Date.now() } = {}) {
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
 * Resolve the divergence theatre with a definitive outcome.
 *
 * @param {DivergenceTheatre} theatre
 * @param {boolean}           outcome         - true = sources diverged
 * @param {string}            [settlement_class='oracle']
 * @param {Object}            [opts]
 * @param {number}            [opts.now=Date.now()]
 * @returns {DivergenceTheatre}
 */
export function resolveDivergence(theatre, outcome, settlement_class = 'oracle', { now = Date.now() } = {}) {
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
