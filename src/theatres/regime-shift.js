/**
 * src/theatres/regime-shift.js
 * Generalized regime shift theatre — binary prediction market for state transitions.
 *
 * Generalized from: TREMOR DepthRegime (shallow vs deep subduction zone).
 *
 * Theatre lifecycle: create → process (per evidence bundle) → expire
 *
 * Binary question: "Is the system currently in state A (below boundary)?"
 *
 * Params:
 *   state_boundary {number|null} - value separating state A (below) from state B (above);
 *                                  null = probability fixed at zone_prior
 *   zone_prior     {number|null} - prior P(state A); null defaults to 0.5
 *
 * EvidenceBundle: { value, timestamp, doubt_price }
 *
 * @module theatres/regime-shift
 */

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} RegimeShiftTheatre
 * @property {'regime_shift'} template
 * @property {Object}         params
 * @property {'open'|'resolved'|'expired'} status
 * @property {number}         created_at
 * @property {number}         expires_at
 * @property {number}         position_probability - P(state A)
 * @property {Array<{timestamp: number, probability: number}>} position_history
 * @property {null|Object}    resolution
 */

/**
 * Create a new regime shift theatre.
 *
 * @param {Object} params
 * @param {Object} [opts]
 * @param {number} [opts.now=Date.now()]
 * @returns {RegimeShiftTheatre}
 */
export function createRegimeShift(params, { now = Date.now() } = {}) {
  const window_ms = (params.window_hours ?? 336) * 3_600_000;  // default 14 days
  const prior = params.zone_prior ?? 0.5;
  return {
    template: 'regime_shift',
    params,
    status: 'open',
    created_at: now,
    expires_at: now + window_ms,
    position_probability: prior,
    position_history: [],
    resolution: null,
  };
}

/**
 * Process an evidence bundle and update P(state A).
 *
 * When state_boundary is null (spec params are null — no computable boundary),
 * the probability remains at zone_prior (or 0.5). Otherwise:
 *   - value < boundary → P(state A) = 1 - doubt/2  (likely in state A)
 *   - value ≥ boundary → P(state A) = doubt/2        (likely in state B)
 *
 * @param {RegimeShiftTheatre} theatre
 * @param {Object}             bundle
 * @param {number}             bundle.value
 * @param {number}             [bundle.timestamp=Date.now()]
 * @param {number}             [bundle.doubt_price=0]
 * @returns {RegimeShiftTheatre}
 */
export function processRegimeShift(theatre, bundle) {
  if (theatre.status !== 'open') return theatre;

  const { state_boundary } = theatre.params;
  const ts = bundle.timestamp ?? Date.now();

  // null boundary — no scoreable fields; keep probability at prior.
  if (state_boundary === null) {
    return {
      ...theatre,
      position_history: [...theatre.position_history, {
        timestamp: ts,
        probability: theatre.position_probability,
      }],
    };
  }

  const doubt = bundle.doubt_price ?? 0;
  const in_state_a = bundle.value < state_boundary;
  const probability = in_state_a
    ? (1 - doubt / 2)
    : (doubt / 2);

  return {
    ...theatre,
    position_probability: probability,
    position_history: [...theatre.position_history, { timestamp: ts, probability }],
  };
}

/**
 * Expire the regime shift theatre at window close.
 *
 * @param {RegimeShiftTheatre} theatre
 * @param {Object} [opts]
 * @param {number} [opts.now=Date.now()]
 * @returns {RegimeShiftTheatre}
 */
export function expireRegimeShift(theatre, { now = Date.now() } = {}) {
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
 * Resolve the regime shift theatre with a definitive outcome.
 *
 * @param {RegimeShiftTheatre} theatre
 * @param {boolean}            outcome         - true = system was in state A
 * @param {string}             [settlement_class='oracle']
 * @param {Object}             [opts]
 * @param {number}             [opts.now=Date.now()]
 * @returns {RegimeShiftTheatre}
 */
export function resolveRegimeShift(theatre, outcome, settlement_class = 'oracle', { now = Date.now() } = {}) {
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
