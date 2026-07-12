/**
 * src/baseline/domain-priors.js
 * Domain-priors structural baseline forecaster (Cycle-003 carry-forward S07,
 * FR-10): per-domain prior probabilities computable from feed history alone —
 * Omori's law for seismic aftershock decay, a Wheatland-style Poisson flare
 * rate for solar. Both are closed-form textbook formulas applied to directly
 * counted, un-fitted structural quantities from the feed window: no numeric
 * optimization, no calibration, no certificate emission, no `scoring.*`
 * population. Output is a baseline prediction for comparison/validation only.
 *
 * Resolution-independent: neither formula assumes a domain-specific field
 * name. Both operate on the generic `value`/`timestamp` NormalizedEvent
 * contract, matching FR-10's "resolution-independent" framing.
 *
 * @module baseline/domain-priors
 */

/**
 * @typedef {import('../ingester/generic.js').NormalizedEvent} NormalizedEvent
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Omori-law aftershock-decay prior: n(t) = K / (t + c)^p, where t is elapsed
 * days since a reference event. The reference event is the structural
 * analogue of a "mainshock" — the event with the largest `value` in the
 * window. `K` is a direct count, not a fitted/optimized parameter: the number
 * of events observed within the first `c`-day window after the reference
 * event.
 *
 * @param {NormalizedEvent[]} events - feed window
 * @param {Object} [opts]
 * @param {number} [opts.c=1] - Omori time-offset constant, in days
 * @param {number} [opts.p=1] - Omori decay exponent
 * @param {number[]} [opts.horizonsDays=[1, 2, 3, 7]] - forecast horizons, in
 *   days after the reference event
 * @returns {{
 *   reference_timestamp: number|null,
 *   K: number,
 *   c: number,
 *   p: number,
 *   predictions: Array<{horizon_days: number, predicted_rate: number}>,
 * }}
 */
export function omoriDomainPrior(events, { c = 1, p = 1, horizonsDays = [1, 2, 3, 7] } = {}) {
  if (events.length === 0) {
    return {
      reference_timestamp: null,
      K: 0,
      c,
      p,
      predictions: horizonsDays.map((horizonDays) => ({ horizon_days: horizonDays, predicted_rate: 0 })),
    };
  }

  const reference = events.reduce((max, event) => (event.value > max.value ? event : max), events[0]);
  const windowEnd = reference.timestamp + c * DAY_MS;
  const K = events.filter(
    (event) => event.timestamp > reference.timestamp && event.timestamp <= windowEnd,
  ).length;

  const predictions = horizonsDays.map((horizonDays) => ({
    horizon_days: horizonDays,
    predicted_rate: K / Math.pow(horizonDays + c, p),
  }));

  return { reference_timestamp: reference.timestamp, K, c, p, predictions };
}

/**
 * Wheatland-style Poisson flare-rate prior: given a directly-counted
 * historical event rate (lambda = event count / observed duration), the
 * probability of at least one event within a future horizon is the
 * closed-form Poisson survival function P(>=1) = 1 - exp(-lambda * horizon).
 * Lambda is a direct empirical rate, never fitted/optimized.
 *
 * @param {NormalizedEvent[]} events - feed window
 * @param {(event: NormalizedEvent) => boolean} isEvent - structural event predicate
 * @param {Object} opts
 * @param {number} opts.horizonMs - forecast horizon, in milliseconds
 * @returns {{
 *   lambda_per_ms: number,
 *   horizon_ms: number,
 *   probability_at_least_one: number,
 *   event_count: number,
 *   duration_ms: number,
 * }}
 */
export function wheatlandFlarePrior(events, isEvent, { horizonMs }) {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.length < 2) {
    return {
      lambda_per_ms: 0,
      horizon_ms: horizonMs,
      probability_at_least_one: 0,
      event_count: 0,
      duration_ms: 0,
    };
  }

  const durationMs = sorted[sorted.length - 1].timestamp - sorted[0].timestamp;
  const eventCount = sorted.filter(isEvent).length;
  const lambda = durationMs > 0 ? eventCount / durationMs : 0;
  const probability = durationMs > 0 ? 1 - Math.exp(-lambda * horizonMs) : 0;

  return {
    lambda_per_ms: lambda,
    horizon_ms: horizonMs,
    probability_at_least_one: probability,
    event_count: eventCount,
    duration_ms: durationMs,
  };
}
