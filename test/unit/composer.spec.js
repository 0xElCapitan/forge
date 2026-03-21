/**
 * test/unit/composer.spec.js
 * Unit tests for proposeComposedTheatre.
 *
 * Covers all three composition rules, the null-return case,
 * guard clauses, and determinism.
 *
 * node --test test/unit/composer.spec.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  proposeComposedTheatre,
  alignFeeds,
  detectCausalOrdering,
} from '../../src/composer/compose.js';

// ─── Synthetic feed profiles ──────────────────────────────────────────────────
//
// Minimal FeedProfile objects covering only the fields the composition rules
// inspect. All profiles satisfy the guard-clause structural requirements.

/** AQI/air-quality feed: bounded, regulatory, multi-cadence, mixed noise */
const aqiProfile = {
  distribution: { type: 'bounded_numeric' },
  cadence:      { classification: 'multi_cadence' },
  noise:        { classification: 'mixed' },
  thresholds:   { type: 'regulatory' },
  density:      { classification: 'multi_tier' },
};

/** Wind-direction feed: bounded, minutes cadence, steady noise, statistical thresholds */
const windProfile = {
  distribution: { type: 'bounded_numeric' },
  cadence:      { classification: 'minutes' },
  noise:        { classification: 'steady' },
  thresholds:   { type: 'statistical' },
  density:      { classification: 'single_point' },
};

/** Second AQI-like feed for divergence tests (same type as aqiProfile) */
const aqiProfile2 = {
  distribution: { type: 'bounded_numeric' },
  cadence:      { classification: 'minutes' },
  noise:        { classification: 'steady' },
  thresholds:   { type: 'regulatory' },
  density:      { classification: 'single_point' },
};

/** USGS seismic feed: unbounded, event-driven, spike-driven, statistical */
const seismicProfile = {
  distribution: { type: 'unbounded_numeric' },
  cadence:      { classification: 'event_driven' },
  noise:        { classification: 'spike_driven' },
  thresholds:   { type: 'statistical' },
  density:      { classification: 'sparse_network' },
};

// Minimal aligned pairs (10 entries) for tests that need ≥5
const TEN_PAIRS = Array.from({ length: 10 }, (_, i) => ({
  a: { timestamp: i * 60_000, value: 50 + i },
  b: { timestamp: i * 60_000, value:  5 + i },
}));

const THREE_PAIRS = TEN_PAIRS.slice(0, 3);

// ─── Rule 1: threshold_with_arrival_predictor ─────────────────────────────────

describe('proposeComposedTheatre — Rule 1: threshold_with_arrival_predictor', () => {

  it('fires for AQI + wind, leader=B, lag_ms=3600000', () => {
    const result = proposeComposedTheatre(
      aqiProfile, windProfile, TEN_PAIRS,
      { leader: 'B', lag_ms: 3_600_000 },
    );

    assert.ok(result !== null, 'should return a proposal');
    assert.equal(result.template, 'threshold_gate');
    assert.equal(result.params.arrival_window_ms, 3_600_000);
    assert.equal(result.params.input_mode, 'multi');
    assert.equal(result.params.threshold_type, 'regulatory');
    assert.equal(result.params.window_hours, 1);
    assert.equal(result.confidence, 0.78);
    assert.equal(result.composition_basis.rule_fired, 'threshold_with_arrival_predictor');
    assert.equal(result.composition_basis.causal_leader, 'B');
    assert.equal(result.composition_basis.lag_ms, 3_600_000);
    assert.equal(result.composition_basis.feed_a_role, 'threshold_target');
    assert.equal(result.composition_basis.feed_b_role, 'arrival_predictor');
  });

  it('window_hours rounds up: lag_ms=5400000 (1.5h) → window_hours=2', () => {
    const result = proposeComposedTheatre(
      aqiProfile, windProfile, TEN_PAIRS,
      { leader: 'B', lag_ms: 5_400_000 },
    );
    assert.ok(result !== null);
    assert.equal(result.params.window_hours, 2);
    assert.equal(result.params.arrival_window_ms, 5_400_000);
  });

  it('fires even with empty alignedPairs (rule 1 does not check pair count)', () => {
    const result = proposeComposedTheatre(
      aqiProfile, windProfile, [],
      { leader: 'B', lag_ms: 3_600_000 },
    );
    assert.ok(result !== null);
    assert.equal(result.template, 'threshold_gate');
  });

  it('does NOT fire when leader=A (wrong causal direction)', () => {
    // AQI is not spike_driven → rule 3 also won't fire
    const result = proposeComposedTheatre(
      aqiProfile, windProfile, TEN_PAIRS,
      { leader: 'A', lag_ms: 3_600_000 },
    );
    assert.equal(result, null);
  });

  it('does NOT fire when feedA thresholds=statistical (not regulatory)', () => {
    // seismic + wind: rule 1 blocked (seismic thresholds=statistical)
    // rule 3 fires instead (seismic is spike_driven)
    const result = proposeComposedTheatre(
      seismicProfile, windProfile, TEN_PAIRS,
      { leader: 'B', lag_ms: 3_600_000 },
    );
    // Rule 3 should fire, not rule 1
    assert.ok(result !== null);
    assert.equal(result.template, 'cascade');
    assert.equal(result.composition_basis.rule_fired, 'cascade_amplifier');
  });

});

// ─── Rule 2: co_bounded_divergence ───────────────────────────────────────────

describe('proposeComposedTheatre — Rule 2: co_bounded_divergence', () => {

  it('fires for two bounded feeds, concurrent ordering, ≥5 pairs', () => {
    const result = proposeComposedTheatre(
      aqiProfile, aqiProfile2, TEN_PAIRS,
      { leader: 'concurrent', lag_ms: 0 },
    );

    assert.ok(result !== null);
    assert.equal(result.template, 'divergence');
    assert.equal(result.params.resolution_mode, 'expiry');
    assert.equal(result.confidence, 0.65);
    assert.equal(result.composition_basis.rule_fired, 'co_bounded_divergence');
    assert.equal(result.composition_basis.causal_leader, 'concurrent');
  });

  it('does NOT fire when pairs < 5', () => {
    // leader=concurrent, but only 3 pairs — rule 2 blocked
    // both feeds are bounded but AQI noise=mixed, not spike_driven → rule 3 blocked
    const result = proposeComposedTheatre(
      aqiProfile, aqiProfile2, THREE_PAIRS,
      { leader: 'concurrent', lag_ms: 0 },
    );
    assert.equal(result, null);
  });

  it('does NOT fire when leader is not concurrent', () => {
    const result = proposeComposedTheatre(
      aqiProfile, aqiProfile2, TEN_PAIRS,
      { leader: 'B', lag_ms: 1_000 },
    );
    // rule 1 conditions: aqiProfile2.cadence=minutes ✓, but aqiProfile2.thresholds=regulatory
    // wait — feedA is aqiProfile (regulatory), feedB is aqiProfile2 (regulatory, minutes cadence)
    // rule 1: feedB.cadence=minutes ✓, feedB.distribution=bounded ✓, feedA.thresholds=regulatory ✓
    // leader=B, lag_ms=1000 > 0 → rule 1 fires!
    // This test just confirms rule 2 is not the one firing
    assert.ok(result !== null);
    assert.equal(result.template, 'threshold_gate');
    assert.equal(result.composition_basis.rule_fired, 'threshold_with_arrival_predictor');
  });

});

// ─── Rule 3: cascade_amplifier ───────────────────────────────────────────────

describe('proposeComposedTheatre — Rule 3: cascade_amplifier', () => {

  it('fires for seismic + AQI, leader=B, lag_ms=7200000', () => {
    const result = proposeComposedTheatre(
      seismicProfile, aqiProfile, TEN_PAIRS,
      { leader: 'B', lag_ms: 7_200_000 },
    );

    assert.ok(result !== null);
    assert.equal(result.template, 'cascade');
    assert.equal(result.params.bucket_count, 5);
    assert.equal(result.params.window_hours, 4);   // ceil(7200000/3600000) * 2 = 2*2 = 4
    assert.equal(result.confidence, 0.60);
    assert.equal(result.composition_basis.rule_fired, 'cascade_amplifier');
    assert.equal(result.composition_basis.causal_leader, 'B');
    assert.equal(result.composition_basis.feed_a_role, 'cascade_trigger');
    assert.equal(result.composition_basis.feed_b_role, 'cascade_amplifier');
  });

  it('window_hours is 2× the ceiled lag hour: lag_ms=3600000 → window_hours=2', () => {
    const result = proposeComposedTheatre(
      seismicProfile, aqiProfile, TEN_PAIRS,
      { leader: 'B', lag_ms: 3_600_000 },
    );
    assert.ok(result !== null);
    assert.equal(result.template, 'cascade');
    assert.equal(result.params.window_hours, 2);
  });

  it('does NOT fire when feedA is not spike_driven', () => {
    // AQI (mixed noise) + AQI2: rule 3 blocked
    const result = proposeComposedTheatre(
      aqiProfile, aqiProfile2, [],
      { leader: 'B', lag_ms: 7_200_000 },
    );
    // rule 1: feedB.cadence=minutes ✓, feedB.distribution=bounded ✓, feedA.thresholds=regulatory ✓
    // leader=B, lag_ms > 0 → rule 1 fires
    assert.ok(result !== null);
    assert.equal(result.template, 'threshold_gate');
  });

  it('does NOT fire when leader is not B', () => {
    const result = proposeComposedTheatre(
      seismicProfile, aqiProfile, THREE_PAIRS,
      { leader: 'A', lag_ms: 7_200_000 },
    );
    // rule 1: seismic thresholds=statistical, not regulatory → skip
    // rule 2: seismic distribution=unbounded → skip
    // rule 3: leader=A ≠ B → skip
    assert.equal(result, null);
  });

});

// ─── Null return ─────────────────────────────────────────────────────────────

describe('proposeComposedTheatre — null return', () => {

  it('returns null when no rule matches (seismic+seismic, leader=concurrent)', () => {
    const result = proposeComposedTheatre(
      seismicProfile, seismicProfile, THREE_PAIRS,
      { leader: 'concurrent', lag_ms: 0 },
    );
    // rule 1: thresholds=statistical → skip
    // rule 2: feedA distribution=unbounded → skip
    // rule 3: leader=concurrent → skip
    assert.equal(result, null);
  });

  it('returns null for seismic+wind, leader=A (no rule fires)', () => {
    const result = proposeComposedTheatre(
      seismicProfile, windProfile, TEN_PAIRS,
      { leader: 'A', lag_ms: 3_600_000 },
    );
    // rule 1: thresholds=statistical → skip
    // rule 2: leader=A ≠ concurrent → skip
    // rule 3: leader=A ≠ B → skip
    assert.equal(result, null);
  });

});

// ─── Guard clauses ────────────────────────────────────────────────────────────

describe('proposeComposedTheatre — guard clauses', () => {

  it('throws TypeError when feedProfileA is null', () => {
    assert.throws(
      () => proposeComposedTheatre(null, windProfile, [], { leader: 'B', lag_ms: 0 }),
      TypeError,
    );
  });

  it('throws TypeError when feedProfileB is undefined', () => {
    assert.throws(
      () => proposeComposedTheatre(aqiProfile, undefined, [], { leader: 'B', lag_ms: 0 }),
      TypeError,
    );
  });

  it('throws TypeError when feedProfileA is missing distribution', () => {
    const bad = { cadence: {}, noise: {}, thresholds: {} };
    assert.throws(
      () => proposeComposedTheatre(bad, windProfile, [], { leader: 'B', lag_ms: 0 }),
      TypeError,
    );
  });

  it('throws TypeError when feedProfileB is missing thresholds', () => {
    const bad = { distribution: {}, cadence: {}, noise: {} };
    assert.throws(
      () => proposeComposedTheatre(aqiProfile, bad, [], { leader: 'B', lag_ms: 0 }),
      TypeError,
    );
  });

  it('throws TypeError when alignedPairs is not an array', () => {
    assert.throws(
      () => proposeComposedTheatre(aqiProfile, windProfile, null, { leader: 'B', lag_ms: 0 }),
      TypeError,
    );
  });

  it('throws TypeError when causalOrder is missing leader', () => {
    assert.throws(
      () => proposeComposedTheatre(aqiProfile, windProfile, [], { lag_ms: 0 }),
      TypeError,
    );
  });

  it('throws TypeError when causalOrder.lag_ms is a string', () => {
    assert.throws(
      () => proposeComposedTheatre(aqiProfile, windProfile, [], { leader: 'B', lag_ms: '3600000' }),
      TypeError,
    );
  });

});

// ─── Determinism ─────────────────────────────────────────────────────────────

describe('proposeComposedTheatre — determinism', () => {

  it('same inputs → same output (rule 1)', () => {
    const causal = { leader: 'B', lag_ms: 3_600_000 };
    const r1 = proposeComposedTheatre(aqiProfile, windProfile, TEN_PAIRS, causal);
    const r2 = proposeComposedTheatre(aqiProfile, windProfile, TEN_PAIRS, causal);
    assert.deepEqual(r1, r2);
  });

  it('same inputs → same output (rule 3)', () => {
    const causal = { leader: 'B', lag_ms: 7_200_000 };
    const r1 = proposeComposedTheatre(seismicProfile, aqiProfile, TEN_PAIRS, causal);
    const r2 = proposeComposedTheatre(seismicProfile, aqiProfile, TEN_PAIRS, causal);
    assert.deepEqual(r1, r2);
  });

  it('same inputs → null (deterministic null)', () => {
    const causal = { leader: 'concurrent', lag_ms: 0 };
    const r1 = proposeComposedTheatre(seismicProfile, seismicProfile, THREE_PAIRS, causal);
    const r2 = proposeComposedTheatre(seismicProfile, seismicProfile, THREE_PAIRS, causal);
    assert.equal(r1, null);
    assert.equal(r2, null);
  });

});

// ─── Integration smoke test ───────────────────────────────────────────────────

describe('proposeComposedTheatre — integration: canonical smoke plume test', () => {

  it('PurpleAir AQI + wind direction → smoke plume arrival threshold_gate', () => {
    // The canonical Loop 5 test case from FORGE_PROGRAM.md.
    // Wind direction feed leads AQI by ~1 hour — smoke plume arrives 1h after
    // the wind shifts toward a downwind receptor.
    const result = proposeComposedTheatre(
      aqiProfile,
      windProfile,
      TEN_PAIRS,
      { leader: 'B', lag_ms: 3_600_000 },   // wind leads AQI by 1h
    );

    assert.ok(result !== null, 'should propose a theatre');
    assert.equal(result.template, 'threshold_gate',
      'smoke plume arrival is a binary threshold event');
    assert.equal(result.params.input_mode, 'multi',
      'two-feed composition requires multi input mode');
    assert.equal(result.params.arrival_window_ms, 3_600_000,
      'arrival window derived from causal lag');
    assert.equal(result.params.threshold_type, 'regulatory',
      'AQI threshold is regulatory (EPA breakpoints)');
    assert.equal(result.params.settlement_source, null,
      'caller must supply T0/T1 settlement source — FORGE does not presume');
    assert.equal(result.composition_basis.rule_fired, 'threshold_with_arrival_predictor');
  });

});
