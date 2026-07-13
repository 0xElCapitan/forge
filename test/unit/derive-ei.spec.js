// test/unit/derive-ei.spec.js
//
// DR-1 canonical qualifying order (F-3) + effective-information triple:
// the eight pinned log2_span_days_floor spans, invalid-domain rejects,
// out-of-order / equal-timestamp / tie-break / duplicate handling, the
// single-observation (span_ms=0) case, and the non-negative-span invariant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualifyingObservations, effectiveInformation, log2SpanDaysFloor } from '../../src/derive/effective-information.js';

const ev = (t, v, ts = 'parsed') => ({ timestamp: t, value: v, metadata: { ts_source: ts } });

test('log2_span_days_floor: eight pinned spans', () => {
  assert.equal(log2SpanDaysFloor(0), null);
  assert.equal(log2SpanDaysFloor(1), -27);
  assert.equal(log2SpanDaysFloor(86_399_999), -1);
  assert.equal(log2SpanDaysFloor(86_400_000), 0);
  assert.equal(log2SpanDaysFloor(172_800_000), 1);
  assert.equal(log2SpanDaysFloor(88_473_600_000), 10);
  assert.equal(log2SpanDaysFloor(5_798_205_849_600_000), 26);
  assert.equal(log2SpanDaysFloor(9_007_199_254_740_991), 26); // 2^53−1
});

test('log2_span_days_floor: invalid domain throws (never coerced)', () => {
  assert.throws(() => log2SpanDaysFloor(-1), /negative/);
  assert.throws(() => log2SpanDaysFloor(1.5), /safe integer/);
  assert.throws(() => log2SpanDaysFloor(9_007_199_254_740_992), /safe integer/); // 2^53
});

test('qualifyingObservations: out-of-order + equal-ts tiebreak + non-parsed filtered', () => {
  const events = [ev(3000, 30), ev(1000, 10), ev(2000, 20), ev(500, 5, 'fallback_base'), ev(1000, 15)];
  const q = qualifyingObservations(events);
  assert.deepStrictEqual(q.map(e => [e.timestamp, e.value]), [[1000, 10], [1000, 15], [2000, 20], [3000, 30]]);
});

test('qualifyingObservations: both fallback ts_source variants filtered', () => {
  const events = [ev(1000, 10), ev(2000, 20, 'fallback_base'), ev(3000, 30), ev(4000, 40, 'fallback_wallclock')];
  assert.deepStrictEqual(qualifyingObservations(events).map(e => e.timestamp), [1000, 3000]);
});

test('qualifyingObservations: non-numeric / non-finite values filtered', () => {
  const events = [ev(1000, 10), ev(2000, null), ev(3000, 30), ev(4000, Infinity), ev(5000, NaN)];
  assert.deepStrictEqual(qualifyingObservations(events).map(e => e.timestamp), [1000, 3000]);
});

test('qualifyingObservations: equal timestamps, differing values → order fixed by input index', () => {
  const events = [ev(5000, 50), ev(5000, 10), ev(5000, 30)];
  assert.deepStrictEqual(qualifyingObservations(events).map(e => e.value), [50, 10, 30]);
});

test('qualifyingObservations: duplicate values at duplicate timestamps retained', () => {
  const events = [ev(4000, 5), ev(4000, 5), ev(1000, 5), ev(1000, 5)];
  const q = qualifyingObservations(events);
  assert.equal(q.length, 4);
  assert.deepStrictEqual(q.map(e => e.timestamp), [1000, 1000, 4000, 4000]);
});

test('effectiveInformation: triple over a multi-observation window (k<0 branch)', () => {
  const q = qualifyingObservations([
    ev(30_000_000, 10), ev(40_000_000, 20), ev(50_000_000, 30), ev(60_000_000, 40),
    ev(70_000_000, 50), ev(80_000_000, 60), ev(90_000_000, 70),
  ]);
  assert.deepStrictEqual(effectiveInformation(q), { events: 7, span_ms: 60_000_000, log2_span_days_floor: -1, transitions: 1 });
});

test('effectiveInformation: exactly-one-day span (k=0)', () => {
  const q = qualifyingObservations([ev(0, 100), ev(86_400_000, 200)]);
  assert.deepStrictEqual(effectiveInformation(q), { events: 2, span_ms: 86_400_000, log2_span_days_floor: 0, transitions: 1 });
});

test('effectiveInformation: single qualifying observation ⇒ span_ms=0, log2 null, 0 transitions', () => {
  const q = qualifyingObservations([ev(1_700_000_000_000, 42)]);
  assert.deepStrictEqual(effectiveInformation(q), { events: 1, span_ms: 0, log2_span_days_floor: null, transitions: 0 });
});

test('effectiveInformation: empty ⇒ zero triple', () => {
  assert.deepStrictEqual(effectiveInformation([]), { events: 0, span_ms: 0, log2_span_days_floor: null, transitions: 0 });
});

test('span_ms is non-negative by construction (canonical order guarantees t_last ≥ t_first)', () => {
  // even wildly out-of-order input normalizes to ascending order ⇒ span ≥ 0
  const q = qualifyingObservations([ev(9000, 1), ev(1000, 2), ev(5000, 3), ev(3000, 4)]);
  const ei = effectiveInformation(q);
  assert.ok(ei.span_ms >= 0);
  assert.equal(ei.span_ms, 8000); // 9000 − 1000
});
