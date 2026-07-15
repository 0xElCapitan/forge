// lab/test/census-burned-list.spec.js
//
// Cycle-004 S03 (FR-11a; AC-1; SDD Lane L5:533; Sprint Plan T3.1/T3.7). Proves the
// burned-list authority is deterministically generated from FORGE's own local exposure
// surfaces, that every known burned family is present, and that the provider-product
// join matches at product granularity (provider identity alone never over-burns).
// Fabricated/local; zero network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  KNOWN_BURNED, generateBurnedList, collectSurfaces, serializeBurnedList, isBurned, normalizeToken,
} from '../census/burned-list.js';

const FROZEN = JSON.parse(readFileSync(fileURLToPath(new URL('../census/burned-list.json', import.meta.url)), 'utf8'));

test('AC-1: burned-list generation is deterministic (idempotent + matches the frozen authority)', () => {
  const surfaces = collectSurfaces();
  const a = generateBurnedList(surfaces);
  const b = generateBurnedList(surfaces);
  assert.deepStrictEqual(a, b, 'two generations from identical surfaces are deep-equal');
  assert.deepStrictEqual(a, FROZEN, 'generated list deep-equals the frozen lab/census/burned-list.json');
  // LF-normalize before comparing (mirrors sha256LFNormalized in lab/harness/manifests.js):
  // decouples this byte-identity check from local checkout EOL config (e.g. Windows
  // core.autocrlf), which normalizes the working-tree copy to CRLF while the git blob
  // and serializeBurnedList() output are both LF.
  const frozenBytes = readFileSync(fileURLToPath(new URL('../census/burned-list.json', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(serializeBurnedList(a), frozenBytes, 'serialization is byte-identical to the frozen authority');
});

test('AC-1: every known burned family is present with grounded evidence', () => {
  assert.equal(FROZEN.entries.length, KNOWN_BURNED.length, 'one entry per known burned family');
  for (const fam of KNOWN_BURNED) {
    const found = FROZEN.entries.find(e => e.provider === fam.provider && e.product === fam.product);
    assert.ok(found, `burned family present: ${fam.provider} / ${fam.product}`);
    assert.ok(Array.isArray(found.evidence), `${fam.provider}/${fam.product} carries an evidence array`);
  }
  // Spot-check the canonical burned families from arch §8-1:222.
  const has = (p, q) => FROZEN.entries.some(e => e.provider === p && e.product === q);
  assert.ok(has('USGS', 'seismic (earthquake magnitude)'), 'USGS seismic burned');
  assert.ok(FROZEN.entries.some(e => e.provider === 'NOAA' && e.product.startsWith('SWPC')), 'NOAA SWPC space-weather burned');
  assert.ok(has('AirNow', 'AQI') && has('PurpleAir', 'AQI'), 'AirNow + PurpleAir AQI burned');
  assert.equal(FROZEN.entries.filter(e => e.provider === 'synthetic-robustness').length, 5, 'five synthetic robustness fixtures burned');
  assert.equal(FROZEN.entries.filter(e => e.provider === 'FORGE-snapshots').length, 3, 'three forge-snapshots burned');
});

test('AC-1: burned evidence points at real local exposure surfaces (fixtures / rules / docs)', () => {
  const usgs = FROZEN.entries.find(e => e.provider === 'USGS');
  assert.ok(usgs.evidence.includes('fixtures/usgs-m4.5-day.json'), 'USGS evidence cites the usgs fixture');
  assert.ok(usgs.evidence.includes('src/selector/rules.js'), 'USGS evidence cites the selector rules');
  for (const e of FROZEN.entries) {
    for (const ev of e.evidence) {
      assert.ok(!/^https?:/i.test(ev), 'evidence is a local repo path, never a URL');
    }
  }
});

test('AC-1: provider-product join matches at PRODUCT granularity (no over-burn by provider alone)', () => {
  // exact provider+product => burned
  assert.ok(isBurned({ provider: 'USGS', product: 'seismic (earthquake magnitude)' }, FROZEN), 'USGS seismic is burned');
  assert.ok(isBurned({ provider: 'AirNow', product: 'AQI' }, FROZEN), 'AirNow AQI is burned');
  // same provider, DIFFERENT product => NOT burned (the over-burn-prevention invariant)
  assert.equal(isBurned({ provider: 'USGS', product: 'NWIS river stage/discharge' }, FROZEN), null, 'USGS water is eligible');
  assert.equal(isBurned({ provider: 'NOAA', product: 'CO-OPS coastal water level' }, FROZEN), null, 'NOAA CO-OPS is eligible despite NOAA SWPC being burned');
  assert.equal(isBurned({ provider: 'NOAA', product: 'NDBC buoy significant wave height' }, FROZEN), null, 'NOAA NDBC is eligible');
  // unrelated provider => NOT burned
  assert.equal(isBurned({ provider: 'EIA', product: 'hourly electricity demand' }, FROZEN), null, 'EIA is eligible');
});

test('AC-1: normalizeToken is case/punctuation-insensitive and stable', () => {
  assert.equal(normalizeToken('NOAA'), 'noaa');
  assert.equal(normalizeToken('SWPC GOES X-ray flux'), 'swpc-goes-x-ray-flux');
  assert.equal(normalizeToken('CO-OPS coastal water level'), 'co-ops-coastal-water-level');
  assert.notEqual(normalizeToken('SWPC GOES X-ray flux'), normalizeToken('CO-OPS coastal water level'));
});

test('isBurned rejects malformed inputs (fail-closed)', () => {
  assert.throws(() => isBurned(null, FROZEN), /candidate must be an object/);
  assert.throws(() => isBurned({ provider: 'x', product: 'y' }, {}), /entries array/);
});
