/**
 * src/baseline/rolling-baseline.js
 * Rolling-baseline structural forecaster (Cycle-003 carry-forward S07,
 * FR-10): moving-window average used as a dynamic threshold — computable
 * from feed history alone. Pure function over NormalizedEvent[]; no
 * calibration, no certificate emission, no `scoring.*` population.
 *
 * @module baseline/rolling-baseline
 */

/**
 * @typedef {import('../ingester/generic.js').NormalizedEvent} NormalizedEvent
 */

/**
 * Compute a moving-window average baseline per event, using only the
 * `windowSize` events immediately preceding it (never itself or the future).
 * The first events in the window (with no prior history) report a `null`
 * baseline rather than a fabricated value.
 *
 * @param {NormalizedEvent[]} events - feed window
 * @param {number} windowSize - number of preceding events in the moving window
 * @returns {Array<{timestamp: number, value: number, baseline: number|null, exceeds: boolean|null}>}
 */
export function rollingBaseline(events, windowSize) {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  return sorted.map((event, index) => {
    const priorWindow = sorted.slice(Math.max(0, index - windowSize), index);
    if (priorWindow.length === 0) {
      return { timestamp: event.timestamp, value: event.value, baseline: null, exceeds: null };
    }
    const baseline = priorWindow.reduce((sum, e) => sum + e.value, 0) / priorWindow.length;
    return { timestamp: event.timestamp, value: event.value, baseline, exceeds: event.value > baseline };
  });
}
