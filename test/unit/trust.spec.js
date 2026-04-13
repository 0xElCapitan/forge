/**
 * test/unit/trust.spec.js
 * Unit tests for oracle trust model and adversarial detection.
 *
 * Covers: oracle-trust.js, adversarial.js
 *
 * Critical invariant explicitly tested:
 *   PurpleAir (T3) must NEVER be allowed to settle a theatre.
 *
 * node --test test/unit/trust.spec.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getTrustTier, canSettle, validateSettlement } from '../../src/trust/oracle-trust.js';
import { checkAdversarial, checkChannelConsistency }  from '../../src/trust/adversarial.js';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const NOW = 1_000_000_000_000;  // fixed clock

/** Minimal clean bundle — passes all adversarial checks. */
const cleanBundle = { value: 50, timestamp: NOW };

// ─── oracle-trust.js ─────────────────────────────────────────────────────────

describe('getTrustTier', () => {
  it('T0 sources are recognised', () => {
    assert.equal(getTrustTier('epa_aqs'),       'T0');
    assert.equal(getTrustTier('usgs_reviewed'), 'T0');
    assert.equal(getTrustTier('gfz_kp'),        'T0');
  });

  it('T1 sources are recognised', () => {
    assert.equal(getTrustTier('airnow'),          'T1');
    assert.equal(getTrustTier('usgs_automatic'),  'T1');
    assert.equal(getTrustTier('swpc_goes'),       'T1');
    assert.equal(getTrustTier('noaa_goes'),       'T1');
  });

  it('T2 sources are recognised', () => {
    assert.equal(getTrustTier('openaq'), 'T2');
    assert.equal(getTrustTier('emsc'),   'T2');
  });

  it('T3 sources are recognised', () => {
    assert.equal(getTrustTier('purpleair'),  'T3');
    assert.equal(getTrustTier('thingspeak'), 'T3');
  });

  it('lookup is case-insensitive', () => {
    assert.equal(getTrustTier('PurpleAir'), 'T3');
    assert.equal(getTrustTier('AIRNOW'),    'T1');
    assert.equal(getTrustTier('EPA_AQS'),   'T0');
  });

  it('unknown source returns "unknown"', () => {
    assert.equal(getTrustTier('some_unknown_api'), 'unknown');
    assert.equal(getTrustTier(''),                 'unknown');
  });

  it('null/undefined source returns "unknown"', () => {
    assert.equal(getTrustTier(null),      'unknown');
    assert.equal(getTrustTier(undefined), 'unknown');
  });
});

describe('canSettle', () => {
  it('T0 may settle', () => {
    assert.equal(canSettle('T0'), true);
  });

  it('T1 may settle', () => {
    assert.equal(canSettle('T1'), true);
  });

  it('T2 may NOT settle', () => {
    assert.equal(canSettle('T2'), false);
  });

  // ── CRITICAL INVARIANT ───────────────────────────────────────────────────────
  it('T3 (PurpleAir) must NEVER settle', () => {
    assert.equal(canSettle('T3'), false);
    // Explicit: PurpleAir specifically
    const tier = getTrustTier('purpleair');
    assert.equal(tier, 'T3');
    assert.equal(canSettle(tier), false);
  });

  it('unknown may NOT settle', () => {
    assert.equal(canSettle('unknown'), false);
  });
});

describe('validateSettlement', () => {
  it('T0 source settlement is allowed', () => {
    const result = validateSettlement('epa_aqs');
    assert.equal(result.allowed, true);
    assert.equal(result.tier, 'T0');
  });

  it('T1 source settlement is allowed', () => {
    const result = validateSettlement('airnow');
    assert.equal(result.allowed, true);
    assert.equal(result.tier, 'T1');
  });

  // ── T3 SETTLEMENT REJECTION ──────────────────────────────────────────────────
  it('T3 source (PurpleAir) settlement is rejected with reason', () => {
    const result = validateSettlement('purpleair');
    assert.equal(result.allowed, false);
    assert.equal(result.tier, 'T3');
    assert.ok(typeof result.reason === 'string', 'reason should be a string');
    assert.ok(result.reason.includes('T3'), 'reason should mention T3');
  });

  it('T2 source settlement is rejected', () => {
    const result = validateSettlement('openaq');
    assert.equal(result.allowed, false);
    assert.equal(result.tier, 'T2');
  });

  it('unknown source settlement is rejected', () => {
    const result = validateSettlement('mystery_sensor');
    assert.equal(result.allowed, false);
    assert.equal(result.tier, 'unknown');
  });
});

// ─── adversarial.js ───────────────────────────────────────────────────────────

describe('checkAdversarial — clean bundle', () => {
  it('clean bundle with no anomalous fields passes', () => {
    const result = checkAdversarial(cleanBundle, { now: NOW });
    assert.deepEqual(result, { clean: true });
  });

  it('returns { clean: true } for fresh bundle without optional fields', () => {
    const result = checkAdversarial({ value: 10, timestamp: NOW }, { now: NOW });
    assert.equal(result.clean, true);
  });
});

describe('checkAdversarial — channel A/B inconsistency', () => {
  it('consistent channels (10% divergence) pass', () => {
    // |50 - 55| / 55 ≈ 0.091 < 0.15
    const bundle = { value: 52, timestamp: NOW, channel_a: 50, channel_b: 55 };
    const result = checkAdversarial(bundle, { now: NOW });
    assert.equal(result.clean, true);
  });

  it('inconsistent channels (>15% divergence) are flagged', () => {
    // |50 - 70| / 70 ≈ 0.286 > 0.15
    const bundle = { value: 60, timestamp: NOW, channel_a: 50, channel_b: 70 };
    const result = checkAdversarial(bundle, { now: NOW });
    assert.equal(result.clean, false);
    assert.ok(result.reason.includes('channel_ab_inconsistency'), `reason: ${result.reason}`);
  });

  it('exactly at 15% threshold passes (not strictly greater)', () => {
    // |0 - 15| / 15 = 1.0 → actually > 0.15, so should fail
    // Let's test near-threshold instead: |0 - 14| / 14 = 1.0 — that's huge
    // Use: |85 - 100| / 100 = 0.15 exactly → should pass (> not >=)
    const bundle = { value: 92, timestamp: NOW, channel_a: 85, channel_b: 100 };
    const result = checkAdversarial(bundle, { now: NOW });
    assert.equal(result.clean, true);
  });

  it('zero-value channels use denominator floor of 1', () => {
    // |0 - 0| / 1 = 0 → clean
    const bundle = { value: 0, timestamp: NOW, channel_a: 0, channel_b: 0 };
    const result = checkAdversarial(bundle, { now: NOW });
    assert.equal(result.clean, true);
  });
});

describe('checkAdversarial — frozen/replayed data', () => {
  it('frozen_count below threshold passes', () => {
    const bundle = { value: 42, timestamp: NOW, frozen_count: 4 };
    const result = checkAdversarial(bundle, { now: NOW });
    assert.equal(result.clean, true);
  });

  it('frozen_count at threshold is flagged', () => {
    const bundle = { value: 42, timestamp: NOW, frozen_count: 5 };
    const result = checkAdversarial(bundle, { now: NOW });
    assert.equal(result.clean, false);
    assert.ok(result.reason.includes('frozen_data'), `reason: ${result.reason}`);
  });

  it('high frozen_count is flagged with count in reason', () => {
    const bundle = { value: 42, timestamp: NOW, frozen_count: 20 };
    const result = checkAdversarial(bundle, { now: NOW });
    assert.equal(result.clean, false);
    assert.ok(result.reason.includes('20'), `reason should include count: ${result.reason}`);
  });
});

describe('checkAdversarial — clock drift', () => {
  it('fresh timestamp passes', () => {
    const result = checkAdversarial({ value: 1, timestamp: NOW }, { now: NOW });
    assert.equal(result.clean, true);
  });

  it('timestamp 6 days old passes', () => {
    const ts = NOW - 6 * 24 * 3_600_000;
    const result = checkAdversarial({ value: 1, timestamp: ts }, { now: NOW });
    assert.equal(result.clean, true);
  });

  it('timestamp 8 days old is flagged as clock_drift', () => {
    const ts = NOW - 8 * 24 * 3_600_000;
    const result = checkAdversarial({ value: 1, timestamp: ts }, { now: NOW });
    assert.equal(result.clean, false);
    assert.ok(result.reason.includes('clock_drift'), `reason: ${result.reason}`);
  });

  it('timestamp 30 minutes in future passes', () => {
    const ts = NOW + 30 * 60_000;
    const result = checkAdversarial({ value: 1, timestamp: ts }, { now: NOW });
    assert.equal(result.clean, true);
  });

  it('timestamp 90 minutes in future is flagged as clock_drift', () => {
    const ts = NOW + 90 * 60_000;
    const result = checkAdversarial({ value: 1, timestamp: ts }, { now: NOW });
    assert.equal(result.clean, false);
    assert.ok(result.reason.includes('clock_drift'), `reason: ${result.reason}`);
  });
});

describe('checkAdversarial — location spoofing', () => {
  it('bundle coords matching registered location passes', () => {
    const bundle = { value: 10, timestamp: NOW, lat: 37.7, lon: -122.4 };
    const ctx = { now: NOW, registered_lat: 37.7, registered_lon: -122.4 };
    const result = checkAdversarial(bundle, ctx);
    assert.equal(result.clean, true);
  });

  it('small coord deviation (0.1°) passes', () => {
    const bundle = { value: 10, timestamp: NOW, lat: 37.8, lon: -122.3 };
    const ctx = { now: NOW, registered_lat: 37.7, registered_lon: -122.4 };
    const result = checkAdversarial(bundle, ctx);
    assert.equal(result.clean, true);
  });

  it('large coord deviation (>0.45°) is flagged as location_spoofing', () => {
    const bundle = { value: 10, timestamp: NOW, lat: 38.5, lon: -122.4 };
    const ctx = { now: NOW, registered_lat: 37.7, registered_lon: -122.4 };
    const result = checkAdversarial(bundle, ctx);
    assert.equal(result.clean, false);
    assert.ok(result.reason.includes('location_spoofing'), `reason: ${result.reason}`);
  });

  it('no registered location context → no location check', () => {
    const bundle = { value: 10, timestamp: NOW, lat: 0, lon: 0 };
    const result = checkAdversarial(bundle, { now: NOW });
    assert.equal(result.clean, true);
  });
});

describe('checkAdversarial — Sybil sensors', () => {
  it('diverse peer values pass', () => {
    const ctx = { now: NOW, peer_values: [50, 52, 48, 51] };
    const result = checkAdversarial(cleanBundle, ctx);
    assert.equal(result.clean, true);
  });

  it('all identical peer values are flagged as sybil_sensors', () => {
    const ctx = { now: NOW, peer_values: [50, 50, 50, 50] };
    const result = checkAdversarial(cleanBundle, ctx);
    assert.equal(result.clean, false);
    assert.ok(result.reason.includes('sybil_sensors'), `reason: ${result.reason}`);
  });

  it('single peer value is not flagged (need ≥2)', () => {
    const ctx = { now: NOW, peer_values: [50] };
    const result = checkAdversarial(cleanBundle, ctx);
    assert.equal(result.clean, true);
  });
});

// ─── Pre-002 Hardening: NaN/non-finite guards (H-3) ─────────────────────────

describe('checkAdversarial — NaN hardening: channel_a/channel_b', () => {
  it('NaN channel_a is rejected', () => {
    const r = checkAdversarial({ value: 10, timestamp: NOW, channel_a: NaN, channel_b: 10 }, { now: NOW });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_channel_a'));
  });

  it('Infinity channel_a is rejected', () => {
    const r = checkAdversarial({ value: 10, timestamp: NOW, channel_a: Infinity, channel_b: 10 }, { now: NOW });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_channel_a'));
  });

  it('-Infinity channel_a is rejected', () => {
    const r = checkAdversarial({ value: 10, timestamp: NOW, channel_a: -Infinity, channel_b: 10 }, { now: NOW });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_channel_a'));
  });

  it('NaN channel_b is rejected', () => {
    const r = checkAdversarial({ value: 10, timestamp: NOW, channel_a: 10, channel_b: NaN }, { now: NOW });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_channel_b'));
  });

  it('Infinity channel_b is rejected', () => {
    const r = checkAdversarial({ value: 10, timestamp: NOW, channel_a: 10, channel_b: Infinity }, { now: NOW });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_channel_b'));
  });
});

describe('checkAdversarial — NaN hardening: frozen_count', () => {
  it('NaN frozen_count is rejected', () => {
    const r = checkAdversarial({ value: 10, timestamp: NOW, frozen_count: NaN }, { now: NOW });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_frozen_count'));
  });

  it('Infinity frozen_count is rejected', () => {
    const r = checkAdversarial({ value: 10, timestamp: NOW, frozen_count: Infinity }, { now: NOW });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_frozen_count'));
  });

  it('-Infinity frozen_count is rejected', () => {
    const r = checkAdversarial({ value: 10, timestamp: NOW, frozen_count: -Infinity }, { now: NOW });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_frozen_count'));
  });
});

describe('checkAdversarial — NaN hardening: timestamp', () => {
  it('NaN timestamp is rejected', () => {
    const r = checkAdversarial({ value: 10, timestamp: NaN }, { now: NOW });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_timestamp'));
  });

  it('Infinity timestamp is rejected', () => {
    const r = checkAdversarial({ value: 10, timestamp: Infinity }, { now: NOW });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_timestamp'));
  });

  it('-Infinity timestamp is rejected', () => {
    const r = checkAdversarial({ value: 10, timestamp: -Infinity }, { now: NOW });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_timestamp'));
  });
});

describe('checkAdversarial — NaN hardening: lat/lon', () => {
  it('NaN lat is rejected', () => {
    const r = checkAdversarial({ value: 10, timestamp: NOW, lat: NaN }, { now: NOW });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_lat'));
  });

  it('Infinity lat is rejected', () => {
    const r = checkAdversarial({ value: 10, timestamp: NOW, lat: Infinity }, { now: NOW });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_lat'));
  });

  it('-Infinity lat is rejected', () => {
    const r = checkAdversarial({ value: 10, timestamp: NOW, lat: -Infinity }, { now: NOW });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_lat'));
  });

  it('NaN lon is rejected', () => {
    const r = checkAdversarial({ value: 10, timestamp: NOW, lon: NaN }, { now: NOW });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_lon'));
  });

  it('Infinity lon is rejected', () => {
    const r = checkAdversarial({ value: 10, timestamp: NOW, lon: Infinity }, { now: NOW });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_lon'));
  });
});

describe('checkAdversarial — NaN hardening: peer_values', () => {
  it('NaN in peer_values is rejected', () => {
    const r = checkAdversarial(cleanBundle, { now: NOW, peer_values: [50, NaN, 48] });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_peer_value'));
  });

  it('Infinity in peer_values is rejected', () => {
    const r = checkAdversarial(cleanBundle, { now: NOW, peer_values: [50, Infinity] });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_peer_value'));
  });

  it('-Infinity in peer_values is rejected', () => {
    const r = checkAdversarial(cleanBundle, { now: NOW, peer_values: [50, -Infinity] });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_peer_value'));
  });

  it('undefined in peer_values is rejected', () => {
    const r = checkAdversarial(cleanBundle, { now: NOW, peer_values: [50, undefined, 48] });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_peer_value'));
  });
});

describe('checkAdversarial — NaN hardening: string coercion', () => {
  it('string channel_a is rejected', () => {
    const r = checkAdversarial({ value: 10, timestamp: NOW, channel_a: '42', channel_b: 10 }, { now: NOW });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_channel_a'));
  });

  it('string timestamp is rejected', () => {
    const r = checkAdversarial({ value: 10, timestamp: '1000' }, { now: NOW });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_timestamp'));
  });

  it('string lat is rejected', () => {
    const r = checkAdversarial({ value: 10, timestamp: NOW, lat: '37' }, { now: NOW });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_lat'));
  });

  it('string frozen_count is rejected', () => {
    const r = checkAdversarial({ value: 10, timestamp: NOW, frozen_count: '5' }, { now: NOW });
    assert.equal(r.clean, false);
    assert.ok(r.reason.includes('invalid_frozen_count'));
  });
});

// ─── Sprint 3: Check 6 — value out of range (RT-05/CR-01 fix) ───────────────

describe('checkAdversarial — Check 6: value out of range (Sprint 3)', () => {
  it('NaN value is flagged', () => {
    const result = checkAdversarial({ value: NaN, timestamp: NOW }, { now: NOW });
    assert.equal(result.clean, false);
    assert.ok(result.reason.includes('value_out_of_range'));
  });

  it('Infinity value is flagged', () => {
    const result = checkAdversarial({ value: Infinity, timestamp: NOW }, { now: NOW });
    assert.equal(result.clean, false);
    assert.ok(result.reason.includes('value_out_of_range'));
  });

  it('-Infinity value is flagged', () => {
    const result = checkAdversarial({ value: -Infinity, timestamp: NOW }, { now: NOW });
    assert.equal(result.clean, false);
    assert.ok(result.reason.includes('value_out_of_range'));
  });

  it('normal finite value passes Check 6', () => {
    const result = checkAdversarial({ value: 42, timestamp: NOW }, { now: NOW });
    assert.equal(result.clean, true);
  });

  it('zero value passes Check 6', () => {
    const result = checkAdversarial({ value: 0, timestamp: NOW }, { now: NOW });
    assert.equal(result.clean, true);
  });

  it('negative finite value passes Check 6', () => {
    const result = checkAdversarial({ value: -500, timestamp: NOW }, { now: NOW });
    assert.equal(result.clean, true);
  });

  it('null/undefined value skips Check 6 (opt-in field)', () => {
    const result1 = checkAdversarial({ timestamp: NOW }, { now: NOW });
    assert.equal(result1.clean, true);
    const result2 = checkAdversarial({ value: null, timestamp: NOW }, { now: NOW });
    assert.equal(result2.clean, true);
  });
});

// ─── Sprint 3: RT-02 — getTrustTier type guard ─────────────────────────────

describe('getTrustTier — type guard (Sprint 3)', () => {
  it('object input returns unknown (no crash)', () => {
    assert.equal(getTrustTier({}), 'unknown');
  });

  it('number input returns unknown (no crash)', () => {
    assert.equal(getTrustTier(42), 'unknown');
  });

  it('array input returns unknown (no crash)', () => {
    assert.equal(getTrustTier([]), 'unknown');
  });

  it('boolean input returns unknown (no crash)', () => {
    assert.equal(getTrustTier(true), 'unknown');
  });
});

describe('checkChannelConsistency', () => {
  it('consistent channels report consistent: true', () => {
    // |50 - 52| / 52 ≈ 0.038 < 0.15
    const { consistent, divergence } = checkChannelConsistency(50, 52);
    assert.equal(consistent, true);
    assert.ok(divergence < 0.15);
  });

  it('inconsistent channels report consistent: false', () => {
    // |50 - 80| / 80 = 0.375 > 0.15
    const { consistent, divergence } = checkChannelConsistency(50, 80);
    assert.equal(consistent, false);
    assert.ok(divergence > 0.15);
  });

  it('identical channels report divergence 0', () => {
    const { consistent, divergence } = checkChannelConsistency(100, 100);
    assert.equal(consistent, true);
    assert.equal(divergence, 0);
  });

  it('zero-value channels use floor denominator of 1 (no division by zero)', () => {
    const { consistent, divergence } = checkChannelConsistency(0, 0);
    assert.equal(consistent, true);
    assert.equal(divergence, 0);
  });

  it('returns numeric divergence value', () => {
    const { divergence } = checkChannelConsistency(10, 20);
    assert.equal(typeof divergence, 'number');
    assert.ok(Number.isFinite(divergence));
  });
});
