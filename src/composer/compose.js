/**
 * src/composer/compose.js
 * Temporal alignment and causal ordering for composed feeds.
 *
 * Loop 5 prerequisite: full composition (e.g. PurpleAir + wind direction → smoke plume
 * arrival theatre) requires temporal alignment of two feed streams and detection of the
 * leading/lagging relationship between them.
 *
 * This implementation is a STUB sufficient for Sprint 9. Full composition is Loop 5 work.
 * The interfaces are fixed; the algorithms will be iterated.
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
