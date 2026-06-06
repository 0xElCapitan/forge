/**
 * test/unit/ir.spec.js
 * Tests for the Proposal IR envelope emitter.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { emitEnvelope, BREATH_NORMALIZATION_TRACE, assertNormalizationTrace } from '../../src/ir/emit.js';
import { canonicalize } from '../../src/receipt/canonicalize.js';

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

    assert.equal(env.ir_version, '0.3.0');
    assert.equal(env.forge_version, '0.1.0');
    assert.equal(typeof env.emitted_at_ms, 'number');
    assert.ok(env.emitted_at_ms > 0);
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

  // ── FR-2: classifier_version ─────────────────────────────────────────────

  it('includes classifier_version as a non-null semver string', () => {
    const env = emitEnvelope({
      feed_id: 'test',
      feed_profile: TREMOR_PROFILE,
      proposals: [],
    });

    assert.ok(typeof env.classifier_version === 'string', 'classifier_version must be a string');
    assert.ok(env.classifier_version.length > 0, 'classifier_version must not be empty');
    assert.match(env.classifier_version, /^\d+\.\d+\.\d+$/, 'classifier_version must be semver');
  });

  // ── FR-1: original_hash + hash_algorithm ─────────────────────────────────

  it('sets original_hash and hash_algorithm when rawInput is provided', () => {
    const rawInput = { events: [{ magnitude: 5.1, lat: 37.7, lon: -122.4 }] };
    const env = emitEnvelope({
      feed_id: 'usgs_m4.5_hour',
      feed_profile: TREMOR_PROFILE,
      proposals: TREMOR_PROPOSALS,
      rawInput,
    });

    assert.ok(typeof env.original_hash === 'string', 'original_hash must be a string');
    assert.match(env.original_hash, /^sha256:[0-9a-f]{64}$/, 'original_hash must be sha256:<64 hex>');
    assert.equal(env.hash_algorithm, 'sha256', 'hash_algorithm must be "sha256"');

    // Deterministic: same rawInput → same hash
    const env2 = emitEnvelope({
      feed_id: 'usgs_m4.5_hour',
      feed_profile: TREMOR_PROFILE,
      proposals: TREMOR_PROPOSALS,
      rawInput,
    });
    assert.equal(env.original_hash, env2.original_hash, 'original_hash must be deterministic');
  });

  it('sets original_hash and hash_algorithm to null when rawInput is absent', () => {
    const env = emitEnvelope({
      feed_id: 'test',
      feed_profile: TREMOR_PROFILE,
      proposals: [],
    });

    assert.equal(env.original_hash, null, 'original_hash must be null without rawInput');
    assert.equal(env.hash_algorithm, null, 'hash_algorithm must be null without rawInput');
  });

  it('sets original_hash to null when rawInput contains unhashable types', () => {
    const env = emitEnvelope({
      feed_id: 'test',
      feed_profile: TREMOR_PROFILE,
      proposals: [],
      rawInput: { value: Infinity },
    });

    assert.equal(env.original_hash, null, 'original_hash must be null for unhashable rawInput');
    assert.equal(env.hash_algorithm, null, 'hash_algorithm must be null for unhashable rawInput');
  });

  // ── FR-3: negative_policy_flags ──────────────────────────────────────────

  it('sets negative_policy_flags to null when evaluate_policy is false (default)', () => {
    const env = emitEnvelope({
      feed_id: 'test',
      feed_profile: TREMOR_PROFILE,
      proposals: TREMOR_PROPOSALS,
    });

    assert.equal(env.negative_policy_flags, null,
      'negative_policy_flags must be null when evaluate_policy=false');
  });

  it('returns a sorted string array when evaluate_policy is true', () => {
    const env = emitEnvelope({
      feed_id: 'test',
      feed_profile: TREMOR_PROFILE,
      proposals: TREMOR_PROPOSALS,
      // No source_metadata → no_settlement_authority fires
      evaluate_policy: true,
    });

    assert.ok(Array.isArray(env.negative_policy_flags),
      'negative_policy_flags must be an array when evaluate_policy=true');
    assert.ok(env.negative_policy_flags.includes('no_settlement_authority'),
      'no_settlement_authority should fire when source_metadata is absent');
  });

  it('negative_policy_flags is empty array when no violations', () => {
    const env = emitEnvelope({
      feed_id: 'usgs_m4.5_hour',
      feed_profile: TREMOR_PROFILE,
      proposals: TREMOR_PROPOSALS,
      source_metadata: { trust_tier: 'T1' },  // T1 can settle
      evaluate_policy: true,
    });

    assert.ok(Array.isArray(env.negative_policy_flags));
    assert.equal(env.negative_policy_flags.length, 0,
      'no flags should fire for a T1 source with confident proposals');
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
    // envelopes. Without an injectable clock, emitted_at_ms would diverge
    // between calls and any envelope-level hash would be non-deterministic.
    //
    // Pass deep-cloned inputs to each call so the test stays mutation-blind:
    // a shallow spread would still share `feed_profile` / `proposals` references
    // between e1 and e2, so any internal mutation of params would be invisible
    // to deepStrictEqual (both envelopes would reflect the same mutation).
    const t = 1700000000000;
    const params = {
      feed_id: 'usgs_m4.5_hour',
      feed_profile: TREMOR_PROFILE,
      proposals: TREMOR_PROPOSALS,
    };

    const e1 = emitEnvelope(structuredClone({ ...params, now: t }));
    const e2 = emitEnvelope(structuredClone({ ...params, now: t }));

    // Full envelope equality — not just timestamp
    assert.deepStrictEqual(e1, e2);
    // Injected timestamp is honoured
    assert.strictEqual(e1.emitted_at_ms, t);
    assert.strictEqual(e2.emitted_at_ms, t);
  });

  // ─── Sprint 01 (IR 0.2.0 surface ratification) — T-1, T-2, T-12 ────────────

  it('T-1: every v0.2.0 envelope has verifier_type === echelon-brier/v0', () => {
    const env = emitEnvelope({
      feed_id: 'usgs_m4.5_hour',
      feed_profile: TREMOR_PROFILE,
      proposals: TREMOR_PROPOSALS,
      now: 1700000001000,
    });
    assert.equal(env.verifier_type, 'echelon-brier/v0');

    const empty = emitEnvelope({
      feed_id: 'empty-proposals',
      feed_profile: TREMOR_PROFILE,
      proposals: [],
      now: 1700000001000,
    });
    assert.equal(empty.verifier_type, 'echelon-brier/v0');
  });

  it('T-2: every proposal in a v0.2.0 envelope has claim_shape === event', () => {
    const env = emitEnvelope({
      feed_id: 'usgs_m4.5_hour',
      feed_profile: TREMOR_PROFILE,
      proposals: TREMOR_PROPOSALS,
      now: 1700000001000,
    });
    assert.ok(env.proposals.length > 0, 'fixture must produce at least one proposal');
    for (const p of env.proposals) {
      assert.equal(p.claim_shape, 'event', `proposal ${p.proposal_id} missing claim_shape=event`);
    }
  });

  it('T-12: two emissions with identical inputs and injected clocks produce byte-identical canonical output', () => {
    const t = 1700000000000;
    const params = {
      feed_id: 'usgs_m4.5_hour',
      feed_profile: TREMOR_PROFILE,
      proposals: TREMOR_PROPOSALS,
    };
    const e1 = emitEnvelope(structuredClone({ ...params, now: t }));
    const e2 = emitEnvelope(structuredClone({ ...params, now: t }));
    const c1 = canonicalize(e1);
    const c2 = canonicalize(e2);
    assert.strictEqual(c1, c2, 'canonicalized envelopes must be byte-identical');
  });
});

// ─── Cycle 003 Sprint 01 — emitted_at_ms rename (Lane 1) ───────────────────────

describe('emitEnvelope — emitted_at_ms rename (cycle-003 Lane 1)', () => {
  const baseArgs = {
    feed_id: 'usgs_m4.5_hour',
    feed_profile: TREMOR_PROFILE,
    proposals: TREMOR_PROPOSALS,
    now: 1735689600000,
  };

  it('envelope carries emitted_at_ms (Unix-ms integer); no bare emitted_at key remains', () => {
    const env = emitEnvelope(baseArgs);
    const keys = Object.keys(env);
    // Parsed-key assertions — NOT substring (emitted_at_ms ⊃ emitted_at).
    assert.ok(keys.includes('emitted_at_ms'), 'envelope must carry emitted_at_ms');
    assert.ok(!keys.includes('emitted_at'), 'envelope must NOT carry bare emitted_at');
    assert.equal(env.emitted_at_ms, 1735689600000);
    assert.ok(Number.isInteger(env.emitted_at_ms));
  });

  it('ir_version is 0.3.0 (coordinated breaking bump)', () => {
    assert.equal(emitEnvelope(baseArgs).ir_version, '0.3.0');
  });

  it('injected `now` keeps byte-deterministic equality after the rename', () => {
    const e1 = emitEnvelope(structuredClone(baseArgs));
    const e2 = emitEnvelope(structuredClone(baseArgs));
    assert.deepStrictEqual(e1, e2);
    assert.strictEqual(e1.emitted_at_ms, 1735689600000);
    assert.strictEqual(canonicalize(e1), canonicalize(e2));
  });
});

// ─── Cycle 003 Sprint 01 — normalization_trace provenance (Lane 2) ─────────────

describe('emitEnvelope — normalization_trace producer provenance (cycle-003 Lane 2)', () => {
  const baseArgs = {
    feed_id: 'epa_airnow_aqi',
    feed_profile: TREMOR_PROFILE,
    proposals: [],
    now: 1735689600000,
  };

  it('defaults to present-and-null when no trace is supplied (mirrors negative_policy_flags)', () => {
    const env = emitEnvelope(baseArgs);
    assert.ok('normalization_trace' in env, 'field is present-and-null');
    assert.equal(env.normalization_trace, null);
  });

  it('emits the populated BREATH worked-path trace (object-array; one entry per real normalization)', () => {
    const env = emitEnvelope({ ...baseArgs, normalization_trace: BREATH_NORMALIZATION_TRACE });
    assert.ok(Array.isArray(env.normalization_trace), 'populated as an object-array');
    assert.equal(env.normalization_trace.length, 2);
    for (const entry of env.normalization_trace) {
      assert.deepEqual(
        Object.keys(entry).sort(),
        ['confidence', 'field', 'input_value', 'method', 'normalized_value', 'source'],
        'each entry has exactly the six provenance fields',
      );
      assert.ok(['stated', 'inferred', 'mapped', 'defaulted'].includes(entry.method), 'valid method enum');
      assert.ok(['forge', 'echelon', 'lattice', 'operator'].includes(entry.source), 'valid source enum');
      assert.ok(typeof entry.confidence === 'number' && entry.confidence >= 0 && entry.confidence <= 1);
    }
    // Grounded BREATH normalizations: settlement_source (mapped) + feed_id (stated).
    const byField = Object.fromEntries(env.normalization_trace.map((e) => [e.field, e]));
    assert.equal(byField.settlement_source.method, 'mapped');
    assert.equal(byField.settlement_source.input_value, 'airnow');
    assert.equal(byField.settlement_source.normalized_value, 'airnow');
    assert.equal(byField.feed_id.method, 'stated');
    assert.equal(byField.feed_id.input_value, 'epa_airnow');
    assert.equal(byField.feed_id.normalized_value, 'epa_airnow_aqi');
  });

  it('STATED and INFERRED for the same field stay distinguishable (never collapse — NFR-PROV)', () => {
    const trace = [
      { field: 'settlement_source', input_value: 'airnow', normalized_value: 'airnow', method: 'stated', source: 'operator', confidence: 1.0 },
      { field: 'settlement_source', input_value: 'airnow', normalized_value: 'airnow', method: 'inferred', source: 'forge', confidence: 0.6 },
    ];
    const env = emitEnvelope({ ...baseArgs, normalization_trace: trace });
    assert.equal(env.normalization_trace.length, 2, 'two entries for the same field are NOT merged');
    const methods = env.normalization_trace.map((e) => e.method);
    assert.ok(methods.includes('stated') && methods.includes('inferred'), 'both provenance states survive distinctly');
    assert.notDeepStrictEqual(env.normalization_trace[0], env.normalization_trace[1]);
  });

  it('validates entry shape — rejects bad method, bad source, out-of-range confidence, extra/missing fields, non-array', () => {
    const good = { field: 'f', input_value: 1, normalized_value: 1, method: 'mapped', source: 'forge', confidence: 1 };
    assert.throws(() => emitEnvelope({ ...baseArgs, normalization_trace: [{ ...good, method: 'guessed' }] }), /method/);
    assert.throws(() => emitEnvelope({ ...baseArgs, normalization_trace: [{ ...good, source: 'martian' }] }), /source/);
    assert.throws(() => emitEnvelope({ ...baseArgs, normalization_trace: [{ ...good, confidence: 1.5 }] }), /confidence/);
    assert.throws(() => emitEnvelope({ ...baseArgs, normalization_trace: [{ ...good, extra: true }] }), /unexpected field/);
    const { confidence, ...missing } = good;
    assert.throws(() => emitEnvelope({ ...baseArgs, normalization_trace: [missing] }), /missing required field/);
    assert.throws(() => emitEnvelope({ ...baseArgs, normalization_trace: 'not-an-array' }), /must be an array or null/);
  });

  it('assertNormalizationTrace returns null for null and the array for a valid trace', () => {
    assert.equal(assertNormalizationTrace(null), null);
    assert.equal(assertNormalizationTrace(BREATH_NORMALIZATION_TRACE), BREATH_NORMALIZATION_TRACE);
  });
});
