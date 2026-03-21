/**
 * src/composer/compose.js
 * Temporal alignment, causal ordering, and Theatre composition for feed pairs.
 *
 * Loop 5: full composition — classify two feeds, align them temporally, detect
 * causal ordering, then propose the Theatre that neither feed would generate alone.
 * Canonical case: PurpleAir AQI + wind direction → smoke plume arrival theatre.
 *
 * Three composition rules (evaluated in order, first match wins):
 *   1. threshold_with_arrival_predictor — bounded regulatory feed + continuous predictor, B leads A
 *   2. co_bounded_divergence            — two bounded feeds, concurrent, ≥5 aligned pairs
 *   3. cascade_amplifier                — spike-driven feed + bounded feed, B leads A
 *
 * @module composer/compose
 */

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Temporally align two event streams within a sliding window.
 *
 * For each event in eventsA, finds the nearest event in eventsB whose
 * timestamp is within ±windowMs. Returns matched pairs only.
 *
 * @param {Array<{timestamp: number, value: number}>} eventsA - Primary feed events
 * @param {Array<{timestamp: number, value: number}>} eventsB - Secondary feed events
 * @param {number} windowMs - Maximum timestamp difference for a valid pairing (ms)
 * @returns {Array<{a: Object, b: Object}>} Aligned pairs
 */
export function alignFeeds(eventsA, eventsB, windowMs) {
  if (!Array.isArray(eventsA) || !Array.isArray(eventsB)) return [];
  if (eventsB.length === 0) return [];

  const pairs = [];
  for (const a of eventsA) {
    // Find the nearest event in B within the window
    let bestMatch = null;
    let bestDiff  = Infinity;
    for (const b of eventsB) {
      const diff = Math.abs(a.timestamp - b.timestamp);
      if (diff <= windowMs && diff < bestDiff) {
        bestMatch = b;
        bestDiff  = diff;
      }
    }
    if (bestMatch !== null) {
      pairs.push({ a, b: bestMatch });
    }
  }
  return pairs;
}

/**
 * Detect the causal ordering (leading/lagging) between two feed streams.
 *
 * Uses the mean timestamp offset across aligned pairs to determine which
 * feed tends to lead the other. A positive mean offset (A.timestamp > B.timestamp)
 * means B leads A; negative means A leads B. Near-zero means concurrent.
 *
 * @param {Array<{a: {timestamp: number}, b: {timestamp: number}}>} pairs - Output of alignFeeds
 * @returns {{ leader: 'A'|'B'|'concurrent', lag_ms: number }}
 *   leader: which feed's events tend to occur first
 *   lag_ms: approximate average lead time in milliseconds
 */
export function detectCausalOrdering(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return { leader: 'concurrent', lag_ms: 0 };
  }

  // Mean of (a.timestamp - b.timestamp):
  //   positive → B precedes A on average → B leads
  //   negative → A precedes B on average → A leads
  const diffs    = pairs.map(p => p.a.timestamp - p.b.timestamp);
  const mean_diff = diffs.reduce((s, d) => s + d, 0) / diffs.length;

  // Threshold: < 1 second is considered concurrent
  const CONCURRENT_THRESHOLD_MS = 1_000;

  if (Math.abs(mean_diff) < CONCURRENT_THRESHOLD_MS) {
    return { leader: 'concurrent', lag_ms: 0 };
  }

  return {
    leader: mean_diff > 0 ? 'B' : 'A',
    lag_ms: Math.round(Math.abs(mean_diff)),
  };
}

/**
 * Propose a Theatre template from two classified feeds and their temporal relationship.
 *
 * Evaluates three composition rules in order and returns the first match.
 * Returns null if no composition opportunity is found.
 *
 * Rules (evaluated in order, first match wins):
 *
 *   1. threshold_with_arrival_predictor
 *      feedA is bounded_numeric + regulatory AND feedB is a continuous feed (seconds/minutes)
 *      AND causal ordering shows B leads A.
 *      → threshold_gate with arrival_window_ms derived from lag_ms.
 *      Canonical case: PurpleAir AQI + wind direction → smoke plume arrival theatre.
 *
 *   2. co_bounded_divergence
 *      Both feeds are bounded_numeric, ordering is concurrent, ≥5 aligned pairs available.
 *      → divergence market between the two feeds.
 *
 *   3. cascade_amplifier
 *      feedA is spike_driven AND feedB is bounded_numeric AND B leads A.
 *      → cascade with window_hours = ceil(lag_ms / 1h) × 2.
 *
 * @param {Object} feedProfileA - Classified feed profile (output of classify())
 * @param {Object} feedProfileB - Classified feed profile (output of classify())
 * @param {Array}  alignedPairs - Output of alignFeeds(A, B, windowMs)
 * @param {{ leader: 'A'|'B'|'concurrent', lag_ms: number }} causalOrder
 * @returns {Object|null} Proposal object (compatible with Proposal from selector) or null
 * @throws {TypeError} If feedProfileA/B are not valid profiles or causalOrder is malformed
 */
export function proposeComposedTheatre(feedProfileA, feedProfileB, alignedPairs, causalOrder) {
  // ─── Guard clauses ────────────────────────────────────────────────────────────

  if (!feedProfileA || typeof feedProfileA !== 'object') {
    throw new TypeError('feedProfileA must be a FeedProfile object');
  }
  if (!feedProfileB || typeof feedProfileB !== 'object') {
    throw new TypeError('feedProfileB must be a FeedProfile object');
  }
  if (!feedProfileA.distribution || !feedProfileA.cadence ||
      !feedProfileA.noise       || !feedProfileA.thresholds) {
    throw new TypeError('feedProfileA must have distribution, cadence, noise, and thresholds fields');
  }
  if (!feedProfileB.distribution || !feedProfileB.cadence ||
      !feedProfileB.noise       || !feedProfileB.thresholds) {
    throw new TypeError('feedProfileB must have distribution, cadence, noise, and thresholds fields');
  }
  if (!Array.isArray(alignedPairs)) {
    throw new TypeError('alignedPairs must be an array');
  }
  if (!causalOrder ||
      typeof causalOrder.leader !== 'string' ||
      typeof causalOrder.lag_ms !== 'number') {
    throw new TypeError('causalOrder must have leader (string) and lag_ms (number) fields');
  }

  const { leader, lag_ms } = causalOrder;

  // ─── Rule 1: threshold_with_arrival_predictor ─────────────────────────────────
  //
  // A bounded regulatory feed (A) paired with a continuous directional / velocity
  // feed (B) that leads A. The lag provides the arrival window.
  //
  // Conditions:
  //   feedA: distribution=bounded_numeric, thresholds=regulatory
  //   feedB: cadence=seconds|minutes (continuous), distribution=bounded_numeric
  //   causal: B leads A, non-zero lag

  if (
    feedProfileA.distribution.type === 'bounded_numeric'   &&
    feedProfileA.thresholds.type   === 'regulatory'        &&
    (feedProfileB.cadence.classification === 'seconds' ||
     feedProfileB.cadence.classification === 'minutes')    &&
    feedProfileB.distribution.type === 'bounded_numeric'   &&
    leader === 'B'                                         &&
    lag_ms  >  0
  ) {
    const window_hours = Math.ceil(lag_ms / 3_600_000);
    return {
      template:  'threshold_gate',
      params: {
        threshold:         null,       // caller supplies domain threshold
        window_hours,
        arrival_window_ms: lag_ms,
        base_rate:         null,
        input_mode:        'multi',    // two-feed composition is always multi-input
        threshold_type:    'regulatory',
        settlement_source: null,       // caller must supply T0/T1 source
      },
      confidence: 0.78,
      composition_basis: {
        feed_a_role:   'threshold_target',
        feed_b_role:   'arrival_predictor',
        causal_leader: 'B',
        lag_ms,
        rule_fired:    'threshold_with_arrival_predictor',
      },
    };
  }

  // ─── Rule 2: co_bounded_divergence ───────────────────────────────────────────
  //
  // Two bounded feeds arriving at similar cadence (concurrent ordering).
  // Sufficient aligned pair overlap enables a divergence market.
  //
  // Conditions:
  //   feedA: distribution=bounded_numeric
  //   feedB: distribution=bounded_numeric
  //   causal: concurrent
  //   alignedPairs: ≥5 (enough temporal overlap for a meaningful market)

  if (
    feedProfileA.distribution.type === 'bounded_numeric' &&
    feedProfileB.distribution.type === 'bounded_numeric' &&
    leader === 'concurrent'                              &&
    alignedPairs.length >= 5
  ) {
    return {
      template:  'divergence',
      params: {
        source_a_type:        'feed_a',
        source_b_type:        'feed_b',
        divergence_threshold: null,
        resolution_mode:      'expiry',
      },
      confidence: 0.65,
      composition_basis: {
        feed_a_role:   'divergence_source_a',
        feed_b_role:   'divergence_source_b',
        causal_leader: 'concurrent',
        lag_ms:        0,
        rule_fired:    'co_bounded_divergence',
      },
    };
  }

  // ─── Rule 3: cascade_amplifier ───────────────────────────────────────────────
  //
  // A spike-driven feed (A) paired with a bounded feed (B) that leads A.
  // The bounded feed acts as an early-warning amplifier for cascade events.
  //
  // Conditions:
  //   feedA: noise=spike_driven
  //   feedB: distribution=bounded_numeric
  //   causal: B leads A, non-zero lag

  if (
    feedProfileA.noise.classification === 'spike_driven'  &&
    feedProfileB.distribution.type    === 'bounded_numeric' &&
    leader === 'B'                                         &&
    lag_ms  >  0
  ) {
    const window_hours = Math.ceil(lag_ms / 3_600_000) * 2;
    return {
      template:  'cascade',
      params: {
        trigger_threshold: null,
        bucket_count:      5,
        window_hours,
        prior_model:       null,
      },
      confidence: 0.60,
      composition_basis: {
        feed_a_role:   'cascade_trigger',
        feed_b_role:   'cascade_amplifier',
        causal_leader: 'B',
        lag_ms,
        rule_fired:    'cascade_amplifier',
      },
    };
  }

  return null;
}
