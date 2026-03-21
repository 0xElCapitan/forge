/**
 * test/unit/rlmf.spec.js
 * Unit tests for RLMF certificates, usefulness filter, and composition layer.
 *
 * Covers: rlmf/certificates.js, filter/usefulness.js, composer/compose.js
 *
 * node --test test/unit/rlmf.spec.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { brierScoreBinary, brierScoreMultiClass, exportCertificate }
  from '../../src/rlmf/certificates.js';

import { computeUsefulness } from '../../src/filter/usefulness.js';

import { alignFeeds, detectCausalOrdering } from '../../src/composer/compose.js';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const NOW = 1_000_000_000_000;

/** Minimal resolved binary theatre */
function resolvedBinaryTheatre(outcome, probability, template = 'threshold_gate') {
  return {
    template,
    params: { threshold: 5.0, window_hours: 24 },
    status: 'resolved',
    created_at: NOW,
    expires_at: NOW + 86_400_000,
    position_probability: probability,
    position_history: [{ timestamp: NOW + 3600, probability }],
    resolution: {
      outcome,
      settled_at: NOW + 7200,
      settlement_class: 'oracle',
    },
  };
}

/** Minimal resolved cascade theatre */
function resolvedCascadeTheatre(outcome_bucket, distribution) {
  return {
    template: 'cascade',
    params: { trigger_threshold: 6.0, bucket_count: 5, window_hours: 72 },
    status: 'resolved',
    created_at: NOW,
    expires_at: NOW + 259_200_000,
    position_probability: null,
    position_distribution: distribution,
    position_history: [],
    resolution: {
      outcome: outcome_bucket,
      settled_at: NOW + 10_000,
      settlement_class: 'oracle',
    },
  };
}

/** Open (unresolved) theatre */
function openTheatre() {
  return {
    template: 'threshold_gate',
    params: { threshold: 3.0, window_hours: 24 },
    status: 'open',
    created_at: NOW,
    expires_at: NOW + 86_400_000,
    position_probability: 0.4,
    position_history: [],
    resolution: null,
  };
}

/** Expired theatre */
function expiredTheatre() {
  return {
    template: 'anomaly',
    params: { baseline_metric: 'b-value', window_hours: 168 },
    status: 'expired',
    created_at: NOW,
    expires_at: NOW + 86_400_000,
    position_probability: 0.35,
    position_history: [],
    resolution: { outcome: null, settled_at: NOW + 80_000, settlement_class: 'expired' },
  };
}

// ─── brierScoreBinary ─────────────────────────────────────────────────────────

describe('brierScoreBinary', () => {
  it('perfect forecast when outcome=true, probability=1.0 → BS=0', () => {
    assert.equal(brierScoreBinary(true, 1.0), 0);
  });

  it('perfect forecast when outcome=false, probability=0.0 → BS=0', () => {
    assert.equal(brierScoreBinary(false, 0.0), 0);
  });

  it('worst forecast when outcome=true, probability=0.0 → BS=1', () => {
    assert.equal(brierScoreBinary(true, 0.0), 1);
  });

  it('worst forecast when outcome=false, probability=1.0 → BS=1', () => {
    assert.equal(brierScoreBinary(false, 1.0), 1);
  });

  it('climatological 50/50 → BS=0.25', () => {
    assert.ok(Math.abs(brierScoreBinary(true, 0.5) - 0.25) < 1e-10);
    assert.ok(Math.abs(brierScoreBinary(false, 0.5) - 0.25) < 1e-10);
  });

  it('probability 0.7, outcome=true → (0.7-1)²=0.09', () => {
    assert.ok(Math.abs(brierScoreBinary(true, 0.7) - 0.09) < 1e-10);
  });

  it('probability 0.7, outcome=false → (0.7-0)²=0.49', () => {
    assert.ok(Math.abs(brierScoreBinary(false, 0.7) - 0.49) < 1e-10);
  });

  it('numeric 0/1 outcomes work identically to false/true', () => {
    assert.equal(brierScoreBinary(1, 0.8), brierScoreBinary(true, 0.8));
    assert.equal(brierScoreBinary(0, 0.3), brierScoreBinary(false, 0.3));
  });
});

// ─── brierScoreMultiClass ─────────────────────────────────────────────────────

describe('brierScoreMultiClass', () => {
  const UNIFORM = [0.2, 0.2, 0.2, 0.2, 0.2];
  const PERFECT_0 = [1.0, 0.0, 0.0, 0.0, 0.0];
  const PERFECT_2 = [0.0, 0.0, 1.0, 0.0, 0.0];

  it('perfect forecast for bucket 0 → BS=0', () => {
    assert.equal(brierScoreMultiClass(0, PERFECT_0), 0);
  });

  it('perfect forecast for bucket 2 → BS=0', () => {
    assert.equal(brierScoreMultiClass(2, PERFECT_2), 0);
  });

  it('worst case: all probability on wrong bucket (5 buckets) → BS=2', () => {
    // predict bucket 0 with certainty, actual is bucket 1
    // (1-0)² + (0-1)² + (0-0)² + (0-0)² + (0-0)² = 1 + 1 = 2
    assert.equal(brierScoreMultiClass(1, PERFECT_0), 2);
  });

  it('uniform distribution, outcome=0 → Σ(0.2-oᵢ)²', () => {
    // (0.2-1)² + 4*(0.2-0)² = 0.64 + 4*0.04 = 0.64 + 0.16 = 0.8
    assert.ok(Math.abs(brierScoreMultiClass(0, UNIFORM) - 0.8) < 1e-10);
  });

  it('returns a number', () => {
    assert.equal(typeof brierScoreMultiClass(2, UNIFORM), 'number');
  });

  it('smaller BS for better calibrated forecast', () => {
    const good = [0.7, 0.2, 0.05, 0.03, 0.02];  // bucket 0 wins, predicted 0.7
    const poor = [0.1, 0.3, 0.3, 0.2, 0.1];      // bucket 0 wins, predicted 0.1
    assert.ok(brierScoreMultiClass(0, good) < brierScoreMultiClass(0, poor));
  });
});

// ─── exportCertificate ────────────────────────────────────────────────────────

describe('exportCertificate', () => {
  it('resolved binary theatre produces correct certificate shape', () => {
    const theatre = resolvedBinaryTheatre(true, 0.8);
    const cert = exportCertificate(theatre, { theatre_id: 'th-001' });

    assert.equal(cert.theatre_id, 'th-001');
    assert.equal(cert.template, 'threshold_gate');
    assert.equal(cert.outcome, true);
    assert.equal(cert.settlement_class, 'oracle');
    assert.equal(cert.final_probability, 0.8);
    assert.ok(typeof cert.brier_score === 'number');
    assert.ok(Array.isArray(cert.position_history));
    assert.ok(typeof cert.created_at === 'number');
    assert.ok(typeof cert.resolved_at === 'number');
  });

  it('resolved binary outcome=true, probability=0.8 → BS=(0.8-1)²=0.04', () => {
    const cert = exportCertificate(resolvedBinaryTheatre(true, 0.8));
    assert.ok(Math.abs(cert.brier_score - 0.04) < 1e-10);
  });

  it('resolved binary outcome=false, probability=0.2 → BS=(0.2-0)²=0.04', () => {
    const cert = exportCertificate(resolvedBinaryTheatre(false, 0.2));
    assert.ok(Math.abs(cert.brier_score - 0.04) < 1e-10);
  });

  it('resolved cascade theatre uses multi-class Brier scorer', () => {
    const dist = [0.7, 0.2, 0.05, 0.03, 0.02];
    const cert = exportCertificate(resolvedCascadeTheatre(0, dist));
    // Expected: brierScoreMultiClass(0, dist) = (0.7-1)² + (0.2-0)² + ...
    const expected = brierScoreMultiClass(0, dist);
    assert.ok(Math.abs(cert.brier_score - expected) < 1e-10);
  });

  it('open (unresolved) theatre has brier_score: null', () => {
    const cert = exportCertificate(openTheatre());
    assert.equal(cert.brier_score, null);
    assert.equal(cert.resolved_at, null);
    assert.equal(cert.settlement_class, null);
  });

  it('expired theatre has brier_score: null (no outcome)', () => {
    const cert = exportCertificate(expiredTheatre());
    assert.equal(cert.brier_score, null);
    assert.equal(cert.outcome, null);
    assert.equal(cert.settlement_class, 'expired');
  });

  it('theatre_id defaults to null', () => {
    const cert = exportCertificate(resolvedBinaryTheatre(false, 0.1));
    assert.equal(cert.theatre_id, null);
  });

  it('position_history is included', () => {
    const cert = exportCertificate(resolvedBinaryTheatre(true, 0.9));
    assert.ok(Array.isArray(cert.position_history));
    assert.equal(cert.position_history.length, 1);
  });

  it('params are preserved in certificate', () => {
    const cert = exportCertificate(resolvedBinaryTheatre(true, 0.5));
    assert.deepEqual(cert.params, { threshold: 5.0, window_hours: 24 });
  });

  it('anomaly template uses binary Brier scorer', () => {
    const theatre = {
      ...resolvedBinaryTheatre(true, 0.6, 'anomaly'),
      params: { baseline_metric: 'b-value', window_hours: 168 },
    };
    const cert = exportCertificate(theatre);
    // binary: (0.6 - 1)² = 0.16
    assert.ok(Math.abs(cert.brier_score - 0.16) < 1e-10);
  });
});

// ─── computeUsefulness ────────────────────────────────────────────────────────

describe('computeUsefulness', () => {
  const proposal = { template: 'threshold_gate', params: {}, confidence: 1.0, rationale: '' };

  // AirNow-like feed: T1 official, regulatory, multi-cadence, multi-tier
  const airnowProfile = {
    cadence:      { classification: 'multi_cadence' },
    distribution: { type: 'bounded_numeric' },
    noise:        { classification: 'mixed' },
    density:      { classification: 'multi_tier' },
    thresholds:   { type: 'regulatory', values: [51, 101, 151, 201, 301] },
  };

  // PurpleAir-like feed: T3 signal, same physical profile but community source
  const purpleairProfile = { ...airnowProfile };

  // ThingSpeak temperature: T3, no regulatory threshold, single_point, hours
  const thingspeakProfile = {
    cadence:      { classification: 'hours' },
    distribution: { type: 'bounded_numeric' },
    noise:        { classification: 'cyclical' },
    density:      { classification: 'single_point' },
    thresholds:   { type: 'statistical' },
  };

  // EPA AQI: T0, regulatory, multi-tier, multi-cadence
  const epaProfile = { ...airnowProfile };

  it('returns a number in [0, 1]', () => {
    const score = computeUsefulness(proposal, airnowProfile, { source_tier: 'T1' });
    assert.ok(typeof score === 'number');
    assert.ok(score >= 0 && score <= 1, `score ${score} out of [0,1]`);
  });

  it('is deterministic — same inputs always produce the same output', () => {
    const a = computeUsefulness(proposal, airnowProfile, { source_tier: 'T1' });
    const b = computeUsefulness(proposal, airnowProfile, { source_tier: 'T1' });
    assert.equal(a, b);
  });

  // ── CRITICAL: PurpleAir (T3) scores lower than AirNow (T1) ─────────────────
  it('PurpleAir proposal (T3) scores lower than AirNow proposal (T1)', () => {
    const airnow   = computeUsefulness(proposal, airnowProfile,   { source_tier: 'T1' });
    const purpleair = computeUsefulness(proposal, purpleairProfile, { source_tier: 'T3' });
    assert.ok(
      purpleair < airnow,
      `PurpleAir (T3) usefulness ${purpleair} should be < AirNow (T1) ${airnow}`,
    );
  });

  // ── CRITICAL: ThingSpeak temp scores lower than EPA AQI ────────────────────
  it('ThingSpeak temperature scores lower than EPA AQI proposal', () => {
    const epa        = computeUsefulness(proposal, epaProfile,        { source_tier: 'T0' });
    const thingspeak = computeUsefulness(proposal, thingspeakProfile, { source_tier: 'T3' });
    assert.ok(
      thingspeak < epa,
      `ThingSpeak (statistical, single_point, T3) ${thingspeak} should be < EPA AQI (regulatory, multi_tier, T0) ${epa}`,
    );
  });

  it('higher-tier source scores higher usefulness for same feed profile', () => {
    const t0 = computeUsefulness(proposal, airnowProfile, { source_tier: 'T0' });
    const t1 = computeUsefulness(proposal, airnowProfile, { source_tier: 'T1' });
    const t2 = computeUsefulness(proposal, airnowProfile, { source_tier: 'T2' });
    const t3 = computeUsefulness(proposal, airnowProfile, { source_tier: 'T3' });
    assert.ok(t0 > t1, `T0 ${t0} > T1 ${t1}`);
    assert.ok(t1 > t2, `T1 ${t1} > T2 ${t2}`);
    assert.ok(t2 > t3, `T2 ${t2} > T3 ${t3}`);
  });

  it('regulatory threshold boosts usefulness vs statistical threshold', () => {
    const reg  = computeUsefulness(proposal, airnowProfile,   { source_tier: 'T1' });
    const stat = computeUsefulness(proposal, thingspeakProfile, { source_tier: 'T1' });
    assert.ok(reg > stat, `regulatory ${reg} > statistical ${stat}`);
  });

  it('single_point density reduces usefulness vs multi_tier', () => {
    const multi  = computeUsefulness(proposal, airnowProfile,    { source_tier: 'T1' });
    const single = computeUsefulness(proposal, thingspeakProfile, { source_tier: 'T1' });
    assert.ok(multi > single, `multi_tier ${multi} > single_point ${single}`);
  });

  it('returns 0 for degenerate profile (all null)', () => {
    const score = computeUsefulness(proposal, {}, { source_tier: 'unknown' });
    assert.ok(score >= 0 && score <= 1);
  });
});

// ─── alignFeeds ───────────────────────────────────────────────────────────────

describe('alignFeeds', () => {
  const evA = [
    { timestamp: 1000, value: 10 },
    { timestamp: 2000, value: 20 },
    { timestamp: 4000, value: 40 },
  ];
  const evB = [
    { timestamp: 1100, value: 11 },  // matches A[0] (100ms diff)
    { timestamp: 2050, value: 21 },  // matches A[1] (50ms diff)
    { timestamp: 5000, value: 50 },  // 1000ms from A[2] — outside 900ms window
  ];

  it('returns aligned pairs within window', () => {
    const pairs = alignFeeds(evA, evB, 500);
    assert.equal(pairs.length, 2);  // A[2]/B[2] are 1000ms apart → not paired
    assert.equal(pairs[0].a.timestamp, 1000);
    assert.equal(pairs[0].b.timestamp, 1100);
    assert.equal(pairs[1].a.timestamp, 2000);
    assert.equal(pairs[1].b.timestamp, 2050);
  });

  it('wider window includes more pairs', () => {
    const pairs = alignFeeds(evA, evB, 2000);
    assert.equal(pairs.length, 3);
  });

  it('empty eventsB returns empty', () => {
    assert.deepEqual(alignFeeds(evA, [], 500), []);
  });

  it('empty eventsA returns empty', () => {
    assert.deepEqual(alignFeeds([], evB, 500), []);
  });

  it('non-array inputs return empty', () => {
    assert.deepEqual(alignFeeds(null, evB, 500), []);
    assert.deepEqual(alignFeeds(evA, null, 500), []);
  });

  it('window=0 only matches exact timestamp pairs', () => {
    const a = [{ timestamp: 1000, value: 1 }];
    const b = [{ timestamp: 1000, value: 2 }, { timestamp: 1001, value: 3 }];
    const pairs = alignFeeds(a, b, 0);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].b.timestamp, 1000);
  });
});

// ─── detectCausalOrdering ─────────────────────────────────────────────────────

describe('detectCausalOrdering', () => {
  it('empty pairs → concurrent, lag_ms: 0', () => {
    const result = detectCausalOrdering([]);
    assert.deepEqual(result, { leader: 'concurrent', lag_ms: 0 });
  });

  it('null/undefined → concurrent, lag_ms: 0', () => {
    assert.deepEqual(detectCausalOrdering(null), { leader: 'concurrent', lag_ms: 0 });
    assert.deepEqual(detectCausalOrdering(undefined), { leader: 'concurrent', lag_ms: 0 });
  });

  it('A consistently precedes B → A leads', () => {
    // A timestamps are 5 seconds before B timestamps
    const pairs = [
      { a: { timestamp: 1000 }, b: { timestamp: 6000 } },
      { a: { timestamp: 2000 }, b: { timestamp: 7000 } },
      { a: { timestamp: 3000 }, b: { timestamp: 8000 } },
    ];
    // mean diff = (1000-6000 + 2000-7000 + 3000-8000) / 3 = -15000/3 = -5000
    // negative → A leads
    const result = detectCausalOrdering(pairs);
    assert.equal(result.leader, 'A');
    assert.equal(result.lag_ms, 5000);
  });

  it('B consistently precedes A → B leads', () => {
    const pairs = [
      { a: { timestamp: 6000 }, b: { timestamp: 1000 } },
      { a: { timestamp: 7000 }, b: { timestamp: 2000 } },
    ];
    // mean diff = (5000 + 5000)/2 = 5000 positive → B leads
    const result = detectCausalOrdering(pairs);
    assert.equal(result.leader, 'B');
    assert.equal(result.lag_ms, 5000);
  });

  it('near-zero mean diff (<1s) → concurrent', () => {
    const pairs = [
      { a: { timestamp: 1000 }, b: { timestamp: 1100 } },  // A-B = -100
      { a: { timestamp: 2000 }, b: { timestamp: 1900 } },  // A-B = +100
    ];
    // mean diff = 0 → concurrent
    const result = detectCausalOrdering(pairs);
    assert.equal(result.leader, 'concurrent');
    assert.equal(result.lag_ms, 0);
  });

  it('lag_ms is rounded to integer', () => {
    const pairs = [
      { a: { timestamp: 1001 }, b: { timestamp: 4002 } },  // diff = -3001
      { a: { timestamp: 2000 }, b: { timestamp: 5000 } },  // diff = -3000
    ];
    const result = detectCausalOrdering(pairs);
    assert.equal(typeof result.lag_ms, 'number');
    assert.equal(Number.isInteger(result.lag_ms), true);
  });
});
