/**
 * test/unit/thresholds.spec.js
 * Unit tests for src/classifier/thresholds.js (Q5: Threshold Type Classifier).
 *
 * Coverage:
 *   - loadRegulatoryTables / data file existence
 *   - isRegulatedRange helper
 *   - computeHistogram helper
 *   - detectBreakpoints helper
 *   - matchRegulatoryTable helper
 *   - computePercentileThresholds helper
 *   - classifyThresholds: all classification paths
 *   - Real fixture integration: TREMOR → statistical, CORONA → regulatory, BREATH → regulatory
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  loadRegulatoryTables,
  isRegulatedRange,
  computeHistogram,
  detectBreakpoints,
  matchRegulatoryTable,
  computePercentileThresholds,
  classifyThresholds,
} from '../../src/classifier/thresholds.js';

import { ingest } from '../../src/ingester/generic.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build events with explicit stream_index metadata.
 * @param {number[]} values
 * @param {number} streamIndex
 * @returns {import('../../src/ingester/generic.js').NormalizedEvent[]}
 */
function makeStreamEvents(values, streamIndex) {
  return values.map((v, i) => ({
    timestamp: 1700000000000 + i * 60_000,
    value: v,
    metadata: { stream_index: streamIndex },
  }));
}

/**
 * Build single-stream events (no stream_index).
 * @param {number[]} values
 * @returns {import('../../src/ingester/generic.js').NormalizedEvent[]}
 */
function makeEvents(values) {
  return values.map((v, i) => ({
    timestamp: 1700000000000 + i * 60_000,
    value: v,
    metadata: {},
  }));
}

// ─── loadRegulatoryTables ─────────────────────────────────────────────────────

describe('loadRegulatoryTables', () => {
  it('returns an array of table objects', () => {
    const tables = loadRegulatoryTables();
    assert.ok(Array.isArray(tables), 'should return an array');
    assert.ok(tables.length >= 3, 'should have at least 3 tables');
  });

  it('each table has name and breakpoints fields', () => {
    const tables = loadRegulatoryTables();
    for (const t of tables) {
      assert.ok(typeof t.name === 'string', `table ${JSON.stringify(t)} missing name`);
      assert.ok(Array.isArray(t.breakpoints), `table ${t.name} missing breakpoints`);
      assert.ok(t.breakpoints.length > 0, `table ${t.name} breakpoints empty`);
    }
  });

  it('contains EPA_AQI table with expected breakpoints', () => {
    const tables = loadRegulatoryTables();
    const aqi = tables.find(t => t.name === 'EPA_AQI');
    assert.ok(aqi, 'EPA_AQI table should exist');
    assert.deepEqual(aqi.breakpoints, [0, 51, 101, 151, 201, 301, 500]);
  });

  it('contains NOAA_Kp_Gscale table', () => {
    const tables = loadRegulatoryTables();
    const kp = tables.find(t => t.name === 'NOAA_Kp_Gscale');
    assert.ok(kp, 'NOAA_Kp_Gscale table should exist');
    assert.deepEqual(kp.breakpoints, [5, 6, 7, 8, 9]);
  });

  it('contains NOAA_R_scale table', () => {
    const tables = loadRegulatoryTables();
    const r = tables.find(t => t.name === 'NOAA_R_scale');
    assert.ok(r, 'NOAA_R_scale table should exist');
    assert.ok(r.breakpoints.length > 0);
  });
});

// ─── isRegulatedRange ─────────────────────────────────────────────────────────

describe('isRegulatedRange', () => {
  it('returns true for AQI-range values [0, 500]', () => {
    assert.ok(isRegulatedRange([0, 50, 100, 150, 200, 300, 500]));
  });

  it('returns true for Kp-scale values [0, 9]', () => {
    assert.ok(isRegulatedRange([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  });

  it('returns true for values at exactly the boundary [0, 600]', () => {
    assert.ok(isRegulatedRange([0, 600]));
  });

  it('returns false for values exceeding the boundary (max > 600)', () => {
    assert.equal(isRegulatedRange([0, 100, 700]), false);
  });

  it('returns false for negative values', () => {
    assert.equal(isRegulatedRange([-10, 0, 100]), false);
  });

  it('returns false for empty array', () => {
    assert.equal(isRegulatedRange([]), false);
  });

  it('returns true for single value in range', () => {
    assert.ok(isRegulatedRange([42]));
  });

  it('returns false for single value above 600', () => {
    assert.equal(isRegulatedRange([601]), false);
  });

  it('returns true for timestamp-like values only if all are in [0, 600]', () => {
    // Values like 1.7e12 (Unix ms) are NOT in regulated range
    assert.equal(isRegulatedRange([1700000000000, 1700000001000]), false);
  });

  it('returns true for small positive floats (PM2.5 readings 5-95)', () => {
    assert.ok(isRegulatedRange([5.9, 9.1, 11.8, 16.2, 95]));
  });
});

// ─── computeHistogram ─────────────────────────────────────────────────────────

describe('computeHistogram', () => {
  it('returns empty histogram for empty values', () => {
    const h = computeHistogram([]);
    assert.equal(h.bins, 0);
    assert.deepEqual(h.counts, []);
    assert.deepEqual(h.edges, []);
  });

  it('returns single bin for all-identical values', () => {
    const h = computeHistogram([5, 5, 5, 5]);
    assert.equal(h.bins, 1);
    assert.equal(h.counts[0], 4);
  });

  it('returns requested number of bins for spread values', () => {
    const values = Array.from({ length: 100 }, (_, i) => i);
    const h = computeHistogram(values, 10);
    assert.equal(h.bins, 10);
    assert.equal(h.counts.length, 10);
    assert.equal(h.edges.length, 11);
  });

  it('total count equals input length', () => {
    const values = [10, 25, 42, 88, 151, 200, 300, 480];
    const h = computeHistogram(values, 50);
    const total = h.counts.reduce((s, c) => s + c, 0);
    assert.equal(total, values.length);
  });

  it('edges span from min to max', () => {
    const values = [1, 5, 10];
    const h = computeHistogram(values, 5);
    assert.equal(h.edges[0], 1);
    assert.ok(Math.abs(h.edges[h.edges.length - 1] - 10) < 0.001);
  });
});

// ─── detectBreakpoints ────────────────────────────────────────────────────────

describe('detectBreakpoints', () => {
  it('returns empty array for empty histogram', () => {
    const bp = detectBreakpoints({ bins: 0, counts: [], edges: [] });
    assert.deepEqual(bp, []);
  });

  it('returns empty array for single-bin histogram', () => {
    const bp = detectBreakpoints({ bins: 1, counts: [5], edges: [0, 1] });
    assert.deepEqual(bp, []);
  });

  it('detects breakpoint at empty-to-nonempty transition', () => {
    // Bins: [5, 0, 0, 3] — transition at index 3 (empty→non-empty)
    const h = { bins: 4, counts: [5, 0, 0, 3], edges: [0, 1, 2, 3, 4] };
    const bp = detectBreakpoints(h);
    assert.ok(bp.length > 0, 'should detect breakpoint');
  });

  it('detects breakpoint at nonempty-to-empty transition', () => {
    // Bins: [3, 0, 5, 0] — transition at index 1 (non-empty→empty)
    const h = { bins: 4, counts: [3, 0, 5, 0], edges: [0, 1, 2, 3, 4] };
    const bp = detectBreakpoints(h);
    assert.ok(bp.length > 0, 'should detect breakpoint');
  });
});

// ─── matchRegulatoryTable ─────────────────────────────────────────────────────

describe('matchRegulatoryTable', () => {
  const tables = loadRegulatoryTables();

  it('returns no match for empty breakpoints', () => {
    const result = matchRegulatoryTable([], tables);
    assert.equal(result.matched, false);
    assert.equal(result.table_name, null);
  });

  it('matches EPA_AQI for breakpoints near [51, 101, 151]', () => {
    const result = matchRegulatoryTable([51, 101, 151, 201], tables);
    assert.equal(result.matched, true);
    assert.equal(result.table_name, 'EPA_AQI');
  });

  it('matches NOAA_Kp_Gscale for breakpoints near [5, 6]', () => {
    const result = matchRegulatoryTable([5, 6], tables);
    assert.equal(result.matched, true);
    assert.equal(result.table_name, 'NOAA_Kp_Gscale');
  });

  it('returns no match for arbitrary unrelated breakpoints', () => {
    // Breakpoints near 1000 and 5000 — not in any table
    const result = matchRegulatoryTable([1000, 5000], tables);
    assert.equal(result.matched, false);
  });

  it('matches with slight tolerance (within 10%)', () => {
    // 52 is within 10% of 51 (tolerance = 5.1 + 1 = 6.1)
    const result = matchRegulatoryTable([52, 103, 154], tables);
    assert.equal(result.matched, true);
  });
});

// ─── computePercentileThresholds ─────────────────────────────────────────────

describe('computePercentileThresholds', () => {
  it('returns zeros for empty array', () => {
    const t = computePercentileThresholds([]);
    assert.equal(t.p95, 0);
    assert.equal(t.p99, 0);
    assert.equal(t.sigma3, 0);
  });

  it('returns correct p95 for sorted array', () => {
    // 100 values [0..99]: p95 = value at index 95 = 95
    const values = Array.from({ length: 100 }, (_, i) => i);
    const t = computePercentileThresholds(values);
    assert.equal(t.p95, 95);
  });

  it('p99 >= p95', () => {
    const values = Array.from({ length: 100 }, (_, i) => i * 2);
    const t = computePercentileThresholds(values);
    assert.ok(t.p99 >= t.p95, `p99 ${t.p99} should be >= p95 ${t.p95}`);
  });

  it('sigma3 is mean + 3σ', () => {
    // Constant array: sigma3 = mean + 0 = mean
    const values = new Array(10).fill(5);
    const t = computePercentileThresholds(values);
    assert.equal(t.sigma3, 5);
  });
});

// ─── classifyThresholds: empty / edge cases ───────────────────────────────────

describe('classifyThresholds: edge cases', () => {
  it('returns statistical for empty events array', () => {
    const result = classifyThresholds([]);
    assert.equal(result.type, 'statistical');
  });

  it('returns statistical for single event with no stream_index', () => {
    const events = [{ timestamp: 1700000000000, value: 999, metadata: {} }];
    const result = classifyThresholds(events);
    assert.equal(result.type, 'statistical');
  });

  it('returns regulatory for single event with stream_index 0 but value in range', () => {
    // Single stream, value in [0, 600] → regulatory
    const events = [{ timestamp: 1700000000000, value: 42, metadata: {} }];
    const result = classifyThresholds(events);
    assert.equal(result.type, 'regulatory');
  });
});

// ─── classifyThresholds: multi-stream → regulatory ───────────────────────────

describe('classifyThresholds: multi-stream → regulatory', () => {
  it('returns regulatory for 2 stream indices', () => {
    const events = [
      ...makeStreamEvents([10, 20, 30], 0),
      ...makeStreamEvents([1e-7, 2e-7, 3e-7], 1),
    ];
    const result = classifyThresholds(events);
    assert.equal(result.type, 'regulatory');
    assert.equal(result.stream_count, 2);
  });

  it('returns regulatory for 4 stream indices (CORONA-like)', () => {
    const events = [
      ...makeStreamEvents([1e-7, 2e-7], 0),
      ...makeStreamEvents([3, 4, 5], 1),
      ...makeStreamEvents([100, 200], 2),
      ...makeStreamEvents([0.1, 0.2], 3),
    ];
    const result = classifyThresholds(events);
    assert.equal(result.type, 'regulatory');
    assert.equal(result.stream_count, 4);
  });

  it('stream_count reflects actual stream index count', () => {
    const events = [
      ...makeStreamEvents([10, 20], 0),
      ...makeStreamEvents([50, 60], 1),
      ...makeStreamEvents([80, 90], 2),
    ];
    const result = classifyThresholds(events);
    assert.equal(result.type, 'regulatory');
    assert.equal(result.stream_count, 3);
  });
});

// ─── classifyThresholds: single-stream bounded → regulatory ──────────────────

describe('classifyThresholds: single-stream bounded values → regulatory', () => {
  it('returns regulatory for AQI-range values [0, 500]', () => {
    const events = makeEvents([10, 25, 50, 100, 150, 200, 300, 480]);
    const result = classifyThresholds(events);
    assert.equal(result.type, 'regulatory');
  });

  it('returns regulatory for Kp-scale values [0, 9]', () => {
    const events = makeEvents([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const result = classifyThresholds(events);
    assert.equal(result.type, 'regulatory');
  });

  it('returns regulatory for PM2.5-range values (5-95)', () => {
    const events = makeEvents([5.9, 9.1, 11.8, 16.2, 45, 95]);
    const result = classifyThresholds(events);
    assert.equal(result.type, 'regulatory');
  });
});

// ─── classifyThresholds: single-stream unbounded → statistical ────────────────

describe('classifyThresholds: single-stream unbounded → statistical', () => {
  it('returns statistical for values exceeding 600', () => {
    const events = makeEvents([200, 500, 900, 1500, 5000]);
    const result = classifyThresholds(events);
    assert.equal(result.type, 'statistical');
  });

  it('returns statistical for Unix timestamp values', () => {
    // Earthquake ingester may produce timestamp values as the primary value
    const events = makeEvents([1773902840040, 1773903000000, 1773983871040]);
    const result = classifyThresholds(events);
    assert.equal(result.type, 'statistical');
  });

  it('returns statistical for large significance scores (USGS sig 200-900)', () => {
    const events = makeEvents([268, 407, 517, 620, 779, 830, 912]);
    const result = classifyThresholds(events);
    assert.equal(result.type, 'statistical');
  });

  it('returns statistical for values with negative numbers', () => {
    const events = makeEvents([-10, 0, 100, 200]);
    const result = classifyThresholds(events);
    assert.equal(result.type, 'statistical');
  });
});

// ─── classifyThresholds: events with non-numeric values ──────────────────────

describe('classifyThresholds: non-numeric value handling', () => {
  it('ignores non-finite values when checking range', () => {
    // Mix of NaN and valid values — valid values are in range
    const events = [
      { timestamp: 1700000000000, value: NaN, metadata: {} },
      { timestamp: 1700000001000, value: 50, metadata: {} },
      { timestamp: 1700000002000, value: 100, metadata: {} },
    ];
    const result = classifyThresholds(events);
    // Only finite values [50, 100] considered → in range → regulatory
    assert.equal(result.type, 'regulatory');
  });

  it('returns statistical when all values are non-finite and no stream indices', () => {
    const events = [
      { timestamp: 1700000000000, value: NaN, metadata: {} },
      { timestamp: 1700000001000, value: Infinity, metadata: {} },
    ];
    // No finite values → isRegulatedRange([]) = false → statistical
    const result = classifyThresholds(events);
    assert.equal(result.type, 'statistical');
  });
});

// ─── Real fixture integration tests ──────────────────────────────────────────

describe('classifyThresholds: real fixture TREMOR (USGS seismic)', () => {
  const raw = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
  const events = ingest(raw);

  it('ingests USGS fixture into events', () => {
    assert.ok(events.length > 0, 'should have events');
  });

  it('classifies TREMOR as statistical', () => {
    const result = classifyThresholds(events);
    assert.equal(
      result.type,
      'statistical',
      `TREMOR should be statistical, got ${result.type}`
    );
  });

  it('TREMOR has no stream indices (single-stream)', () => {
    const streamIndices = new Set(
      events.map(e => e.metadata?.stream_index).filter(v => v != null)
    );
    assert.equal(streamIndices.size, 0, 'TREMOR should have no stream indices');
  });
});

describe('classifyThresholds: real fixture CORONA (SWPC + DONKI)', () => {
  const swpc = JSON.parse(readFileSync('fixtures/swpc-goes-xray.json', 'utf8'));
  const donki = JSON.parse(readFileSync('fixtures/donki-flr-cme.json', 'utf8'));
  const raw = {
    xray_flux: swpc.xray_flux,
    kp_index: swpc.kp_index,
    flares: donki.flares,
    cmes: donki.cmes,
  };
  const events = ingest(raw);

  it('ingests CORONA fixture into events', () => {
    assert.ok(events.length > 0, 'should have events');
  });

  it('classifies CORONA as regulatory', () => {
    const result = classifyThresholds(events);
    assert.equal(
      result.type,
      'regulatory',
      `CORONA should be regulatory, got ${result.type}`
    );
  });

  it('CORONA has 4 stream indices (multi-stream)', () => {
    const streamIndices = new Set(
      events.map(e => e.metadata?.stream_index).filter(v => v != null)
    );
    assert.ok(streamIndices.size >= 2, `CORONA should have ≥2 stream indices, got ${streamIndices.size}`);
  });
});

describe('classifyThresholds: real fixture BREATH (PurpleAir + AirNow)', () => {
  const pa = JSON.parse(readFileSync('fixtures/purpleair-sf-bay.json', 'utf8'));
  const an = JSON.parse(readFileSync('fixtures/airnow-sf-bay.json', 'utf8'));
  const raw = { purpleair: pa, airnow: an };
  const events = ingest(raw);

  it('ingests BREATH fixture into events', () => {
    assert.ok(events.length > 0, 'should have events');
  });

  it('classifies BREATH as regulatory', () => {
    const result = classifyThresholds(events);
    assert.equal(
      result.type,
      'regulatory',
      `BREATH should be regulatory, got ${result.type}`
    );
  });

  it('BREATH has 2 stream indices (PurpleAir + AirNow)', () => {
    const streamIndices = new Set(
      events.map(e => e.metadata?.stream_index).filter(v => v != null)
    );
    assert.equal(streamIndices.size, 2, `BREATH should have 2 stream indices, got ${streamIndices.size}`);
  });
});

// ─── Feed grammar integration (classify() returns thresholds) ────────────────

describe('classify: thresholds field populated (no stub)', () => {
  it('classify returns thresholds.type (not null) for any events', async () => {
    const { classify } = await import('../../src/classifier/feed-grammar.js');
    const events = makeEvents([10, 20, 30]);
    const profile = classify(events);
    assert.ok(profile.thresholds !== null, 'thresholds should not be null');
    assert.ok(typeof profile.thresholds.type === 'string', 'thresholds.type should be a string');
    assert.notEqual(profile.thresholds.type, null, 'thresholds.type should not be null (stub removed)');
  });

  it('classify TREMOR: thresholds.type = statistical', async () => {
    const { classify } = await import('../../src/classifier/feed-grammar.js');
    const raw = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const events = ingest(raw);
    const profile = classify(events);
    assert.equal(profile.thresholds.type, 'statistical');
  });

  it('classify BREATH: thresholds.type = regulatory', async () => {
    const { classify } = await import('../../src/classifier/feed-grammar.js');
    const pa = JSON.parse(readFileSync('fixtures/purpleair-sf-bay.json', 'utf8'));
    const an = JSON.parse(readFileSync('fixtures/airnow-sf-bay.json', 'utf8'));
    const events = ingest({ purpleair: pa, airnow: an });
    const profile = classify(events);
    assert.equal(profile.thresholds.type, 'regulatory');
  });
});
