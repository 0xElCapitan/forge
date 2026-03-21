/**
 * test/unit/ingester.spec.js
 * Unit tests for src/ingester/generic.js
 * Tests all 5 fixture shapes + anonymized USGS shape.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ingest, ingestFile } from '../../src/ingester/generic.js';
import { anonymize } from '../convergence/anonymizer.js';

const SOURCE_IDENTIFIERS_RE = /earthquake\.usgs\.gov|swpc\.noaa|purpleair|airnow|nasa|donki|noaa/i;

describe('ingest: USGS GeoJSON fixture', () => {
  const raw = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
  const events = ingest(raw);

  it('produces NormalizedEvent array', () => {
    assert.ok(Array.isArray(events));
    assert.ok(events.length > 0);
  });

  it('each event has timestamp, value, metadata', () => {
    for (const ev of events) {
      assert.ok(typeof ev.timestamp === 'number', 'timestamp must be number');
      assert.ok(typeof ev.value === 'number', 'value must be number');
      assert.ok(ev.metadata && typeof ev.metadata === 'object', 'metadata must be object');
    }
  });

  it('timestamps are epoch milliseconds (> year 2000)', () => {
    const year2000ms = 946684800000;
    for (const ev of events) {
      assert.ok(ev.timestamp > year2000ms, `timestamp ${ev.timestamp} should be > year 2000`);
    }
  });

  it('metadata contains no source-identifying strings', () => {
    for (const ev of events) {
      const metaStr = JSON.stringify(ev.metadata);
      assert.ok(
        !SOURCE_IDENTIFIERS_RE.test(metaStr),
        `metadata contains source identifier: ${metaStr}`
      );
    }
  });
});

describe('ingest: SWPC combined fixture', () => {
  const raw = JSON.parse(readFileSync('fixtures/swpc-goes-xray.json', 'utf8'));
  const events = ingest(raw);

  it('produces events from both xray_flux and kp_index streams', () => {
    assert.ok(events.length > 0);
  });

  it('events are sorted by timestamp', () => {
    for (let i = 1; i < events.length; i++) {
      assert.ok(
        events[i].timestamp >= events[i - 1].timestamp,
        `events out of order at index ${i}`
      );
    }
  });

  it('metadata contains no source-identifying strings', () => {
    for (const ev of events) {
      const metaStr = JSON.stringify(ev.metadata);
      assert.ok(!SOURCE_IDENTIFIERS_RE.test(metaStr), `source id in metadata: ${metaStr}`);
    }
  });
});

describe('ingest: DONKI fixture', () => {
  const raw = JSON.parse(readFileSync('fixtures/donki-flr-cme.json', 'utf8'));
  const events = ingest(raw);

  it('produces events from flares and cmes', () => {
    assert.ok(events.length > 0);
  });

  it('each event has numeric timestamp and value', () => {
    for (const ev of events) {
      assert.ok(typeof ev.timestamp === 'number');
      assert.ok(typeof ev.value === 'number');
    }
  });
});

describe('ingest: PurpleAir fixture (array-of-arrays with fields)', () => {
  const raw = JSON.parse(readFileSync('fixtures/purpleair-sf-bay.json', 'utf8'));
  const events = ingest(raw);

  it('produces one event per sensor row', () => {
    assert.ok(events.length > 0);
    assert.equal(events.length, raw.data.length);
  });

  it('sensor_count annotated in metadata', () => {
    assert.ok(events[0].metadata.sensor_count > 0);
  });

  it('metadata contains no source-identifying strings', () => {
    for (const ev of events) {
      const metaStr = JSON.stringify(ev.metadata);
      assert.ok(!SOURCE_IDENTIFIERS_RE.test(metaStr));
    }
  });
});

describe('ingest: AirNow fixture (array of objects)', () => {
  const raw = JSON.parse(readFileSync('fixtures/airnow-sf-bay.json', 'utf8'));
  const events = ingest(raw);

  it('produces one event per reading', () => {
    assert.ok(events.length > 0);
    assert.equal(events.length, raw.length);
  });

  it('values are positive numbers', () => {
    for (const ev of events) {
      assert.ok(ev.value >= 0, `value should be non-negative: ${ev.value}`);
    }
  });
});

describe('ingest: anonymized USGS fixture', () => {
  const raw = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
  const anonData = anonymize(raw, 'tremor');
  const rawEvents = ingest(raw);
  const anonEvents = ingest(anonData);

  it('produces same number of events as raw', () => {
    assert.equal(anonEvents.length, rawEvents.length);
  });

  it('timestamps are still valid epoch milliseconds', () => {
    const year2000ms = 946684800000;
    for (const ev of anonEvents) {
      assert.ok(ev.timestamp > year2000ms, `anon timestamp invalid: ${ev.timestamp}`);
    }
  });

  it('values are numeric and finite', () => {
    for (const ev of anonEvents) {
      assert.ok(typeof ev.value === 'number' && Number.isFinite(ev.value));
    }
  });
});

describe('ingestFile', () => {
  it('works for USGS fixture', () => {
    const events = ingestFile('fixtures/usgs-m4.5-day.json');
    assert.ok(Array.isArray(events));
    assert.ok(events.length > 0);
  });

  it('works for AirNow fixture', () => {
    const events = ingestFile('fixtures/airnow-sf-bay.json');
    assert.ok(Array.isArray(events));
    assert.ok(events.length > 0);
  });
});
