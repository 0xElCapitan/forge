/**
 * test/unit/ir.spec.js
 * Tests for the Proposal IR envelope emitter.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { emitEnvelope } from '../../src/ir/emit.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TREMOR_PROFILE = {
  cadence:      { classification: 'event_driven', median_ms: 4500000, jitter_coefficient: 1.2 },
  distribution: { type: 'unbounded_numeric', min: 4.5, max: 7.1, mean: 5.2 },
  noise:        { classification: 'spike_driven', spike_rate: 0.35 },
  density:      { classification: 'sparse_network', sensor_count: 1 },
  thresholds:   { type: 'statistical', detected_thresholds: [5.0, 6.0] },
};

const TREMOR_PROPOSALS = [
  {
    template: 'threshold_gate',
    params: { threshold: 5.0, window_hours: 24, input_mode: 'single', threshold_type: 'statistical', settlement_source: null, base_rate: null },
    confidence: 0.90,
    rationale: "Rule 'seismic_threshold_gate' fired (3/3 conditions). Traced to: TREMOR/MagGate.",
  },
  {
    template: 'cascade',
    params: { trigger_threshold: 6.0, bucket_count: 5, window_hours: 72, prior_model: 'omori' },
    confidence: 0.85,
    rationale: "Rule 'seismic_cascade' fired (2/2 conditions). Traced to: TREMOR/AftershockCascade.",
  },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('emitEnvelope', () => {
  it('produces a valid envelope with required fields', () => {
    const env = emitEnvelope({
      feed_id: 'usgs_m4.5_hour',
      feed_profile: TREMOR_PROFILE,
      proposals: TREMOR_PROPOSALS,
    });

    assert.equal(env.ir_version, '0.1.0');
    assert.equal(env.forge_version, '0.1.0');
    assert.equal(typeof env.emitted_at, 'number');
    assert.ok(env.emitted_at > 0);
    assert.equal(env.feed_id, 'usgs_m4.5_hour');
    assert.ok(env.feed_profile);
    assert.ok(Array.isArray(env.proposals));
    assert.equal(env.proposals.length, 2);
  });

  it('serializes feed profile with only IR-declared fields', () => {
    const env = emitEnvelope({
      feed_id: 'test',
      feed_profile: {
        ...TREMOR_PROFILE,
        cadence: { ...TREMOR_PROFILE.cadence, _internal_field: 'should_be_stripped' },
      },
      proposals: [],
    });

    assert.equal(env.feed_profile.cadence.classification, 'event_driven');
    assert.equal(env.feed_profile.cadence._internal_field, undefined);
    assert.equal(env.feed_profile.distribution.type, 'unbounded_numeric');
    assert.equal(env.feed_profile.noise.classification, 'spike_driven');
    assert.equal(env.feed_profile.density.classification, 'sparse_network');
    assert.equal(env.feed_profile.thresholds.type, 'statistical');
  });

  it('annotates proposals with brier_type', () => {
    const env = emitEnvelope({
      feed_id: 'test',
      feed_profile: TREMOR_PROFILE,
      proposals: TREMOR_PROPOSALS,
    });

    assert.equal(env.proposals[0].brier_type, 'binary');      // threshold_gate
    assert.equal(env.proposals[1].brier_type, 'multi_class');  // cascade
  });

  it('generates deterministic proposal_id from feed_id + template + params', () => {
    const env1 = emitEnvelope({
      feed_id: 'usgs_m4.5_hour',
      feed_profile: TREMOR_PROFILE,
      proposals: TREMOR_PROPOSALS,
    });

    const env2 = emitEnvelope({
      feed_id: 'usgs_m4.5_hour',
      feed_profile: TREMOR_PROFILE,
      proposals: TREMOR_PROPOSALS,
    });

    // Same input → same proposal_ids (idempotent)
    assert.equal(env1.proposals[0].proposal_id, env2.proposals[0].proposal_id);
    assert.equal(env1.proposals[1].proposal_id, env2.proposals[1].proposal_id);

    // Different proposals get different IDs
    assert.notEqual(env1.proposals[0].proposal_id, env1.proposals[1].proposal_id);

    // Format: 16 hex chars
    assert.match(env1.proposals[0].proposal_id, /^[0-9a-f]{16}$/);
    assert.match(env1.proposals[1].proposal_id, /^[0-9a-f]{16}$/);
  });

  it('produces different proposal_ids for different feed_ids', () => {
    const env1 = emitEnvelope({
      feed_id: 'usgs_m4.5_hour',
      feed_profile: TREMOR_PROFILE,
      proposals: [TREMOR_PROPOSALS[0]],
    });

    const env2 = emitEnvelope({
      feed_id: 'usgs_m4.5_day',
      feed_profile: TREMOR_PROFILE,
      proposals: [TREMOR_PROPOSALS[0]],
    });

    assert.notEqual(env1.proposals[0].proposal_id, env2.proposals[0].proposal_id);
  });

  it('handles empty proposals array', () => {
    const env = emitEnvelope({
      feed_id: 'empty_feed',
      feed_profile: TREMOR_PROFILE,
      proposals: [],
    });

    assert.deepEqual(env.proposals, []);
    assert.equal(env.usefulness_scores, null);
  });

  it('includes source_metadata when provided', () => {
    const env = emitEnvelope({
      feed_id: 'usgs_m4.5_hour',
      feed_profile: TREMOR_PROFILE,
      proposals: [],
      source_metadata: {
        source_id: 'usgs_automatic',
        trust_tier: 'T1',
        endpoint: 'https://earthquake.usgs.gov/...',
        poll_interval_ms: 60000,
        event_count: 18,
      },
    });

    assert.equal(env.source_metadata.source_id, 'usgs_automatic');
    assert.equal(env.source_metadata.trust_tier, 'T1');
  });

  it('computes usefulness scores when score_usefulness=true', () => {
    const env = emitEnvelope({
      feed_id: 'test',
      feed_profile: TREMOR_PROFILE,
      proposals: TREMOR_PROPOSALS,
      score_usefulness: true,
      source_metadata: { trust_tier: 'T1' },
    });

    // Envelope-level map (backwards compat)
    assert.ok(env.usefulness_scores !== null);
    assert.equal(typeof env.usefulness_scores['0'], 'number');
    assert.equal(typeof env.usefulness_scores['1'], 'number');
    assert.ok(env.usefulness_scores['0'] > 0);
    assert.ok(env.usefulness_scores['0'] <= 1);

    // Per-proposal usefulness_score
    for (let i = 0; i < env.proposals.length; i++) {
      assert.equal(typeof env.proposals[i].usefulness_score, 'number',
        `proposals[${i}].usefulness_score should be a number when scored`);
      assert.ok(env.proposals[i].usefulness_score >= 0 && env.proposals[i].usefulness_score <= 1,
        `proposals[${i}].usefulness_score should be 0-1`);
      assert.equal(env.proposals[i].usefulness_score, env.usefulness_scores[String(i)],
        `proposals[${i}].usefulness_score should match envelope map`);
    }
  });

  it('sets usefulness_score to null when score_usefulness is false', () => {
    const env = emitEnvelope({
      feed_id: 'test',
      feed_profile: TREMOR_PROFILE,
      proposals: TREMOR_PROPOSALS,
    });

    for (let i = 0; i < env.proposals.length; i++) {
      assert.equal(env.proposals[i].usefulness_score, null,
        `proposals[${i}].usefulness_score should be null when not scored`);
    }
    assert.equal(env.usefulness_scores, null);
  });

  it('sets composition to null for single-feed classification', () => {
    const env = emitEnvelope({
      feed_id: 'test',
      feed_profile: TREMOR_PROFILE,
      proposals: [],
    });

    assert.equal(env.composition, null);
  });

  it('includes composition context when provided', () => {
    const env = emitEnvelope({
      feed_id: 'composed',
      feed_profile: TREMOR_PROFILE,
      proposals: TREMOR_PROPOSALS,
      composition: {
        feed_a_id: 'purpleair_sf',
        feed_b_id: 'wind_sf',
        feed_a_role: 'threshold_target',
        feed_b_role: 'arrival_predictor',
        causal_order: { leader: 'B', lag_ms: 7200000 },
        aligned_pair_count: 12,
        rule_fired: 'threshold_with_arrival_predictor',
      },
    });

    assert.equal(env.composition.feed_a_id, 'purpleair_sf');
    assert.equal(env.composition.causal_order.leader, 'B');
    assert.equal(env.composition.rule_fired, 'threshold_with_arrival_predictor');
  });

  it('assigns valid non-null brier_type for every template type', () => {
    const TEMPLATES = [
      { template: 'threshold_gate', expected: 'binary' },
      { template: 'cascade',        expected: 'multi_class' },
      { template: 'divergence',     expected: 'binary' },
      { template: 'regime_shift',   expected: 'binary' },
      { template: 'anomaly',        expected: 'binary' },
      { template: 'persistence',    expected: 'binary' },
    ];

    for (const { template, expected } of TEMPLATES) {
      const env = emitEnvelope({
        feed_id: 'brier_test',
        feed_profile: TREMOR_PROFILE,
        proposals: [{
          template,
          params: {},
          confidence: 0.5,
          rationale: `brier_type test for ${template}`,
        }],
      });

      assert.equal(env.proposals[0].brier_type, expected,
        `${template} should produce brier_type="${expected}"`);
      assert.ok(env.proposals[0].brier_type !== null,
        `${template} brier_type must not be null`);
      assert.ok(['binary', 'multi_class'].includes(env.proposals[0].brier_type),
        `${template} brier_type must be "binary" or "multi_class"`);
    }
  });

  it('nullifies missing optional profile fields', () => {
    const sparse_profile = {
      cadence:      { classification: 'hours' },
      distribution: { type: 'bounded_numeric' },
      noise:        { classification: 'smooth' },
      density:      { classification: 'single_point' },
      thresholds:   { type: 'none' },
    };

    const env = emitEnvelope({
      feed_id: 'sparse',
      feed_profile: sparse_profile,
      proposals: [],
    });

    assert.equal(env.feed_profile.cadence.median_ms, null);
    assert.equal(env.feed_profile.cadence.jitter_coefficient, null);
    assert.equal(env.feed_profile.distribution.min, null);
    assert.equal(env.feed_profile.noise.spike_rate, null);
    assert.equal(env.feed_profile.density.sensor_count, null);
    assert.equal(env.feed_profile.thresholds.detected_thresholds, null);
  });

  it('produces a deterministic envelope when `now` is injected', () => {
    // Identical inputs + identical injected `now` must produce byte-equal
    // envelopes. Without an injectable clock, emitted_at would diverge
    // between calls and any envelope-level hash would be non-deterministic.
    const t = 1700000000000;
    const params = {
      feed_id: 'usgs_m4.5_hour',
      feed_profile: TREMOR_PROFILE,
      proposals: TREMOR_PROPOSALS,
    };

    const e1 = emitEnvelope({ ...params, now: t });
    const e2 = emitEnvelope({ ...params, now: t });

    // Full envelope equality — not just timestamp
    assert.deepStrictEqual(e1, e2);
    // Injected timestamp is honoured
    assert.strictEqual(e1.emitted_at, t);
    assert.strictEqual(e2.emitted_at, t);
  });
});
