/**
 * test/unit/theatres.spec.js
 * Unit tests for all six generalized theatre templates.
 *
 * Tests use synthetic evidence bundles with injectable clocks.
 * Each template: create → process → expire/resolve lifecycle.
 *
 * node --test test/unit/theatres.spec.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createThresholdGate,
  processThresholdGate,
  expireThresholdGate,
  resolveThresholdGate,
} from '../../src/theatres/threshold-gate.js';

import {
  createCascade,
  processCascade,
  expireCascade,
  resolveCascade,
} from '../../src/theatres/cascade.js';

import {
  createDivergence,
  processDivergence,
  expireDivergence,
  resolveDivergence,
} from '../../src/theatres/divergence.js';

import {
  createRegimeShift,
  processRegimeShift,
  expireRegimeShift,
  resolveRegimeShift,
} from '../../src/theatres/regime-shift.js';

import {
  createPersistence,
  processPersistence,
  expirePersistence,
  resolvePersistence,
} from '../../src/theatres/persistence.js';

import {
  createAnomaly,
  processAnomaly,
  expireAnomaly,
  resolveAnomaly,
} from '../../src/theatres/anomaly.js';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const NOW = 1_000_000_000_000;  // fixed clock for all tests
const bundle = (value, opts = {}) => ({
  value,
  timestamp: opts.timestamp ?? NOW + 1000,
  doubt_price: opts.doubt_price ?? 0,
  ...opts,
});

// ─── threshold-gate ───────────────────────────────────────────────────────────

describe('createThresholdGate', () => {
  it('returns status=open', () => {
    const t = createThresholdGate({ threshold: 5.0, window_hours: 24, base_rate: 0.1 }, { now: NOW });
    assert.strictEqual(t.status, 'open');
  });

  it('returns template=threshold_gate', () => {
    const t = createThresholdGate({ threshold: 5.0, window_hours: 24 }, { now: NOW });
    assert.strictEqual(t.template, 'threshold_gate');
  });

  it('sets expires_at correctly', () => {
    const t = createThresholdGate({ threshold: 5.0, window_hours: 24 }, { now: NOW });
    assert.strictEqual(t.expires_at, NOW + 24 * 3_600_000);
  });

  it('uses base_rate as initial position_probability', () => {
    const t = createThresholdGate({ threshold: 5.0, window_hours: 24, base_rate: 0.12 }, { now: NOW });
    assert.strictEqual(t.position_probability, 0.12);
  });

  it('defaults position_probability to 0.5 when base_rate is null', () => {
    const t = createThresholdGate({ threshold: 5.0, window_hours: 24, base_rate: null }, { now: NOW });
    assert.strictEqual(t.position_probability, 0.5);
  });

  it('starts with empty position_history and null resolution', () => {
    const t = createThresholdGate({ threshold: 5.0, window_hours: 24 }, { now: NOW });
    assert.deepStrictEqual(t.position_history, []);
    assert.strictEqual(t.resolution, null);
  });
});

describe('processThresholdGate — numeric threshold', () => {
  const params = { threshold: 5.0, window_hours: 24, base_rate: 0.5, input_mode: 'single' };

  it('crossing value → high probability (no doubt)', () => {
    const t = createThresholdGate(params, { now: NOW });
    const t2 = processThresholdGate(t, bundle(6.0));
    assert.strictEqual(t2.position_probability, 1.0);  // doubt=0 → 1 - 0/2
  });

  it('non-crossing value → low probability (no doubt)', () => {
    const t = createThresholdGate(params, { now: NOW });
    const t2 = processThresholdGate(t, bundle(4.0));
    assert.strictEqual(t2.position_probability, 0.0);  // doubt=0 → 0/2
  });

  it('crossing with doubt=0.4 → probability = 0.8', () => {
    const t = createThresholdGate(params, { now: NOW });
    const t2 = processThresholdGate(t, bundle(6.0, { doubt_price: 0.4 }));
    assert.strictEqual(t2.position_probability, 0.8);  // 1 - 0.4/2
  });

  it('non-crossing with doubt=0.4 → probability = 0.2', () => {
    const t = createThresholdGate(params, { now: NOW });
    const t2 = processThresholdGate(t, bundle(4.0, { doubt_price: 0.4 }));
    assert.strictEqual(t2.position_probability, 0.2);  // 0.4/2
  });

  it('appends to position_history', () => {
    const t = createThresholdGate(params, { now: NOW });
    const t2 = processThresholdGate(t, bundle(6.0, { timestamp: NOW + 100 }));
    assert.strictEqual(t2.position_history.length, 1);
    assert.strictEqual(t2.position_history[0].timestamp, NOW + 100);
  });

  it('does not modify closed theatre', () => {
    const t = createThresholdGate(params, { now: NOW });
    const expired = expireThresholdGate(t, { now: NOW + 1 });
    const t2 = processThresholdGate(expired, bundle(6.0));
    assert.strictEqual(t2.status, 'expired');
    assert.deepStrictEqual(t2.position_history, expired.position_history);
  });
});

describe('processThresholdGate — null threshold (probability feed)', () => {
  it('uses bundle.value directly as probability', () => {
    const t = createThresholdGate({ threshold: null, window_hours: 6, base_rate: null }, { now: NOW });
    const t2 = processThresholdGate(t, bundle(0.73));
    assert.strictEqual(t2.position_probability, 0.73);
  });

  it('clamps value > 1 to 1', () => {
    const t = createThresholdGate({ threshold: null, window_hours: 6, base_rate: null }, { now: NOW });
    const t2 = processThresholdGate(t, bundle(1.5));
    assert.strictEqual(t2.position_probability, 1.0);
  });
});

describe('processThresholdGate — multi input mode', () => {
  const params = { threshold: 5.0, window_hours: 72, input_mode: 'multi', base_rate: 0.5 };

  it('averages crossing probabilities across sources', () => {
    const t = createThresholdGate(params, { now: NOW });
    // Source 1: value=6 (crosses) doubt=0 → P=1.0
    // Source 2: value=4 (no cross) doubt=0 → P=0.0
    // Average = 0.5
    const t2 = processThresholdGate(t, {
      timestamp: NOW + 1,
      sources: [
        { value: 6.0, doubt_price: 0 },
        { value: 4.0, doubt_price: 0 },
      ],
    });
    assert.strictEqual(t2.position_probability, 0.5);
  });

  it('all-crossing sources → probability near 1', () => {
    const t = createThresholdGate(params, { now: NOW });
    const t2 = processThresholdGate(t, {
      timestamp: NOW + 1,
      sources: [
        { value: 6.0, doubt_price: 0 },
        { value: 7.0, doubt_price: 0 },
      ],
    });
    assert.strictEqual(t2.position_probability, 1.0);
  });

  it('falls back to single-source when sources absent', () => {
    const t = createThresholdGate(params, { now: NOW });
    const t2 = processThresholdGate(t, bundle(6.0));
    assert.strictEqual(t2.position_probability, 1.0);
  });
});

describe('expireThresholdGate / resolveThresholdGate', () => {
  it('expireThresholdGate sets status=expired, outcome=null', () => {
    const t = createThresholdGate({ threshold: 5.0, window_hours: 24 }, { now: NOW });
    const expired = expireThresholdGate(t, { now: NOW + 1 });
    assert.strictEqual(expired.status, 'expired');
    assert.strictEqual(expired.resolution.outcome, null);
    assert.strictEqual(expired.resolution.settlement_class, 'expired');
  });

  it('resolveThresholdGate true → probability=1, status=resolved', () => {
    const t = createThresholdGate({ threshold: 5.0, window_hours: 24 }, { now: NOW });
    const resolved = resolveThresholdGate(t, true, 'oracle', { now: NOW + 1 });
    assert.strictEqual(resolved.status, 'resolved');
    assert.strictEqual(resolved.position_probability, 1);
    assert.strictEqual(resolved.resolution.outcome, true);
  });

  it('resolveThresholdGate false → probability=0', () => {
    const t = createThresholdGate({ threshold: 5.0, window_hours: 24 }, { now: NOW });
    const resolved = resolveThresholdGate(t, false, 'oracle', { now: NOW + 1 });
    assert.strictEqual(resolved.position_probability, 0);
  });

  it('expireThresholdGate is idempotent on already-closed theatre', () => {
    const t = createThresholdGate({ threshold: 5.0, window_hours: 24 }, { now: NOW });
    const expired = expireThresholdGate(t, { now: NOW + 1 });
    const expired2 = expireThresholdGate(expired, { now: NOW + 2 });
    assert.strictEqual(expired2.resolution.settled_at, expired.resolution.settled_at);
  });
});

// ─── cascade ──────────────────────────────────────────────────────────────────

describe('createCascade', () => {
  it('returns template=cascade, status=open', () => {
    const t = createCascade({ trigger_threshold: 6.0, bucket_count: 5, window_hours: 72, prior_model: 'uniform' }, { now: NOW });
    assert.strictEqual(t.template, 'cascade');
    assert.strictEqual(t.status, 'open');
  });

  it('position_distribution is 5 elements summing to 1', () => {
    const t = createCascade({ trigger_threshold: 6.0, bucket_count: 5, window_hours: 72, prior_model: 'uniform' }, { now: NOW });
    assert.strictEqual(t.position_distribution.length, 5);
    const sum = t.position_distribution.reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `distribution must sum to 1, got ${sum}`);
  });

  it('uniform prior gives equal buckets', () => {
    const t = createCascade({ trigger_threshold: 6.0, bucket_count: 5, window_hours: 72, prior_model: 'uniform' }, { now: NOW });
    for (const p of t.position_distribution) {
      assert.strictEqual(p, 0.2);
    }
  });

  it('omori prior is front-loaded (bucket 1 > bucket 4)', () => {
    const t = createCascade({ trigger_threshold: 6.0, bucket_count: 5, window_hours: 72, prior_model: 'omori' }, { now: NOW });
    assert.ok(t.position_distribution[1] > t.position_distribution[4]);
  });

  it('null prior_model defaults to uniform', () => {
    const t = createCascade({ trigger_threshold: 6.0, bucket_count: 5, window_hours: 72, prior_model: null }, { now: NOW });
    const uniform = createCascade({ trigger_threshold: 6.0, bucket_count: 5, window_hours: 72, prior_model: 'uniform' }, { now: NOW });
    assert.deepStrictEqual(t.position_distribution, uniform.position_distribution);
  });

  it('starts with observed_count=0', () => {
    const t = createCascade({ trigger_threshold: 6.0, bucket_count: 5, window_hours: 72, prior_model: null }, { now: NOW });
    assert.strictEqual(t.observed_count, 0);
  });
});

describe('processCascade', () => {
  const params = { trigger_threshold: 6.0, bucket_count: 5, window_hours: 72, prior_model: 'uniform' };

  it('sub-threshold event → no change', () => {
    const t = createCascade(params, { now: NOW });
    const t2 = processCascade(t, bundle(5.9, { timestamp: NOW + 3_600_000 }));
    assert.strictEqual(t2.observed_count, 0);
    assert.deepStrictEqual(t2.position_distribution, t.position_distribution);
  });

  it('trigger-crossing event increments observed_count', () => {
    const t = createCascade(params, { now: NOW });
    const t2 = processCascade(t, bundle(7.0, { timestamp: NOW + 3_600_000 }));
    assert.strictEqual(t2.observed_count, 1);
  });

  it('trigger-crossing event updates position_history', () => {
    const t = createCascade(params, { now: NOW });
    const t2 = processCascade(t, bundle(7.0, { timestamp: NOW + 3_600_000 }));
    assert.strictEqual(t2.position_history.length, 1);
    assert.strictEqual(t2.position_history[0].distribution.length, 5);
  });

  it('distribution still sums to 1 after update', () => {
    const t = createCascade(params, { now: NOW });
    const t2 = processCascade(t, bundle(7.0, { timestamp: NOW + 3_600_000 }));
    const sum = t2.position_distribution.reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `must sum to 1, got ${sum}`);
  });

  it('multiple events shift distribution toward higher buckets', () => {
    let t = createCascade(params, { now: NOW });
    for (let i = 1; i <= 5; i++) {
      t = processCascade(t, bundle(7.0, { timestamp: NOW + i * 3_600_000 }));
    }
    // After 5 events, bucket 2 (3-5 events) should be prominent
    assert.ok(t.position_distribution[0] < 0.5, 'zero-event bucket should shrink');
  });

  it('does not modify closed theatre', () => {
    const t = createCascade(params, { now: NOW });
    const expired = expireCascade(t, { now: NOW + 1 });
    const t2 = processCascade(expired, bundle(7.0, { timestamp: NOW + 3_600_000 }));
    assert.strictEqual(t2.observed_count, expired.observed_count);
  });
});

describe('expireCascade / resolveCascade', () => {
  const params = { trigger_threshold: 6.0, bucket_count: 5, window_hours: 72, prior_model: null };

  it('expireCascade sets status=expired', () => {
    const t = createCascade(params, { now: NOW });
    const expired = expireCascade(t, { now: NOW + 1 });
    assert.strictEqual(expired.status, 'expired');
    assert.strictEqual(expired.resolution.settlement_class, 'expired');
  });

  it('resolveCascade(0) assigns outcome_bucket=0', () => {
    const t = createCascade(params, { now: NOW });
    const resolved = resolveCascade(t, 0, 'oracle', { now: NOW + 1 });
    assert.strictEqual(resolved.resolution.outcome_bucket, 0);
    assert.strictEqual(resolved.position_distribution[0], 1);
  });

  it('resolveCascade(2) assigns outcome_bucket=1', () => {
    const t = createCascade(params, { now: NOW });
    const resolved = resolveCascade(t, 2, 'oracle', { now: NOW + 1 });
    assert.strictEqual(resolved.resolution.outcome_bucket, 1);
  });

  it('resolveCascade(12) assigns outcome_bucket=4', () => {
    const t = createCascade(params, { now: NOW });
    const resolved = resolveCascade(t, 12, 'oracle', { now: NOW + 1 });
    assert.strictEqual(resolved.resolution.outcome_bucket, 4);
    assert.strictEqual(resolved.position_distribution[4], 1);
  });
});

// ─── divergence ───────────────────────────────────────────────────────────────

describe('createDivergence', () => {
  it('returns template=divergence, status=open', () => {
    const t = createDivergence({ source_a_type: 'automatic', source_b_type: 'reviewed', divergence_threshold: 0.3, resolution_mode: 'expiry' }, { now: NOW });
    assert.strictEqual(t.template, 'divergence');
    assert.strictEqual(t.status, 'open');
  });

  it('starts with both sources null', () => {
    const t = createDivergence({ source_a_type: 'automatic', source_b_type: 'reviewed', divergence_threshold: null, resolution_mode: 'expiry' }, { now: NOW });
    assert.strictEqual(t.source_a_latest, null);
    assert.strictEqual(t.source_b_latest, null);
  });

  it('initial position_probability = 0.5', () => {
    const t = createDivergence({ source_a_type: 'a', source_b_type: 'b', divergence_threshold: 0.3, resolution_mode: 'expiry' }, { now: NOW });
    assert.strictEqual(t.position_probability, 0.5);
  });
});

describe('processDivergence — routing and probability', () => {
  const params = {
    source_a_type: 'automatic',
    source_b_type: 'reviewed',
    divergence_threshold: 0.3,
    resolution_mode: 'expiry',
  };

  it('bundle without source_id routes to source A', () => {
    const t = createDivergence(params, { now: NOW });
    const t2 = processDivergence(t, bundle(5.0, { timestamp: NOW + 1 }));
    assert.ok(t2.source_a_latest !== null);
    assert.strictEqual(t2.source_a_latest.value, 5.0);
    assert.strictEqual(t2.source_b_latest, null);
  });

  it('bundle with source_id=reviewed routes to source B', () => {
    const t = createDivergence(params, { now: NOW });
    const t2 = processDivergence(t, { value: 5.0, timestamp: NOW + 1, source_id: 'reviewed', doubt_price: 0 });
    assert.ok(t2.source_b_latest !== null);
    assert.strictEqual(t2.source_a_latest, null);
  });

  it('probability updates when both sources seen', () => {
    const t = createDivergence(params, { now: NOW });
    // Source A: 5.0, Source B: 5.7 → diff=0.7 > threshold=0.3 → diverged → P high
    const t2 = processDivergence(t, bundle(5.0, { timestamp: NOW + 1 }));
    const t3 = processDivergence(t2, { value: 5.7, timestamp: NOW + 2, source_id: 'reviewed', doubt_price: 0 });
    assert.ok(t3.position_probability > 0.5, `P=${t3.position_probability} should be > 0.5 for diverged sources`);
  });

  it('converged sources → low probability', () => {
    const t = createDivergence(params, { now: NOW });
    // Diff = 0.1 < 0.3 → not diverged → P = 0
    const t2 = processDivergence(t, bundle(5.0, { timestamp: NOW + 1 }));
    const t3 = processDivergence(t2, { value: 5.1, timestamp: NOW + 2, source_id: 'reviewed', doubt_price: 0 });
    assert.ok(t3.position_probability < 0.5, `P=${t3.position_probability} should be < 0.5 for converged sources`);
  });

  it('probability unchanged when only one source seen', () => {
    const t = createDivergence(params, { now: NOW });
    const t2 = processDivergence(t, bundle(5.0, { timestamp: NOW + 1 }));
    assert.strictEqual(t2.position_probability, 0.5);  // prior, no update
  });
});

describe('processDivergence — self-resolving mode', () => {
  const params = {
    source_a_type: 'sensor_a',
    source_b_type: 'sensor_b',
    divergence_threshold: 0.5,
    resolution_mode: 'self-resolving',
  };

  it('converging sources auto-resolve when P < 0.1', () => {
    const t = createDivergence(params, { now: NOW });
    // Sources agree exactly: diff=0 < threshold → P=0 < 0.1 → auto-resolve
    const t2 = processDivergence(t, bundle(10.0, { timestamp: NOW + 1 }));
    const t3 = processDivergence(t2, { value: 10.0, timestamp: NOW + 2, source_id: 'sensor_b', doubt_price: 0 });
    assert.strictEqual(t3.status, 'resolved');
    assert.strictEqual(t3.resolution.outcome, false);
    assert.strictEqual(t3.resolution.settlement_class, 'self-resolving');
  });

  it('diverging sources do not auto-resolve', () => {
    const t = createDivergence(params, { now: NOW });
    const t2 = processDivergence(t, bundle(10.0, { timestamp: NOW + 1 }));
    const t3 = processDivergence(t2, { value: 11.0, timestamp: NOW + 2, source_id: 'sensor_b', doubt_price: 0 });
    assert.strictEqual(t3.status, 'open');
  });
});

describe('expireDivergence / resolveDivergence', () => {
  const params = { source_a_type: 'a', source_b_type: 'b', divergence_threshold: 0.3, resolution_mode: 'expiry' };

  it('expireDivergence sets status=expired', () => {
    const t = createDivergence(params, { now: NOW });
    const expired = expireDivergence(t, { now: NOW + 1 });
    assert.strictEqual(expired.status, 'expired');
  });

  it('resolveDivergence true → outcome=true, probability=1', () => {
    const t = createDivergence(params, { now: NOW });
    const resolved = resolveDivergence(t, true, 'oracle', { now: NOW + 1 });
    assert.strictEqual(resolved.resolution.outcome, true);
    assert.strictEqual(resolved.position_probability, 1);
  });
});

// ─── regime-shift ─────────────────────────────────────────────────────────────

describe('createRegimeShift', () => {
  it('returns template=regime_shift, status=open', () => {
    const t = createRegimeShift({ state_boundary: 70, zone_prior: 0.6 }, { now: NOW });
    assert.strictEqual(t.template, 'regime_shift');
    assert.strictEqual(t.status, 'open');
  });

  it('uses zone_prior as initial probability', () => {
    const t = createRegimeShift({ state_boundary: 70, zone_prior: 0.6 }, { now: NOW });
    assert.strictEqual(t.position_probability, 0.6);
  });

  it('defaults zone_prior to 0.5 when null', () => {
    const t = createRegimeShift({ state_boundary: 70, zone_prior: null }, { now: NOW });
    assert.strictEqual(t.position_probability, 0.5);
  });
});

describe('processRegimeShift', () => {
  it('null state_boundary → probability unchanged, history appended', () => {
    const t = createRegimeShift({ state_boundary: null, zone_prior: null }, { now: NOW });
    const t2 = processRegimeShift(t, bundle(50, { timestamp: NOW + 1 }));
    assert.strictEqual(t2.position_probability, 0.5);
    assert.strictEqual(t2.position_history.length, 1);
  });

  it('value below boundary → high P(state A) when doubt=0', () => {
    const t = createRegimeShift({ state_boundary: 70, zone_prior: 0.5 }, { now: NOW });
    const t2 = processRegimeShift(t, bundle(40, { doubt_price: 0 }));
    assert.strictEqual(t2.position_probability, 1.0);  // in_state_a, doubt=0
  });

  it('value at or above boundary → low P(state A) when doubt=0', () => {
    const t = createRegimeShift({ state_boundary: 70, zone_prior: 0.5 }, { now: NOW });
    const t2 = processRegimeShift(t, bundle(80, { doubt_price: 0 }));
    assert.strictEqual(t2.position_probability, 0.0);  // not in_state_a, doubt=0
  });

  it('doubt=0.4, below boundary → P = 0.8', () => {
    const t = createRegimeShift({ state_boundary: 70, zone_prior: 0.5 }, { now: NOW });
    const t2 = processRegimeShift(t, bundle(40, { doubt_price: 0.4 }));
    assert.strictEqual(t2.position_probability, 0.8);
  });

  it('does not modify closed theatre', () => {
    const t = createRegimeShift({ state_boundary: 70, zone_prior: 0.5 }, { now: NOW });
    const expired = expireRegimeShift(t, { now: NOW + 1 });
    const t2 = processRegimeShift(expired, bundle(40));
    assert.strictEqual(t2.status, 'expired');
  });
});

describe('expireRegimeShift / resolveRegimeShift', () => {
  it('expireRegimeShift sets status=expired', () => {
    const t = createRegimeShift({ state_boundary: 70, zone_prior: null }, { now: NOW });
    const expired = expireRegimeShift(t, { now: NOW + 1 });
    assert.strictEqual(expired.status, 'expired');
  });

  it('resolveRegimeShift true → probability=1', () => {
    const t = createRegimeShift({ state_boundary: 70, zone_prior: null }, { now: NOW });
    const resolved = resolveRegimeShift(t, true, 'oracle', { now: NOW + 1 });
    assert.strictEqual(resolved.position_probability, 1);
    assert.strictEqual(resolved.status, 'resolved');
  });
});

// ─── persistence ─────────────────────────────────────────────────────────────

describe('createPersistence', () => {
  it('returns template=persistence, status=open', () => {
    const t = createPersistence({ condition_threshold: 150, consecutive_count: 3 }, { now: NOW });
    assert.strictEqual(t.template, 'persistence');
    assert.strictEqual(t.status, 'open');
  });

  it('initial consecutive_seen=0, position_probability=0', () => {
    const t = createPersistence({ condition_threshold: 150, consecutive_count: 3 }, { now: NOW });
    assert.strictEqual(t.consecutive_seen, 0);
    assert.strictEqual(t.position_probability, 0);
  });
});

describe('processPersistence', () => {
  const params = { condition_threshold: 150, consecutive_count: 3, window_hours: 24 };

  it('meeting condition increments streak', () => {
    const t = createPersistence(params, { now: NOW });
    const t2 = processPersistence(t, bundle(200, { timestamp: NOW + 1 }));
    assert.strictEqual(t2.consecutive_seen, 1);
  });

  it('not meeting condition resets streak', () => {
    const t = createPersistence(params, { now: NOW });
    const t2 = processPersistence(t, bundle(200, { timestamp: NOW + 1 }));
    const t3 = processPersistence(t2, bundle(100, { timestamp: NOW + 2 }));
    assert.strictEqual(t3.consecutive_seen, 0);
  });

  it('probability grows with streak', () => {
    const t = createPersistence(params, { now: NOW });
    const t2 = processPersistence(t, bundle(200, { timestamp: NOW + 1 }));
    assert.ok(t2.position_probability > 0);
    assert.ok(t2.position_probability < 1);
  });

  it('completing streak auto-resolves with outcome=true', () => {
    let t = createPersistence(params, { now: NOW });
    t = processPersistence(t, bundle(200, { timestamp: NOW + 1 }));
    t = processPersistence(t, bundle(200, { timestamp: NOW + 2 }));
    t = processPersistence(t, bundle(200, { timestamp: NOW + 3 }));
    assert.strictEqual(t.status, 'resolved');
    assert.strictEqual(t.resolution.outcome, true);
  });

  it('auto-resolution settlement_class is auto', () => {
    let t = createPersistence(params, { now: NOW });
    for (let i = 1; i <= 3; i++) {
      t = processPersistence(t, bundle(200, { timestamp: NOW + i }));
    }
    assert.strictEqual(t.resolution.settlement_class, 'auto');
  });

  it('does not modify closed theatre', () => {
    const t = createPersistence(params, { now: NOW });
    const expired = expirePersistence(t, { now: NOW + 1 });
    const t2 = processPersistence(expired, bundle(200, { timestamp: NOW + 2 }));
    assert.strictEqual(t2.consecutive_seen, expired.consecutive_seen);
  });
});

describe('expirePersistence / resolvePersistence', () => {
  it('expirePersistence sets status=expired, outcome=false', () => {
    const t = createPersistence({ condition_threshold: 150, consecutive_count: 3 }, { now: NOW });
    const expired = expirePersistence(t, { now: NOW + 1 });
    assert.strictEqual(expired.status, 'expired');
    assert.strictEqual(expired.resolution.outcome, false);
  });

  it('resolvePersistence with outcome=false → probability=0', () => {
    const t = createPersistence({ condition_threshold: 150, consecutive_count: 3 }, { now: NOW });
    const resolved = resolvePersistence(t, false, 'oracle', { now: NOW + 1 });
    assert.strictEqual(resolved.position_probability, 0);
  });
});

// ─── anomaly ──────────────────────────────────────────────────────────────────

describe('createAnomaly', () => {
  it('returns template=anomaly, status=open', () => {
    const t = createAnomaly({ baseline_metric: 'b-value', sigma_threshold: 2.0, window_hours: 168 }, { now: NOW });
    assert.strictEqual(t.template, 'anomaly');
    assert.strictEqual(t.status, 'open');
  });

  it('initial baseline_values empty, position_probability=0.5', () => {
    const t = createAnomaly({ baseline_metric: 'b-value', sigma_threshold: null, window_hours: 168 }, { now: NOW });
    assert.deepStrictEqual(t.baseline_values, []);
    assert.strictEqual(t.position_probability, 0.5);
  });
});

describe('processAnomaly', () => {
  const params = { baseline_metric: 'b-value', sigma_threshold: 2.0, window_hours: 168 };

  it('appends value to baseline_values', () => {
    const t = createAnomaly(params, { now: NOW });
    const t2 = processAnomaly(t, bundle(1.2, { timestamp: NOW + 1 }));
    assert.strictEqual(t2.baseline_values.length, 1);
    assert.strictEqual(t2.baseline_values[0], 1.2);
  });

  it('with fewer than 3 observations probability stays at 0.5', () => {
    let t = createAnomaly(params, { now: NOW });
    t = processAnomaly(t, bundle(1.0, { timestamp: NOW + 1 }));
    t = processAnomaly(t, bundle(1.1, { timestamp: NOW + 2 }));
    assert.strictEqual(t.position_probability, 0.5);
  });

  it('normal value within sigma → low probability of anomaly', () => {
    // Build baseline: [1.0, 1.0, 1.0, 1.0] → mean=1, std≈0. Use varied values.
    let t = createAnomaly(params, { now: NOW });
    const baseline = [1.0, 1.1, 0.9, 1.05, 0.95];
    for (let i = 0; i < baseline.length; i++) {
      t = processAnomaly(t, bundle(baseline[i], { timestamp: NOW + i + 1 }));
    }
    // Process a normal value: 1.02 → z-score near 0 → not anomalous
    t = processAnomaly(t, bundle(1.02, { timestamp: NOW + 10 }));
    assert.ok(t.position_probability < 0.5, `expected P<0.5, got ${t.position_probability}`);
  });

  it('extreme outlier → high probability of anomaly', () => {
    let t = createAnomaly(params, { now: NOW });
    const baseline = [1.0, 1.1, 0.9, 1.05, 0.95];
    for (let i = 0; i < baseline.length; i++) {
      t = processAnomaly(t, bundle(baseline[i], { timestamp: NOW + i + 1 }));
    }
    // Process an extreme outlier: z-score >> 2
    t = processAnomaly(t, bundle(10.0, { timestamp: NOW + 10 }));
    assert.ok(t.position_probability > 0.5, `expected P>0.5, got ${t.position_probability}`);
  });

  it('null sigma_threshold defaults to 2.0', () => {
    // Two theatres: one with sigma=2.0, one with sigma=null — should behave identically
    const base_params_a = { baseline_metric: 'aqi', sigma_threshold: 2.0, window_hours: 168 };
    const base_params_b = { baseline_metric: 'aqi', sigma_threshold: null, window_hours: 168 };
    let ta = createAnomaly(base_params_a, { now: NOW });
    let tb = createAnomaly(base_params_b, { now: NOW });
    const values = [1.0, 1.1, 0.9, 1.05, 0.95, 10.0];
    for (let i = 0; i < values.length; i++) {
      ta = processAnomaly(ta, bundle(values[i], { timestamp: NOW + i + 1 }));
      tb = processAnomaly(tb, bundle(values[i], { timestamp: NOW + i + 1 }));
    }
    assert.strictEqual(ta.position_probability, tb.position_probability);
  });

  it('position_history tracks zscore', () => {
    let t = createAnomaly(params, { now: NOW });
    const values = [1.0, 1.1, 0.9, 1.05, 1.02];
    for (let i = 0; i < values.length; i++) {
      t = processAnomaly(t, bundle(values[i], { timestamp: NOW + i + 1 }));
    }
    assert.ok('zscore' in t.position_history[t.position_history.length - 1]);
  });

  it('does not modify closed theatre', () => {
    const t = createAnomaly(params, { now: NOW });
    const expired = expireAnomaly(t, { now: NOW + 1 });
    const t2 = processAnomaly(expired, bundle(100.0, { timestamp: NOW + 2 }));
    assert.strictEqual(t2.baseline_values.length, expired.baseline_values.length);
  });
});

describe('expireAnomaly / resolveAnomaly', () => {
  it('expireAnomaly sets status=expired', () => {
    const t = createAnomaly({ baseline_metric: 'b-value', sigma_threshold: 2.0, window_hours: 168 }, { now: NOW });
    const expired = expireAnomaly(t, { now: NOW + 1 });
    assert.strictEqual(expired.status, 'expired');
    assert.ok('peak_zscore' in expired.resolution);
  });

  it('resolveAnomaly true → probability=1, status=resolved', () => {
    const t = createAnomaly({ baseline_metric: 'b-value', sigma_threshold: 2.0, window_hours: 168 }, { now: NOW });
    const resolved = resolveAnomaly(t, true, 'oracle', { now: NOW + 1 });
    assert.strictEqual(resolved.status, 'resolved');
    assert.strictEqual(resolved.position_probability, 1);
  });
});
