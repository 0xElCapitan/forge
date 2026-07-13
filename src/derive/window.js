/**
 * src/derive/window.js
 *
 * Trailing-window selection (Cycle-004 FR-1; SDD Lane L1). Deterministic
 * reverse scan over the canonical qualifying order (from
 * effective-information.js): the smallest trailing window W ≥ min_days·DAY_MS
 * ending at `endMs` that contains ≥ n_min qualifying observations. Returns null
 * when no such window exists (the kernel then rejects). Does NOT re-sort or
 * re-qualify — it consumes the F-3 canonical order as given.
 *
 * @module derive/window
 */

const DAY_MS = 86_400_000;

/**
 * @param {Array<{timestamp:number, value:number}>} qualifying - F-3-ordered (ascending)
 * @param {number} endMs - window end (inclusive)
 * @param {{min_days:number, n_min:number}} opts
 * @returns {{start_ms:number, end_ms:number, values:number[], n:number}|null}
 */
export function trailingWindow(qualifying, endMs, { min_days, n_min }) {
  const minW = min_days * DAY_MS;
  const atOrBefore = qualifying.filter(e => e.timestamp <= endMs); // preserves canonical ascending order
  if (atOrBefore.length < n_min) return null;

  // n_min-th observation counting back from endMs (deterministic reverse scan)
  const desc = atOrBefore.slice().reverse();
  const tStar = desc[n_min - 1].timestamp;

  // smallest W ≥ min_days·DAY_MS that reaches tStar
  const W = Math.max(minW, endMs - tStar);
  const startMs = endMs - W;

  const win = atOrBefore.filter(e => e.timestamp >= startMs && e.timestamp <= endMs);
  return { start_ms: startMs, end_ms: endMs, values: win.map(e => e.value), n: win.length };
}
