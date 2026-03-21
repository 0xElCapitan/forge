/**
 * src/theatres/persistence.js
 * Generalized persistence theatre — binary prediction market for sustained conditions.
 *
 * Tracks whether a measurement stays above `condition_threshold` for
 * `consecutive_count` consecutive evidence bundles. Auto-resolves with
 * outcome=true when the streak is met.
 *
 * Theatre lifecycle: create → process (per bundle) → auto-resolve on streak | expire
 *
 * Params:
 *   condition_threshold {number} - value that must be met/exceeded each period
 *   consecutive_count   {number} - how many consecutive meetings required
 *   window_hours        {number} - market duration (hard cap)
 *
 * EvidenceBundle: { value, timestamp, doubt_price }
 *
 * @module theatres/persistence
 */

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} PersistenceTheatre
 * @property {'persistence'} template
 * @property {Object}        params
 * @property {'open'|'resolved'|'expired'} status
 * @property {number}        created_at
 * @property {number}        expires_at
 * @property {number}        position_probability - consecutive_seen / consecutive_count
 * @property {number}        consecutive_seen     - current unbroken streak
 * @property {Array<{timestamp: number, probability: number}>} position_history
 * @property {null|Object}   resolution
 */

/**
 * Create a new persistence theatre.
 *
 * @param {Object} params
 * @param {Object} [opts]
 * @param {number} [opts.now=Date.now()]
 * @returns {PersistenceTheatre}
 */
export function createPersistence(params, { now = Date.now() } = {}) {
  const window_ms = (params.window_hours ?? 168) * 3_600_000;  // default 7 days
  return {
    template: 'persistence',
    params,
    status: 'open',
    created_at: now,
    expires_at: now + window_ms,
    position_probability: 0,
    consecutive_seen: 0,
    position_history: [],
    resolution: null,
  };
}

/**
 * Process an evidence bundle. If bundle.value meets condition_threshold,
 * increment streak; otherwise reset to zero. Auto-resolves when streak
 * reaches consecutive_count.
 *
 * @param {PersistenceTheatre} theatre
 * @param {Object}             bundle
 * @param {number}             bundle.value
 * @param {number}             [bundle.timestamp=Date.now()]
 * @returns {PersistenceTheatre}
 */
export function processPersistence(theatre, bundle) {
  if (theatre.status !== 'open') return theatre;

  const { condition_threshold, consecutive_count } = theatre.params;
  const ts = bundle.timestamp ?? Date.now();
  const required = consecutive_count ?? 1;

  const met = bundle.value >= condition_threshold;
  const new_streak = met ? theatre.consecutive_seen + 1 : 0;
  const probability = Math.min(1, new_streak / required);

  const updated = {
    ...theatre,
    consecutive_seen: new_streak,
    position_probability: probability,
    position_history: [...theatre.position_history, { timestamp: ts, probability }],
  };

  // Auto-resolve when streak is complete.
  if (new_streak >= required) {
    return resolvePersistence(updated, true, 'auto', { now: ts });
  }

  return updated;
}

/**
 * Expire the persistence theatre at window close without completing the streak.
 *
 * @param {PersistenceTheatre} theatre
 * @param {Object} [opts]
 * @param {number} [opts.now=Date.now()]
 * @returns {PersistenceTheatre}
 */
export function expirePersistence(theatre, { now = Date.now() } = {}) {
  if (theatre.status !== 'open') return theatre;
  return {
    ...theatre,
    status: 'expired',
    resolution: {
      outcome: false,   // streak was not completed
      consecutive_seen: theatre.consecutive_seen,
      settled_at: now,
      settlement_class: 'expired',
    },
  };
}

/**
 * Resolve the persistence theatre.
 *
 * @param {PersistenceTheatre} theatre
 * @param {boolean}            outcome
 * @param {string}             [settlement_class='oracle']
 * @param {Object}             [opts]
 * @param {number}             [opts.now=Date.now()]
 * @returns {PersistenceTheatre}
 */
export function resolvePersistence(theatre, outcome, settlement_class = 'oracle', { now = Date.now() } = {}) {
  if (theatre.status !== 'open') return theatre;
  return {
    ...theatre,
    status: 'resolved',
    position_probability: outcome ? 1 : 0,
    resolution: {
      outcome,
      consecutive_seen: theatre.consecutive_seen,
      settled_at: now,
      settlement_class,
    },
  };
}
