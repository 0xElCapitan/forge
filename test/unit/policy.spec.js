/**
 * test/unit/policy.spec.js
 * Unit tests for FORGE-owned negative policy flag evaluators.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateNegativePolicy } from '../../src/policy/negative-policy.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PROFILE = {
  cadence:      { classification: 'event_driven' },
  distribution: { type: 'unbounded_numeric' },
  noise:        { classification: 'spike_driven' },
  density:      { classification: 'sparse_network' },
  thresholds:   { type: 'statistical' },
};

const HIGH_CONF_PROPOSALS = [
  { template: 'threshold_gate', params: {}, confidence: 0.90, rationale: 'test' },
  { template: 'cascade',        params: {}, confidence: 0.85, rationale: 'test' },
];

const LOW_CONF_PROPOSALS = [
  { template: 'threshold_gate', params: {}, confidence: 0.30, rationale: 'test' },
  { template: 'anomaly',        params: {}, confidence: 0.20, rationale: 'test' },
];

// ─── no_settlement_authority ─────────────────────────────────────────────────

describe('evaluateNegativePolicy — no_settlement_authority', () => {
  it('fires when source_metadata is absent', () => {
    const flags = evaluateNegativePolicy({
      proposals: HIGH_CONF_PROPOSALS,
      feed_profile: PROFILE,
      feed_id: 'usgs_m4.5_hour',
    });

    assert.ok(flags.includes('no_settlement_authority'),
      'should fire when no source_metadata');
  });

  it('fires when trust_tier is T3', () => {
    const flags = evaluateNegativePolicy({
      proposals: HIGH_CONF_PROPOSALS,
      feed_profile: PROFILE,
      source_metadata: { trust_tier: 'T3' },
      feed_id: 'purpleair_sf',
    });

    assert.ok(flags.includes('no_settlement_authority'),
      'should fire for T3 trust tier');
  });

  it('fires when trust_tier is unknown', () => {
    const flags = evaluateNegativePolicy({
      proposals: HIGH_CONF_PROPOSALS,
      feed_profile: PROFILE,
      source_metadata: { trust_tier: 'unknown' },
      feed_id: 'mystery_feed',
    });

    assert.ok(flags.includes('no_settlement_authority'),
      'should fire for unknown trust tier');
  });

  it('does not fire for T0 (settlement authority)', () => {
    const flags = evaluateNegativePolicy({
      proposals: HIGH_CONF_PROPOSALS,
      feed_profile: PROFILE,
      source_metadata: { trust_tier: 'T0' },
      feed_id: 'usgs_reviewed',
    });

    assert.ok(!flags.includes('no_settlement_authority'),
      'should not fire for T0 trust tier');
  });

  it('does not fire for T1 (official source)', () => {
    const flags = evaluateNegativePolicy({
      proposals: HIGH_CONF_PROPOSALS,
      feed_profile: PROFILE,
      source_metadata: { trust_tier: 'T1' },
      feed_id: 'airnow_official',
    });

    assert.ok(!flags.includes('no_settlement_authority'),
      'should not fire for T1 trust tier');
  });

  it('does not fire for T2 (corroboration)', () => {
    const flags = evaluateNegativePolicy({
      proposals: HIGH_CONF_PROPOSALS,
      feed_profile: PROFILE,
      source_metadata: { trust_tier: 'T2' },
      feed_id: 'openaq_corroboration',
    });

    assert.ok(!flags.includes('no_settlement_authority'),
      'should not fire for T2 trust tier');
  });
});

// ─── synthetic_only ───────────────────────────────────────────────────────────

describe('evaluateNegativePolicy — synthetic_only', () => {
  it('fires for T3 source with all proposals below 0.5 confidence', () => {
    const flags = evaluateNegativePolicy({
      proposals: LOW_CONF_PROPOSALS,
      feed_profile: PROFILE,
      source_metadata: { trust_tier: 'T3' },
      feed_id: 'thingspeak_temp',
    });

    assert.ok(flags.includes('synthetic_only'),
      'should fire for T3 + all low-confidence proposals');
  });

  it('does not fire for T3 when any proposal is at or above 0.5', () => {
    const mixedConfidence = [
      { template: 'threshold_gate', params: {}, confidence: 0.30, rationale: 'test' },
      { template: 'anomaly',        params: {}, confidence: 0.60, rationale: 'test' },
    ];

    const flags = evaluateNegativePolicy({
      proposals: mixedConfidence,
      feed_profile: PROFILE,
      source_metadata: { trust_tier: 'T3' },
      feed_id: 'purpleair_sf',
    });

    assert.ok(!flags.includes('synthetic_only'),
      'should not fire when at least one proposal meets the confidence threshold');
  });

  it('does not fire for T3 when proposals array is empty', () => {
    const flags = evaluateNegativePolicy({
      proposals: [],
      feed_profile: PROFILE,
      source_metadata: { trust_tier: 'T3' },
      feed_id: 'empty_t3_feed',
    });

    assert.ok(!flags.includes('synthetic_only'),
      'should not fire for empty proposals (no proposals to be low-confidence)');
  });

  it('does not fire for T1 even with low-confidence proposals', () => {
    const flags = evaluateNegativePolicy({
      proposals: LOW_CONF_PROPOSALS,
      feed_profile: PROFILE,
      source_metadata: { trust_tier: 'T1' },
      feed_id: 'airnow_low_conf',
    });

    assert.ok(!flags.includes('synthetic_only'),
      'should not fire for T1 sources regardless of confidence');
  });

  it('exact boundary: confidence 0.49 fires, 0.50 does not', () => {
    const at049 = evaluateNegativePolicy({
      proposals: [{ template: 'anomaly', params: {}, confidence: 0.49, rationale: 'test' }],
      feed_profile: PROFILE,
      source_metadata: { trust_tier: 'T3' },
      feed_id: 'boundary_feed',
    });
    assert.ok(at049.includes('synthetic_only'), '0.49 should fire synthetic_only');

    const at050 = evaluateNegativePolicy({
      proposals: [{ template: 'anomaly', params: {}, confidence: 0.50, rationale: 'test' }],
      feed_profile: PROFILE,
      source_metadata: { trust_tier: 'T3' },
      feed_id: 'boundary_feed',
    });
    assert.ok(!at050.includes('synthetic_only'), '0.50 should not fire synthetic_only');
  });
});

// ─── reflexive_feed ───────────────────────────────────────────────────────────

describe('evaluateNegativePolicy — reflexive_feed', () => {
  const cases = ['feed_self_reporting', '_internal_metrics', 'sensor_echo_feed', '_loopback_test'];

  for (const feed_id of cases) {
    it(`fires for feed_id containing reflexive pattern: ${feed_id}`, () => {
      const flags = evaluateNegativePolicy({
        proposals: HIGH_CONF_PROPOSALS,
        feed_profile: PROFILE,
        source_metadata: { trust_tier: 'T1' },
        feed_id,
      });

      assert.ok(flags.includes('reflexive_feed'),
        `should fire for feed_id "${feed_id}"`);
    });
  }

  it('does not fire for normal feed IDs', () => {
    const normalIds = ['usgs_m4.5_hour', 'purpleair_sf', 'swpc_goes_xray', 'airnow_official'];
    for (const feed_id of normalIds) {
      const flags = evaluateNegativePolicy({
        proposals: HIGH_CONF_PROPOSALS,
        feed_profile: PROFILE,
        source_metadata: { trust_tier: 'T1' },
        feed_id,
      });

      assert.ok(!flags.includes('reflexive_feed'),
        `should not fire for feed_id "${feed_id}"`);
    }
  });

  it('does not fire when feed_id is absent', () => {
    const flags = evaluateNegativePolicy({
      proposals: HIGH_CONF_PROPOSALS,
      feed_profile: PROFILE,
      source_metadata: { trust_tier: 'T1' },
    });

    assert.ok(!flags.includes('reflexive_feed'),
      'should not fire when feed_id is not provided');
  });
});

// ─── Return shape ─────────────────────────────────────────────────────────────

describe('evaluateNegativePolicy — return shape', () => {
  it('returns a sorted array', () => {
    // Trigger all three flags
    const flags = evaluateNegativePolicy({
      proposals: LOW_CONF_PROPOSALS,
      feed_profile: PROFILE,
      source_metadata: { trust_tier: 'T3' },
      feed_id: 'feed_self_echo_test',
    });

    const sorted = [...flags].sort();
    assert.deepEqual(flags, sorted, 'flags must be returned in sorted order');
  });

  it('returns an empty array when no violations', () => {
    const flags = evaluateNegativePolicy({
      proposals: HIGH_CONF_PROPOSALS,
      feed_profile: PROFILE,
      source_metadata: { trust_tier: 'T0' },
      feed_id: 'usgs_neic_reviewed',
    });

    assert.deepEqual(flags, [], 'no flags should fire for T0 source with confident proposals');
  });

  it('deduplicates flags (no duplicates)', () => {
    // Run twice with same input — result should have no duplicates
    const flags = evaluateNegativePolicy({
      proposals: LOW_CONF_PROPOSALS,
      feed_profile: PROFILE,
      source_metadata: { trust_tier: 'T3' },
      feed_id: 'purpleair_self_echo',
    });

    const unique = [...new Set(flags)];
    assert.deepEqual(flags, unique, 'flags must not contain duplicates');
  });
});
