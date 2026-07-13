/**
 * src/derive/effective-information.js
 *
 * Canonical qualifying-observation ordering (F-3) and the effective-information
 * triple (Cycle-004 FR-2; SDD DR-1). Exact-integer only — no transcendentals
 * touch any hashed field. The returned qualifying order is THE canonical order
 * every downstream consumer (span, transitions, trailing window, HF-1
 * extraction) uses.
 *
 * @module derive/effective-information
 */

import { hf1Quantile } from './quantile.js';

const DAY_MS = 86_400_000;
const MEDIAN_P = { num: 1, den: 2 }; // HF-1 median level (DR-4 with p = 1/2)

/**
 * `log2_span_days_floor` — total deterministic algorithm over the full accepted
 * domain (DR-1). The unique integer k with `DAY_MS·2^k ≤ span < DAY_MS·2^(k+1)`;
 * `null` when span === 0. Exact integer arithmetic and comparisons only (no
 * logarithm, no float multiply on the hashed value). Two-branch bounded
 * doubling. `span` must be a non-negative safe integer ≤ 2^53−1 (invalid domain
 * ⇒ throw; never coerced, never clamped).
 *
 * @param {number} span - span_ms
 * @returns {number|null}
 */
export function log2SpanDaysFloor(span) {
  if (typeof span !== 'number' || !Number.isSafeInteger(span)) {
    throw new Error(`log2SpanDaysFloor: span_ms must be a safe integer in [0, 2^53−1], got ${span}`);
  }
  if (span < 0) throw new Error(`log2SpanDaysFloor: negative span_ms ${span}`);
  if (span === 0) return null;
  if (span >= DAY_MS) {                          // k ≥ 0 branch
    let k = 0;
    let m = DAY_MS;                              // m = DAY_MS·2^k ≤ span
    const half = Math.floor(span / 2);           // exact for safe integers
    while (m <= half) { m = m * 2; k = k + 1; }  // double while DAY_MS·2^(k+1) ≤ span
    return k;
  }
  let j = 0;                                     // k < 0 branch: 1 ≤ span < DAY_MS
  let s = span;                                  // s = span·2^j
  while (s < DAY_MS) { s = s * 2; j = j + 1; }   // smallest j with span·2^j ≥ DAY_MS
  return -j;
}

/**
 * Canonical qualifying-observation order (F-3, binding):
 *   1. preserve each event's original input index;
 *   2. filter to qualifying events: `metadata.ts_source === 'parsed'` AND a
 *      finite numeric value;
 *   3. sort ascending by integer timestamp;
 *   4. break equal-timestamp ties by ascending original input index (stable
 *      total order).
 * Duplicate timestamps and duplicate values are retained; out-of-order input is
 * normalized deterministically; `span_ms` is always non-negative by
 * construction. The returned events are the input event objects, reordered.
 *
 * @param {Array<{timestamp:number, value:*, metadata:Object}>} events
 * @returns {Array} qualifying events in canonical order
 */
export function qualifyingObservations(events) {
  return events
    .map((e, i) => ({ e, i }))
    .filter(({ e }) =>
      e && e.metadata && e.metadata.ts_source === 'parsed' &&
      typeof e.value === 'number' && Number.isFinite(e.value))
    .sort((a, b) =>
      a.e.timestamp < b.e.timestamp ? -1 :
      a.e.timestamp > b.e.timestamp ?  1 :
      a.i - b.i)
    .map(({ e }) => e);
}

/**
 * DR-1 effective-information triple over the canonical qualifying array:
 *   - `events`               count of qualifying observations
 *   - `span_ms`              t_last − t_first (exact integer ms, ≥ 0)
 *   - `log2_span_days_floor` bounded-doubling floor (null when span === 0)
 *   - `transitions`          median-state transition count: number of indices
 *     i ≥ 1 (canonical order) where 1{v_i > m_W} ≠ 1{v_{i−1} > m_W}, m_W the
 *     HF-1 median (p = 1/2) of the qualifying values.
 *
 * @param {Array<{timestamp:number, value:number}>} qualifying - F-3-ordered
 * @returns {{events:number, span_ms:number, log2_span_days_floor:(number|null), transitions:number}}
 */
export function effectiveInformation(qualifying) {
  const events = qualifying.length;
  if (events === 0) {
    return { events: 0, span_ms: 0, log2_span_days_floor: null, transitions: 0 };
  }
  for (const e of qualifying) {
    if (!Number.isSafeInteger(e.timestamp)) {
      throw new Error(`effectiveInformation: qualifying timestamp not a safe integer: ${e.timestamp}`);
    }
  }
  const span_ms = qualifying[events - 1].timestamp - qualifying[0].timestamp;
  const log2 = log2SpanDaysFloor(span_ms);

  let transitions = 0;
  if (events >= 2) {
    const sortedVals = qualifying.map(e => e.value).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const mW = hf1Quantile(sortedVals, MEDIAN_P);
    let prev = qualifying[0].value > mW ? 1 : 0;
    for (let i = 1; i < events; i++) {
      const cur = qualifying[i].value > mW ? 1 : 0;
      if (cur !== prev) transitions++;
      prev = cur;
    }
  }
  return { events, span_ms, log2_span_days_floor: log2, transitions };
}
