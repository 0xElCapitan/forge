// test/unit/derive-kernel.spec.js
//
// Kernel orchestration (SDD Lane L1, DR-5): complete ParameterRecord v0 and
// RejectionRecords, MAY-gate ordering, structured-rejection shape, deterministic
// repeatability, AC-11 constructed rejection (100% on starved prefixes, 0% on
// full history), reason-code authority, and the no-bare-number invariant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../src/receipt/canonicalize.js';
import { deriveThresholdParameter } from '../../src/derive/kernel.js';
import { OUTPUT_STATES, REASON_CODES, isReasonCode } from '../../src/derive/reason-codes.js';

const ev = (t, v, ts = 'parsed') => ({ timestamp: t, value: v, metadata: { ts_source: ts } });
const linear = (n, step = 10_000_000, v0 = 10, dv = 10) =>
  Array.from({ length: n }, (_, i) => ev(30_000_000 + i * step, v0 + i * dv));

test('derive → RANKED_CANDIDATES with a complete ParameterRecord v0', () => {
  const events = linear(7);
  const r = deriveThresholdParameter(events, { p: '0.5', now: 90_000_000, window: { min_days: 1, n_min: 6 } });
  assert.equal(r.state, OUTPUT_STATES.RANKED_CANDIDATES);
  const rec = r.record;
  // every deterministic hashed field present
  assert.equal(rec.name, 'threshold');
  assert.equal(rec.value, 40);
  assert.equal(rec.units, 'feed-native (declared)');
  assert.equal(rec.origin, 'derived');
  assert.equal(rec.derivation.algorithm_id, 'quantile-trailing-window');
  assert.equal(rec.derivation.algorithm_version, '1.0.0');
  assert.equal(rec.derivation.quantile_definition, 'HF-1');
  assert.equal(rec.derivation.p, '0.5');
  assert.deepStrictEqual(rec.derivation.input_window, { start_ms: 3_600_000, end_ms: 90_000_000, n_obs: 7 });
  assert.deepStrictEqual(rec.derivation.effective_information, { events: 7, span_ms: 60_000_000, log2_span_days_floor: -1, transitions: 1 });
  assert.deepStrictEqual(rec.derivation.quantization, { grid: 'identity/order-statistic', mode: 'none' });
  assert.deepStrictEqual(rec.uncertainty, {
    kind: 'interval', lo: 10, hi: 70, method: 'order-statistic-ci',
    coverage_model: 'distribution-free; exact if no ties, else conservative', alpha: '0.05',
    ranks: { l: 1, u: 7, widened: false },
  });
  assert.deepStrictEqual(rec.evidence.ei_gate, { gate_id: 'quantile-ci-existence', passed: true, bound_value: 0.015625, alpha: '0.05', n_star: 6 });
});

test('reject → insufficient_history with a complete RejectionRecord (existence gate)', () => {
  const events = [ev(30_000_000, 11), ev(50_000_000, 22), ev(70_000_000, 33), ev(85_000_000, 44)];
  const r = deriveThresholdParameter(events, { p: '0.5', now: 90_000_000, window: { min_days: 1, n_min: 3 } });
  assert.equal(r.state, OUTPUT_STATES.NO_INSTRUMENT);
  assert.equal(r.reason_code, REASON_CODES.insufficient_history);
  assert.equal(r.evidence.gate_id, 'quantile-ci-existence');
  assert.equal(r.evidence.n, 4);
  assert.equal(r.evidence.bound_value, 0.125);
  assert.deepStrictEqual(r.evidence.window, { start_ms: 3_600_000, end_ms: 90_000_000 });
  assert.deepStrictEqual(r.evidence.effective_information, { events: 4, span_ms: 55_000_000, log2_span_days_floor: -1, transitions: 1 });
  assert.equal(r.reconsideration.needed_n, 6);
  assert.match(r.reconsideration.condition, /existence bound/);
});

test('reject → no_nontrivial_parameter (earlier MAY-gate, no fabricated existence-gate evidence)', () => {
  const events = Array.from({ length: 6 }, (_, i) => ev(30_000_000 + i * 10_000_000, 5));
  const r = deriveThresholdParameter(events, { p: '0.5', now: 90_000_000, window: { min_days: 1, n_min: 6 } });
  assert.equal(r.state, OUTPUT_STATES.NO_INSTRUMENT);
  assert.equal(r.reason_code, REASON_CODES.no_nontrivial_parameter);
  // deterministic pre-gate evidence only; existence-gate fields NOT fabricated
  assert.deepStrictEqual(r.evidence, {
    window: { start_ms: 3_600_000, end_ms: 90_000_000 },
    effective_information: { events: 6, span_ms: 50_000_000, log2_span_days_floor: -1, transitions: 0 },
  });
  assert.ok(!('bound_value' in r.evidence), 'no fabricated bound_value');
  assert.ok(!('reconsideration' in r), 'no fabricated reconsideration for a pre-existence-gate MAY rejection');
});

test('structured rejection shape: state + registered reason_code + evidence', () => {
  const r = deriveThresholdParameter([ev(1000, 1), ev(2000, 2)], { p: '0.5', now: 90_000_000, window: { min_days: 1, n_min: 6 } });
  assert.equal(r.state, OUTPUT_STATES.NO_INSTRUMENT);
  assert.ok(isReasonCode(r.reason_code), 'reason_code is registered');
  assert.ok(r.evidence && typeof r.evidence === 'object');
});

test('deterministic repeatability: identical input ⇒ byte-identical canonical output', () => {
  const events = linear(9);
  const cfg = { p: '0.5', now: 90_000_000, window: { min_days: 1, n_min: 6 } };
  const a = canonicalize(deriveThresholdParameter(events, cfg));
  const b = canonicalize(deriveThresholdParameter(events, cfg));
  assert.equal(a, b);
});

test('AC-11: starved-prefix synthetics ⇒ 100% NO_INSTRUMENT:insufficient_history', () => {
  const cfg = { p: '0.5', now: 90_000_000, window: { min_days: 1, n_min: 3 } };
  const starved = [
    [ev(30_000_000, 11), ev(50_000_000, 22), ev(70_000_000, 33), ev(85_000_000, 44)], // n=4, bound(4,½)=0.125>0.05
    [ev(30_000_000, 1), ev(60_000_000, 9), ev(89_000_000, 3)],                          // n=3, bound(3,½)=0.25>0.05
    [ev(40_000_000, 7), ev(80_000_000, 2)],                                             // n=2 < n_min ⇒ window null
  ];
  for (const events of starved) {
    const r = deriveThresholdParameter(events, cfg);
    assert.equal(r.state, OUTPUT_STATES.NO_INSTRUMENT, 'starved ⇒ NO_INSTRUMENT');
    assert.equal(r.reason_code, REASON_CODES.insufficient_history);
  }
});

test('AC-11: full-history synthetics clearing the gate ⇒ 0% rejection', () => {
  const cfg = { p: '0.5', now: 90_000_000, window: { min_days: 1, n_min: 6 } };
  // n=8..12 distinct values, all within the min-days window ⇒ bound(n,½) ≤ 0.05 ⇒ derive
  for (let n = 8; n <= 12; n++) {
    const events = Array.from({ length: n }, (_, i) => ev(3_700_000 + i * 7_000_000, 100 + i * 3));
    const r = deriveThresholdParameter(events, cfg);
    assert.equal(r.state, OUTPUT_STATES.RANKED_CANDIDATES, `full-history n=${n} ⇒ derive`);
    assert.ok('record' in r);
  }
});

test('reason-code authority: no rejection emits an unregistered reason code', () => {
  const inputs = [
    [[ev(1000, 1)], { p: '0.5', now: 90_000_000, window: { min_days: 1, n_min: 6 } }],
    [Array.from({ length: 6 }, (_, i) => ev(30_000_000 + i * 10_000_000, 5)), { p: '0.5', now: 90_000_000, window: { min_days: 1, n_min: 6 } }],
    [[ev(30_000_000, 11), ev(50_000_000, 22), ev(70_000_000, 33), ev(85_000_000, 44)], { p: '0.5', now: 90_000_000, window: { min_days: 1, n_min: 3 } }],
  ];
  for (const [events, cfg] of inputs) {
    const r = deriveThresholdParameter(events, cfg);
    if (r.state === OUTPUT_STATES.NO_INSTRUMENT) assert.ok(isReasonCode(r.reason_code), `registered reason: ${r.reason_code}`);
  }
});

test('no bare number: the kernel never returns a raw numeric result', () => {
  const r = deriveThresholdParameter(linear(7), { p: '0.5', now: 90_000_000, window: { min_days: 1, n_min: 6 } });
  assert.equal(typeof r, 'object');
  assert.ok('record' in r || 'reason_code' in r);
  assert.notEqual(typeof r, 'number');
});
