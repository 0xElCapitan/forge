/**
 * test/unit/density.spec.js
 * Unit tests for Sprint 3 Q4 Density Classifier.
 *   - src/classifier/density.js
 *
 * Uses synthetic data for deterministic expected outputs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  extractSensorCount,
  countCoordEvents,
  countGeoJsonFeatures,
  hasSensorGridStream,
  detectMultiTier,
  computeHaversineDistance,
  classifyDensity,
} from '../../src/classifier/density.js';

import { ingest } from '../../src/ingester/generic.js';
import { classify } from '../../src/classifier/feed-grammar.js';
import { anonymize } from '../convergence/anonymizer.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a synthetic event with the given metadata.
 */
function makeEvent(metadata, streamIndex = undefined) {
  return {
    timestamp: 1700000000000,
    value: 10,
    metadata: streamIndex !== undefined
      ? { ...metadata, stream_index: streamIndex }
      : { ...metadata },
  };
}

/**
 * Build N synthetic events with given metadata.
 */
function makeEvents(n, metadata, streamIndex = undefined) {
  return Array.from({ length: n }, (_, i) =>
    makeEvent({ ...metadata }, streamIndex)
  );
}

// ─── extractSensorCount ───────────────────────────────────────────────────────

describe('extractSensorCount', () => {
  it('returns sensor_count when present on first event', () => {
    const events = makeEvents(5, { shape: 'array_row', sensor_count: 20 });
    assert.equal(extractSensorCount(events), 20);
  });

  it('returns sensor_count from any event (not just first)', () => {
    const events = [
      makeEvent({ shape: 'object' }),
      makeEvent({ shape: 'array_row', sensor_count: 15 }),
    ];
    assert.equal(extractSensorCount(events), 15);
  });

  it('returns null when no sensor_count present', () => {
    const events = makeEvents(5, { shape: 'object' });
    assert.equal(extractSensorCount(events), null);
  });

  it('returns null for empty array', () => {
    assert.equal(extractSensorCount([]), null);
  });
});

// ─── countCoordEvents ─────────────────────────────────────────────────────────

describe('countCoordEvents', () => {
  it('counts events with has_coords: true', () => {
    const events = [
      makeEvent({ has_coords: true }),
      makeEvent({ has_coords: false }),
      makeEvent({ has_coords: true }),
      makeEvent({}),
    ];
    assert.equal(countCoordEvents(events), 2);
  });

  it('returns 0 when no events have has_coords: true', () => {
    const events = [
      makeEvent({ has_coords: false }),
      makeEvent({}),
    ];
    assert.equal(countCoordEvents(events), 0);
  });
});

// ─── countGeoJsonFeatures ─────────────────────────────────────────────────────

describe('countGeoJsonFeatures', () => {
  it('counts events with shape: geojson_feature', () => {
    const events = [
      makeEvent({ shape: 'geojson_feature', has_coords: true }),
      makeEvent({ shape: 'object' }),
      makeEvent({ shape: 'geojson_feature', has_coords: false }),  // anonymized
      makeEvent({ shape: 'array_row' }),
    ];
    assert.equal(countGeoJsonFeatures(events), 2);
  });

  it('returns 0 when no geojson_feature events', () => {
    const events = [makeEvent({ shape: 'object' }), makeEvent({ shape: 'array_row' })];
    assert.equal(countGeoJsonFeatures(events), 0);
  });
});

// ─── hasSensorGridStream ──────────────────────────────────────────────────────

describe('hasSensorGridStream', () => {
  it('returns true when any stream is a wide array_row (col_count >= 6)', () => {
    const s0 = makeEvents(20, { shape: 'array_row', col_count: 9 }, 0);
    const s1 = makeEvents(5, { shape: 'object' }, 1);
    const events = [...s0, ...s1];
    const streamIndices = new Set([0, 1]);
    assert.ok(hasSensorGridStream(events, streamIndices));
  });

  it('returns false when array_row has fewer than 6 columns', () => {
    // Kp data: col_count: 4 (narrow time series)
    const s0 = makeEvents(50, { shape: 'array_row', col_count: 4 }, 0);
    const s1 = makeEvents(10, { shape: 'object' }, 1);
    const events = [...s0, ...s1];
    const streamIndices = new Set([0, 1]);
    assert.equal(hasSensorGridStream(events, streamIndices), false);
  });

  it('returns false when no array_row streams', () => {
    const s0 = makeEvents(10, { shape: 'object' }, 0);
    const s1 = makeEvents(10, { shape: 'object' }, 1);
    const events = [...s0, ...s1];
    const streamIndices = new Set([0, 1]);
    assert.equal(hasSensorGridStream(events, streamIndices), false);
  });
});

// ─── detectMultiTier ──────────────────────────────────────────────────────────

describe('detectMultiTier', () => {
  it('returns true for multi-stream with explicit sensor_count', () => {
    const s0 = makeEvents(20, { shape: 'array_row', sensor_count: 20 }, 0);
    const s1 = makeEvents(5, { shape: 'object' }, 1);
    const events = [...s0, ...s1];
    const streamIndices = new Set([0, 1]);
    assert.ok(detectMultiTier(events, streamIndices));
  });

  it('returns true for multi-stream with wide array_row (no sensor_count)', () => {
    const s0 = makeEvents(20, { shape: 'array_row', col_count: 9 }, 0);
    const s1 = makeEvents(5, { shape: 'object' }, 1);
    const events = [...s0, ...s1];
    const streamIndices = new Set([0, 1]);
    assert.ok(detectMultiTier(events, streamIndices));
  });

  it('returns false for single-stream even with sensor_count', () => {
    const events = makeEvents(20, { shape: 'array_row', sensor_count: 20 });
    const streamIndices = new Set();
    assert.equal(detectMultiTier(events, streamIndices), false);
  });

  it('returns false for multi-stream without sensor grid signals', () => {
    // Multi-stream, all object shape, no wide array_row
    const s0 = makeEvents(10, { shape: 'object' }, 0);
    const s1 = makeEvents(10, { shape: 'object' }, 1);
    const events = [...s0, ...s1];
    const streamIndices = new Set([0, 1]);
    assert.equal(detectMultiTier(events, streamIndices), false);
  });
});

// ─── computeHaversineDistance ─────────────────────────────────────────────────

describe('computeHaversineDistance', () => {
  it('returns ~0 for same point', () => {
    const d = computeHaversineDistance({ lat: 37.0, lon: -122.0 }, { lat: 37.0, lon: -122.0 });
    assert.ok(d < 0.001, `expected near 0, got ${d}`);
  });

  it('returns approximately correct distance between two known points', () => {
    // San Francisco to Los Angeles: ~559 km
    const d = computeHaversineDistance(
      { lat: 37.7749, lon: -122.4194 },
      { lat: 34.0522, lon: -118.2437 }
    );
    assert.ok(d > 500 && d < 620, `SF to LA should be ~559km, got ${d.toFixed(1)}km`);
  });

  it('returns approximately 51km for two sensors 51km apart', () => {
    // Two sensors roughly 0.5 degree latitude apart (~55km) but adjusted for 51km
    const d = computeHaversineDistance(
      { lat: 37.0, lon: -122.0 },
      { lat: 37.46, lon: -122.0 }  // ~51km north
    );
    assert.ok(d > 40 && d < 65, `expected ~51km, got ${d.toFixed(1)}km`);
  });
});

// ─── classifyDensity: single_point ───────────────────────────────────────────

describe('classifyDensity: single_point', () => {
  it('returns single_point for empty events array', () => {
    assert.equal(classifyDensity([]).classification, 'single_point');
  });

  it('returns single_point for single-stream events with no coords', () => {
    // Object events with no geographic metadata
    const events = makeEvents(10, { shape: 'object', has_coords: false });
    assert.equal(classifyDensity(events).classification, 'single_point');
  });

  it('returns single_point for multi-stream with no sensor grid signals', () => {
    // Multiple streams of object events (e.g. satellite instruments)
    const s0 = makeEvents(50, { shape: 'array_row', col_count: 4 }, 0);
    const s1 = makeEvents(10, { shape: 'object', has_coords: false }, 1);
    const s2 = makeEvents(10, { shape: 'object', has_coords: false }, 2);
    const events = [...s0, ...s1, ...s2];
    assert.equal(classifyDensity(events).classification, 'single_point');
  });
});

// ─── classifyDensity: sparse_network ─────────────────────────────────────────

describe('classifyDensity: sparse_network', () => {
  it('classifies single-stream GeoJSON features as sparse_network', () => {
    // TREMOR-like: geojson_feature events, single stream
    const events = makeEvents(18, { shape: 'geojson_feature', has_coords: true });
    const result = classifyDensity(events);
    assert.equal(result.classification, 'sparse_network');
    assert.equal(result.sensor_count, 18);
  });

  it('classifies single-stream GeoJSON features without has_coords (anonymized) as sparse_network', () => {
    // After anonymization, has_coords may be false but shape is still geojson_feature
    const events = makeEvents(18, { shape: 'geojson_feature', has_coords: false });
    const result = classifyDensity(events);
    assert.equal(result.classification, 'sparse_network');
  });

  it('classifies single-stream coord events (non-GeoJSON) as sparse_network when count < 200', () => {
    const events = makeEvents(50, { shape: 'object', has_coords: true });
    const result = classifyDensity(events);
    assert.equal(result.classification, 'sparse_network');
  });

  it('edge case: exactly 2 sensors at ~51km apart treated as sparse_network', () => {
    // Two single-stream GeoJSON events = 2 geographic sensors
    const events = [
      makeEvent({ shape: 'geojson_feature', has_coords: true }),
      makeEvent({ shape: 'geojson_feature', has_coords: true }),
    ];
    const result = classifyDensity(events);
    assert.equal(result.classification, 'sparse_network');
  });
});

// ─── classifyDensity: dense_network ──────────────────────────────────────────

describe('classifyDensity: dense_network', () => {
  it('classifies single-stream GeoJSON with >= 200 events as dense_network', () => {
    const events = makeEvents(200, { shape: 'geojson_feature', has_coords: true });
    const result = classifyDensity(events);
    assert.equal(result.classification, 'dense_network');
  });

  it('classifies single-stream coord events with >= 200 events as dense_network', () => {
    const events = makeEvents(300, { shape: 'object', has_coords: true });
    const result = classifyDensity(events);
    assert.equal(result.classification, 'dense_network');
  });
});

// ─── classifyDensity: multi_tier ─────────────────────────────────────────────

describe('classifyDensity: multi_tier', () => {
  it('classifies multi-stream with explicit sensor_count as multi_tier', () => {
    // Raw BREATH-like: PurpleAir stream has sensor_count
    const s0 = makeEvents(20, { shape: 'array_row', col_count: 9, sensor_count: 20 }, 0);
    const s1 = makeEvents(5, { shape: 'object', has_coords: true }, 1);
    const events = [...s0, ...s1];
    const result = classifyDensity(events);
    assert.equal(result.classification, 'multi_tier');
    assert.equal(result.tier_count, 2);
  });

  it('classifies multi-stream with wide array_row (no sensor_count) as multi_tier', () => {
    // Anonymized BREATH-like: sensor_count absent but col_count: 9 present
    const s0 = makeEvents(20, { shape: 'array_row', col_count: 9 }, 0);
    const s1 = makeEvents(5, { shape: 'object', has_coords: true }, 1);
    const events = [...s0, ...s1];
    const result = classifyDensity(events);
    assert.equal(result.classification, 'multi_tier');
  });

  it('does NOT classify multi-stream with narrow array_row as multi_tier', () => {
    // CORONA-like: Kp data has col_count: 4 (narrow time series, not sensor grid)
    const s0 = makeEvents(57, { shape: 'array_row', col_count: 4 }, 0);
    const s1 = makeEvents(716, { shape: 'object', has_coords: true }, 1);
    const events = [...s0, ...s1];
    const result = classifyDensity(events);
    assert.notEqual(result.classification, 'multi_tier',
      `narrow array_row should not trigger multi_tier, got ${result.classification}`);
  });
});

// ─── classifyDensity: edge cases ─────────────────────────────────────────────

describe('classifyDensity: edge cases', () => {
  it('handles single event', () => {
    const events = [makeEvent({ shape: 'object' })];
    const result = classifyDensity(events);
    assert.ok(typeof result.classification === 'string');
  });

  it('returns consistent results (deterministic)', () => {
    const events = makeEvents(18, { shape: 'geojson_feature', has_coords: true });
    const r1 = classifyDensity(events);
    const r2 = classifyDensity(events);
    assert.equal(r1.classification, r2.classification);
  });
});

// ─── classifyDensity: real fixture tests ─────────────────────────────────────

describe('classifyDensity: real fixtures (raw)', () => {
  it('classifies TREMOR (USGS) as sparse_network', () => {
    const raw = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const events = ingest(raw);
    const profile = classify(events);
    assert.equal(profile.density.classification, 'sparse_network',
      `TREMOR Q4 should be sparse_network, got ${profile.density.classification}`);
  });

  it('classifies CORONA (SWPC + DONKI) as single_point', () => {
    const swpc = JSON.parse(readFileSync('fixtures/swpc-goes-xray.json', 'utf8'));
    const donki = JSON.parse(readFileSync('fixtures/donki-flr-cme.json', 'utf8'));
    const raw = { xray_flux: swpc.xray_flux, kp_index: swpc.kp_index, flares: donki.flares, cmes: donki.cmes };
    const events = ingest(raw);
    const profile = classify(events);
    assert.equal(profile.density.classification, 'single_point',
      `CORONA Q4 should be single_point, got ${profile.density.classification}`);
  });

  it('classifies BREATH (PurpleAir + AirNow) as multi_tier', () => {
    const pa = JSON.parse(readFileSync('fixtures/purpleair-sf-bay.json', 'utf8'));
    const an = JSON.parse(readFileSync('fixtures/airnow-sf-bay.json', 'utf8'));
    const raw = { purpleair: pa, airnow: an };
    const events = ingest(raw);
    const profile = classify(events);
    assert.equal(profile.density.classification, 'multi_tier',
      `BREATH Q4 should be multi_tier, got ${profile.density.classification}`);
  });
});

describe('classifyDensity: real fixtures (anonymized)', () => {
  it('classifies TREMOR anonymized as sparse_network', () => {
    const raw = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const anonData = anonymize(raw, 'tremor');
    const events = ingest(anonData);
    const profile = classify(events);
    assert.equal(profile.density.classification, 'sparse_network',
      `TREMOR anonymized Q4 should be sparse_network, got ${profile.density.classification}`);
  });

  it('classifies CORONA anonymized as single_point', () => {
    const swpc = JSON.parse(readFileSync('fixtures/swpc-goes-xray.json', 'utf8'));
    const donki = JSON.parse(readFileSync('fixtures/donki-flr-cme.json', 'utf8'));
    const raw = { xray_flux: swpc.xray_flux, kp_index: swpc.kp_index, flares: donki.flares, cmes: donki.cmes };
    const anonData = anonymize(raw, 'corona');
    const events = ingest(anonData);
    const profile = classify(events);
    assert.equal(profile.density.classification, 'single_point',
      `CORONA anonymized Q4 should be single_point, got ${profile.density.classification}`);
  });

  it('classifies BREATH anonymized as multi_tier', () => {
    const pa = JSON.parse(readFileSync('fixtures/purpleair-sf-bay.json', 'utf8'));
    const an = JSON.parse(readFileSync('fixtures/airnow-sf-bay.json', 'utf8'));
    const raw = { purpleair: pa, airnow: an };
    const anonData = anonymize(raw, 'breath');
    const events = ingest(anonData);
    const profile = classify(events);
    assert.equal(profile.density.classification, 'multi_tier',
      `BREATH anonymized Q4 should be multi_tier, got ${profile.density.classification}`);
  });
});
