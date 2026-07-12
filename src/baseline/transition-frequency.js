/**
 * src/baseline/transition-frequency.js
 * Transition-frequency structural baseline forecaster (Cycle-003
 * carry-forward S07, FR-10): empirical state-transition rates over a
 * discretized feed window. Pure function over NormalizedEvent[]; no
 * calibration, no certificate emission, no `scoring.*` population.
 *
 * @module baseline/transition-frequency
 */

/**
 * @typedef {import('../ingester/generic.js').NormalizedEvent} NormalizedEvent
 */

/**
 * Compute empirical state-transition rates across a feed window, discretized
 * into a two-state (event / no-event) sequence by `isEvent`.
 *
 * @param {NormalizedEvent[]} events - feed window
 * @param {(event: NormalizedEvent) => boolean} isEvent - structural event predicate
 * @returns {{
 *   counts: {eventToEvent: number, eventToNoEvent: number, noEventToEvent: number, noEventToNoEvent: number},
 *   rate_event_to_event: number|null,
 *   rate_no_event_to_event: number|null,
 * }}
 */
export function transitionFrequency(events, isEvent) {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const states = sorted.map(isEvent);

  const counts = { eventToEvent: 0, eventToNoEvent: 0, noEventToEvent: 0, noEventToNoEvent: 0 };
  for (let i = 0; i < states.length - 1; i++) {
    const from = states[i];
    const to = states[i + 1];
    if (from && to) counts.eventToEvent++;
    else if (from && !to) counts.eventToNoEvent++;
    else if (!from && to) counts.noEventToEvent++;
    else counts.noEventToNoEvent++;
  }

  const fromEventTotal = counts.eventToEvent + counts.eventToNoEvent;
  const fromNoEventTotal = counts.noEventToEvent + counts.noEventToNoEvent;

  return {
    counts,
    rate_event_to_event: fromEventTotal > 0 ? counts.eventToEvent / fromEventTotal : null,
    rate_no_event_to_event: fromNoEventTotal > 0 ? counts.noEventToEvent / fromNoEventTotal : null,
  };
}
