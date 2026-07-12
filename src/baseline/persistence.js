/**
 * src/baseline/persistence.js
 * Persistence / continuation structural baseline forecaster (Cycle-003
 * carry-forward S07, FR-10): "tomorrow == today" — the naive next-step
 * prediction is the most recently observed value/state. Pure function over
 * NormalizedEvent[]; no calibration, no certificate emission, no `scoring.*`
 * population. Output is a baseline prediction for comparison/validation only.
 *
 * @module baseline/persistence
 */

/**
 * @typedef {import('../ingester/generic.js').NormalizedEvent} NormalizedEvent
 */

/**
 * Predict the next value/state as equal to the most recently observed one.
 *
 * @param {NormalizedEvent[]} events - feed window
 * @param {(event: NormalizedEvent) => boolean} [isEvent] - optional structural
 *   event predicate; when supplied, `predicted_state` continues the last
 *   observed state alongside the last observed value.
 * @returns {{predicted_value: number|null, predicted_state: boolean|null, basis_timestamp: number|null}}
 */
export function persistenceForecast(events, isEvent) {
  if (events.length === 0) {
    return { predicted_value: null, predicted_state: null, basis_timestamp: null };
  }

  const last = events.reduce(
    (latest, event) => (event.timestamp > latest.timestamp ? event : latest),
    events[0],
  );

  return {
    predicted_value: last.value,
    predicted_state: typeof isEvent === 'function' ? isEvent(last) : null,
    basis_timestamp: last.timestamp,
  };
}
