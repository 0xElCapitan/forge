/**
 * test/unit/replay.spec.js
 * Unit tests for src/replay/deterministic.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createReplay, loadFixture } from '../../src/replay/deterministic.js';

describe('createReplay', () => {
  it('loads USGS GeoJSON fixture and detects geojson_feature_collection shape', () => {
    const result = createReplay('fixtures/usgs-m4.5-day.json', { speedFactor: 0 });
    assert.equal(result.shape, 'geojson_feature_collection');
    assert.ok(result.events.length > 0, 'should have features');
    assert.ok(result.events[0].type === 'Feature', 'features should have type:Feature');
  });

  it('loads SWPC combined fixture and detects combined_object shape', () => {
    const result = createReplay('fixtures/swpc-goes-xray.json');
    assert.equal(result.shape, 'combined_object');
    assert.ok(result.events.length > 0);
    // Events are {_stream, _data} tagged
    assert.ok('_stream' in result.events[0], 'combined events tagged with _stream');
  });

  it('loads DONKI fixture and detects combined_object shape', () => {
    const result = createReplay('fixtures/donki-flr-cme.json');
    assert.equal(result.shape, 'combined_object');
    assert.ok(result.events.length > 0);
  });

  it('loads AirNow fixture and detects array_of_objects shape', () => {
    const result = createReplay('fixtures/airnow-sf-bay.json');
    assert.equal(result.shape, 'array_of_objects');
    assert.ok(result.events.length > 0);
  });

  it('same input produces identical output (deterministic)', () => {
    const r1 = createReplay('fixtures/usgs-m4.5-day.json');
    const r2 = createReplay('fixtures/usgs-m4.5-day.json');
    assert.deepEqual(r1.events.length, r2.events.length);
    assert.deepEqual(r1.events[0], r2.events[0]);
  });

  it('fixturePath is preserved in result', () => {
    const result = createReplay('fixtures/usgs-m4.5-day.json');
    assert.equal(result.fixturePath, 'fixtures/usgs-m4.5-day.json');
  });
});

describe('loadFixture', () => {
  it('returns events array directly', () => {
    const events = loadFixture('fixtures/usgs-m4.5-day.json');
    assert.ok(Array.isArray(events));
    assert.ok(events.length > 0);
  });
});
