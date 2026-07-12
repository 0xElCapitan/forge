/**
 * src/baseline/base-rate.js
 * Base-rate structural baseline forecaster (Cycle-003 carry-forward S07, FR-10).
 *
 * Historical frequency of an event within a feed window — the simplest
 * possible baseline. A pure function over NormalizedEvent[]; no calibration,
 * no certificate emission, no `scoring.*` population. Output is a baseline
 * prediction for comparison/validation only, never a certified or
 * skill-adjusted value.
 *
 * @module baseline/base-rate
 */

/**
 * @typedef {import('../ingester/generic.js').NormalizedEvent} NormalizedEvent
 */

/**
 * Compute the historical base rate of an event within a feed window.
 *
 * @param {NormalizedEvent[]} events - feed window
 * @param {(event: NormalizedEvent) => boolean} isEvent - structural event predicate
 * @returns {{count: number, total: number, rate: number}}
 */
export function baseRate(events, isEvent) {
  const total = events.length;
  if (total === 0) return { count: 0, total: 0, rate: 0 };

  let count = 0;
  for (const event of events) {
    if (isEvent(event)) count++;
  }
  return { count, total, rate: count / total };
}
