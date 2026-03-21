/**
 * test/unit/anonymizer.spec.js
 * Unit tests for test/convergence/anonymizer.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { anonymize } from '../convergence/anonymizer.js';

const SAMPLE = {
  mag: 5.4,
  time: 1710000000000,
  depth: 10.2,
  place: 'Near https://earthquake.usgs.gov someplace',
  status: 'reviewed',
  nested: { lat: 37.7, lon: -122.4 },
};

describe('anonymize: field name replacement', () => {
  it('replaces all top-level field names', () => {
    const result = anonymize(SAMPLE, 'test');
    const origKeys = Object.keys(SAMPLE);
    const resultKeys = Object.keys(result);
    for (const k of origKeys) {
      assert.ok(!resultKeys.includes(k), `field "${k}" should have been renamed`);
    }
  });

  it('all anonymized field names are 6 chars', () => {
    const result = anonymize(SAMPLE, 'test');
    for (const k of Object.keys(result)) {
      assert.equal(k.length, 6, `field "${k}" should be 6 chars`);
    }
  });

  it('replaces nested field names', () => {
    const result = anonymize(SAMPLE, 'test');
    // Find nested object
    const nested = Object.values(result).find(v => typeof v === 'object' && v !== null);
    if (nested) {
      assert.ok(!Object.keys(nested).includes('lat'), '"lat" should be renamed in nested');
      assert.ok(!Object.keys(nested).includes('lon'), '"lon" should be renamed in nested');
    }
  });

  it('preserves numeric values exactly', () => {
    const result = anonymize(SAMPLE, 'test');
    const values = Object.values(result).filter(v => typeof v === 'number');
    assert.ok(values.includes(5.4), 'numeric value 5.4 must be preserved');
    assert.ok(values.includes(1710000000000), 'timestamp must be preserved');
    assert.ok(values.includes(10.2), 'depth must be preserved');
  });
});

describe('anonymize: URL stripping', () => {
  it('strips URLs from string values', () => {
    const result = anonymize(SAMPLE, 'test');
    const strValues = Object.values(result).filter(v => typeof v === 'string');
    for (const s of strValues) {
      assert.ok(!/https?:\/\//.test(s), `URL found in value: "${s}"`);
    }
  });
});

describe('anonymize: determinism', () => {
  it('same (data, seed) always produces same output', () => {
    const r1 = anonymize(SAMPLE, 'tremor');
    const r2 = anonymize(SAMPLE, 'tremor');
    assert.deepEqual(r1, r2);
  });

  it('different seeds produce different field names', () => {
    const r1 = anonymize(SAMPLE, 'tremor');
    const r2 = anonymize(SAMPLE, 'corona');
    const keys1 = Object.keys(r1).sort().join(',');
    const keys2 = Object.keys(r2).sort().join(',');
    // Different seeds should (with very high probability) produce different names
    assert.notEqual(keys1, keys2, 'different seeds should produce different field names');
  });

  it('array structure preserved', () => {
    const data = { readings: [{ val: 1.0 }, { val: 2.0 }, { val: 3.0 }] };
    const result = anonymize(data, 'test');
    const arrField = Object.values(result).find(v => Array.isArray(v));
    assert.ok(Array.isArray(arrField), 'array must remain an array');
    assert.equal(arrField.length, 3, 'array length must be preserved');
  });
});

describe('anonymize: real fixtures', () => {
  it('USGS fixture — no original field names survive in properties', () => {
    const raw = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const anon = anonymize(raw, 'tremor');
    // The top-level keys should be renamed
    const rawKeys = Object.keys(raw);
    const anonKeys = Object.keys(anon);
    const unchanged = rawKeys.filter(k => anonKeys.includes(k));
    assert.equal(unchanged.length, 0, `unchanged keys: ${unchanged.join(', ')}`);
  });

  it('AirNow fixture — field names in array items renamed', () => {
    const raw = JSON.parse(readFileSync('fixtures/airnow-sf-bay.json', 'utf8'));
    const anon = anonymize(raw, 'breath');
    assert.ok(Array.isArray(anon), 'should remain an array');
    const rawItemKeys = Object.keys(raw[0]);
    const anonItemKeys = Object.keys(anon[0]);
    const unchanged = rawItemKeys.filter(k => anonItemKeys.includes(k));
    assert.equal(unchanged.length, 0, `unchanged keys: ${unchanged.join(', ')}`);
    // Numeric values preserved
    const rawAQI = raw[0].AQI;
    const anonValues = Object.values(anon[0]);
    assert.ok(anonValues.includes(rawAQI), 'AQI numeric value must be preserved');
  });
});
