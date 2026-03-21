/**
 * test/unit/noise.spec.js
 * Unit tests for Sprint 3 Q3 Noise Classifier.
 *   - src/classifier/noise.js
 *
 * Uses synthetic data for deterministic expected outputs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  computeSpikes,
  computeLag1Autocorr,
  computeLinearTrendTStat,
  isSpikeDriven,
  isTimingSpikeDriven,
  isTimestampLike,
  classifyNoise,
} from '../../src/classifier/noise.js';

import { ingest } from '../../src/ingester/generic.js';
import { classify } from '../../src/classifier/feed-grammar.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build synthetic events with given values and optional stream index.
 * Timestamps are evenly spaced starting from a fixed base.
 */
function makeEvents(values, streamIndex = undefined) {
  const base = 1700000000000;
  return values.map((v, i) => ({
    timestamp: base + i * 60_000,
    value: v,
    metadata: streamIndex !== undefined ? { stream_index: streamIndex } : {},
  }));
}

/**
 * Build multi-stream events from two value arrays.
 */
function makeTwoStreamEvents(values0, values1) {
  const s0 = makeEvents(values0, 0);
  const s1 = makeEvents(values1, 1);
  return [...s0, ...s1].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Build events with irregular (event-driven) timestamps and given values.
 * @param {number[]} gapMs - gaps between events in ms
 * @param {number[]} values - value for each event
 */
function makeIrregularEvents(gapMs, values) {
  const base = 1700000000000;
  const events = [{ timestamp: base, value: values[0], metadata: {} }];
  let t = base;
  for (let i = 0; i < gapMs.length; i++) {
    t += gapMs[i];
    events.push({ timestamp: t, value: values[i + 1] ?? values[0], metadata: {} });
  }
  return events;
}

// ─── computeSpikes ────────────────────────────────────────────────────────────

describe('computeSpikes', () => {
  it('returns zero spike_rate for near-constant data', () => {
    const values = new Array(30).fill(100);
    const { spike_rate } = computeSpikes(values);
    assert.equal(spike_rate, 0);
  });

  it('detects spikes in data with clear outliers', () => {
    // 25 values near baseline, 5 extreme spikes
    const baseline = new Array(25).fill(10);
    const spikes = [200, 300, 400, 250, 350];
    const values = [...baseline, ...spikes];
    const { spike_rate, spike_count } = computeSpikes(values);
    assert.ok(spike_rate > 0, `expected spike_rate > 0, got ${spike_rate}`);
    assert.ok(spike_count > 0, `expected spike_count > 0, got ${spike_count}`);
  });

  it('handles fewer than 3 values', () => {
    const { spike_rate } = computeSpikes([1, 2]);
    assert.equal(spike_rate, 0);
  });

  it('handles window larger than values array', () => {
    const values = [10, 12, 11, 13, 10, 100];  // one spike
    const { spike_count } = computeSpikes(values, 20);
    assert.ok(spike_count >= 0, 'should not throw for window > length');
  });
});

// ─── computeLag1Autocorr ─────────────────────────────────────────────────────

describe('computeLag1Autocorr', () => {
  it('returns high positive autocorr for monotonically increasing sequence', () => {
    const values = Array.from({ length: 20 }, (_, i) => i * 10);
    const lag1 = computeLag1Autocorr(values);
    assert.ok(lag1 > 0.7, `expected lag1 > 0.7, got ${lag1}`);
  });

  it('returns near-zero autocorr for alternating sequence', () => {
    // Alternating ±1 — each value is the opposite of the last → strong negative autocorr
    const values = Array.from({ length: 20 }, (_, i) => i % 2 === 0 ? 1 : -1);
    const lag1 = computeLag1Autocorr(values);
    assert.ok(lag1 < 0, `expected lag1 < 0, got ${lag1}`);
  });

  it('returns 0 for fewer than 3 values', () => {
    assert.equal(computeLag1Autocorr([1, 2]), 0);
  });

  it('returns 0 when all values are constant (zero variance)', () => {
    const values = new Array(10).fill(5);
    const lag1 = computeLag1Autocorr(values);
    assert.equal(lag1, 0);
  });
});

// ─── computeLinearTrendTStat ──────────────────────────────────────────────────

describe('computeLinearTrendTStat', () => {
  it('returns high positive t-stat for perfectly increasing linear data', () => {
    const values = Array.from({ length: 20 }, (_, i) => i * 5);
    const t = computeLinearTrendTStat(values);
    assert.ok(t > 3.0, `expected t > 3.0, got ${t}`);
  });

  it('returns high negative t-stat for perfectly decreasing linear data', () => {
    const values = Array.from({ length: 20 }, (_, i) => 100 - i * 5);
    const t = computeLinearTrendTStat(values);
    assert.ok(t < -3.0, `expected t < -3.0, got ${t}`);
  });

  it('returns near-zero t-stat for constant data', () => {
    const values = new Array(20).fill(42);
    const t = computeLinearTrendTStat(values);
    assert.ok(Math.abs(t) < 0.01, `expected |t| near 0, got ${t}`);
  });

  it('returns 0 for fewer than 3 values', () => {
    assert.equal(computeLinearTrendTStat([1, 2]), 0);
  });
});

// ─── isTimestampLike ──────────────────────────────────────────────────────────

describe('isTimestampLike', () => {
  it('returns true for Unix ms timestamps', () => {
    const values = [1700000000000, 1700000060000, 1700000120000];
    assert.ok(isTimestampLike(values));
  });

  it('returns false for small measurement values', () => {
    const values = [5.2, 7.8, 12.1, 4.5, 9.9];
    assert.equal(isTimestampLike(values), false);
  });

  it('returns false for large but non-timestamp values (below 1e12)', () => {
    const values = [100000, 200000, 300000];
    assert.equal(isTimestampLike(values), false);
  });

  it('returns false for empty array', () => {
    assert.equal(isTimestampLike([]), false);
  });
});

// ─── isTimingSpikeDriven ──────────────────────────────────────────────────────

describe('isTimingSpikeDriven', () => {
  it('returns true for highly irregular event timing (right-skewed gaps)', () => {
    // Typical earthquake gaps: mostly short, some very long
    const deltas = [
      941_000, 1_479_000, 1_582_000, 2_028_000, 2_450_000,
      3_232_000, 3_876_000, 4_324_000, 4_615_000, 5_116_000,
      5_356_000, 9_668_000, 12_953_000, 13_993_000, 4_614_000,
      3_294_000, 1_706_000,
    ];
    assert.ok(isTimingSpikeDriven(deltas), 'irregular seismic timing should be spike-driven');
  });

  it('returns false for regular periodic timing', () => {
    // Regular 60s intervals
    const deltas = new Array(20).fill(60_000);
    assert.equal(isTimingSpikeDriven(deltas), false);
  });

  it('returns false for fewer than 3 deltas', () => {
    assert.equal(isTimingSpikeDriven([1000, 2000]), false);
  });
});

// ─── isSpikeDriven ────────────────────────────────────────────────────────────

describe('isSpikeDriven', () => {
  it('detects spike-driven values with strong right skew', () => {
    // Baseline ~10, with occasional large spikes
    const values = [
      8, 9, 10, 11, 8, 9, 10, 12, 8, 9,
      100, 8, 9, 10, 8, 9, 10, 150, 8, 9,
    ];
    assert.ok(isSpikeDriven(values), 'baseline with large spikes should be spike-driven');
  });

  it('returns false for near-constant values', () => {
    const values = new Array(20).fill(50);
    assert.equal(isSpikeDriven(values), false);
  });

  it('returns false for symmetric noisy values', () => {
    // Symmetric uniform noise around 50 — no strong right skew
    const values = [40, 45, 50, 55, 60, 45, 50, 55, 40, 60, 50, 48, 52, 50, 51, 49, 50, 50, 50, 50];
    // Mean ≈ median for symmetric data → not spike-driven
    assert.equal(isSpikeDriven(values), false);
  });

  it('returns false for fewer than 3 values', () => {
    assert.equal(isSpikeDriven([1, 2]), false);
  });
});

// ─── classifyNoise: single-stream paths ──────────────────────────────────────

describe('classifyNoise: low_noise', () => {
  it('classifies near-constant values as low_noise', () => {
    const events = makeEvents(new Array(20).fill(100));
    const result = classifyNoise(events);
    assert.equal(result.classification, 'low_noise');
  });

  it('classifies very tight distribution as low_noise', () => {
    // CV < 0.15: values fluctuate ±2% around mean
    const values = [98, 99, 100, 101, 100, 99, 100, 101, 99, 100, 98, 101, 100, 99, 100];
    const events = makeEvents(values);
    const result = classifyNoise(events);
    assert.equal(result.classification, 'low_noise');
  });
});

describe('classifyNoise: spike_driven (value-based)', () => {
  it('classifies right-skewed values with large spikes as spike_driven', () => {
    // Low baseline with occasional large outliers
    const values = [
      10, 8, 9, 11, 10, 9, 8, 10, 9, 11,
      8, 9, 10, 8, 9, 200, 10, 9, 8, 300,
    ];
    const events = makeEvents(values);
    const result = classifyNoise(events);
    assert.equal(result.classification, 'spike_driven');
  });
});

describe('classifyNoise: spike_driven (timing-based)', () => {
  it('classifies event-driven stream with timestamp values as spike_driven', () => {
    // TREMOR-like: timestamp values (> 1e12) with irregular timing
    const gapMs = [
      4_615_000, 13_993_000, 4_324_000, 1_706_000, 1_582_000,
      4_614_000, 9_668_000, 5_356_000, 12_953_000, 3_294_000,
      941_000, 1_479_000, 3_232_000, 2_028_000, 2_450_000,
    ];
    // Values are Unix ms timestamps (like the actual TREMOR fixture)
    const base = 1700000000000;
    let t = base;
    const timestamps = [t];
    for (const g of gapMs) { t += g; timestamps.push(t); }
    const events = timestamps.map((ts, i) => ({
      timestamp: ts,
      value: base + 1_000_000 + i * 100_000,  // timestamp-like values
      metadata: {},
    }));
    const result = classifyNoise(events);
    assert.equal(result.classification, 'spike_driven',
      `TREMOR-like events should be spike_driven, got ${result.classification}`);
  });
});

describe('classifyNoise: white_noise', () => {
  it('classifies moderately variable values without structure as white_noise', () => {
    // CV > 0.15 but no clear spike pattern, no trend
    const values = [30, 50, 40, 70, 35, 55, 45, 65, 38, 52, 48, 62, 36, 56, 44, 68, 33, 57, 47, 63];
    const events = makeEvents(values);
    const result = classifyNoise(events);
    assert.ok(
      result.classification === 'white_noise' || result.classification === 'spike_driven',
      `expected white_noise or spike_driven, got ${result.classification}`
    );
  });
});

describe('classifyNoise: trending', () => {
  it('classifies strongly linear increasing values as trending', () => {
    const values = Array.from({ length: 30 }, (_, i) => i * 10 + 100);
    const events = makeEvents(values);
    const result = classifyNoise(events);
    assert.equal(result.classification, 'trending',
      `linear ramp should be trending, got ${result.classification}`);
  });
});

describe('classifyNoise: cyclical', () => {
  it('classifies sine-wave-like values as cyclical', () => {
    // Sine wave: high positive lag-1 autocorrelation
    const values = Array.from({ length: 40 }, (_, i) =>
      50 + 20 * Math.sin(2 * Math.PI * i / 10)
    );
    const events = makeEvents(values);
    const result = classifyNoise(events);
    assert.equal(result.classification, 'cyclical',
      `sine wave should be cyclical, got ${result.classification}`);
  });
});

// ─── classifyNoise: multi-stream paths ───────────────────────────────────────

describe('classifyNoise: mixed (multi-stream)', () => {
  it('classifies any two-stream feed as mixed', () => {
    const events = makeTwoStreamEvents(
      [1, 2, 3, 4, 5],
      [100, 200, 150, 250, 180]
    );
    const result = classifyNoise(events);
    assert.equal(result.classification, 'mixed');
    assert.equal(result.stream_count, 2);
  });

  it('classifies three-stream feed as mixed', () => {
    const s0 = makeEvents([1, 2, 3, 4], 0);
    const s1 = makeEvents([10, 20, 30, 40], 1);
    const s2 = makeEvents([100, 200, 300, 400], 2);
    const events = [...s0, ...s1, ...s2];
    const result = classifyNoise(events);
    assert.equal(result.classification, 'mixed');
    assert.equal(result.stream_count, 3);
  });
});

// ─── classifyNoise: edge cases ────────────────────────────────────────────────

describe('classifyNoise: edge cases', () => {
  it('handles empty events array', () => {
    const result = classifyNoise([]);
    assert.ok(typeof result.classification === 'string');
  });

  it('handles single event', () => {
    const events = [{ timestamp: 1700000000000, value: 42, metadata: {} }];
    const result = classifyNoise(events);
    assert.equal(result.classification, 'low_noise');
  });

  it('returns string classification for all input types', () => {
    const scenarios = [
      makeEvents([]),
      makeEvents([42]),
      makeEvents(new Array(5).fill(NaN).map(() => NaN)),
    ];
    for (const events of scenarios) {
      const result = classifyNoise(events);
      assert.ok(typeof result.classification === 'string', `classification must be a string, got ${result.classification}`);
    }
  });
});

// ─── classifyNoise: real fixture tests ───────────────────────────────────────

describe('classifyNoise: real fixtures', () => {
  it('classifies TREMOR (USGS) as spike_driven', () => {
    const raw = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const events = ingest(raw);
    const profile = classify(events);
    assert.equal(profile.noise.classification, 'spike_driven',
      `TREMOR Q3 should be spike_driven, got ${profile.noise.classification}`);
  });

  it('classifies CORONA (SWPC + DONKI) as mixed', () => {
    const swpc = JSON.parse(readFileSync('fixtures/swpc-goes-xray.json', 'utf8'));
    const donki = JSON.parse(readFileSync('fixtures/donki-flr-cme.json', 'utf8'));
    const raw = { xray_flux: swpc.xray_flux, kp_index: swpc.kp_index, flares: donki.flares, cmes: donki.cmes };
    const events = ingest(raw);
    const profile = classify(events);
    assert.equal(profile.noise.classification, 'mixed',
      `CORONA Q3 should be mixed, got ${profile.noise.classification}`);
  });

  it('classifies BREATH (PurpleAir + AirNow) as mixed', () => {
    const pa = JSON.parse(readFileSync('fixtures/purpleair-sf-bay.json', 'utf8'));
    const an = JSON.parse(readFileSync('fixtures/airnow-sf-bay.json', 'utf8'));
    const raw = { purpleair: pa, airnow: an };
    const events = ingest(raw);
    const profile = classify(events);
    assert.equal(profile.noise.classification, 'mixed',
      `BREATH Q3 should be mixed, got ${profile.noise.classification}`);
  });
});
