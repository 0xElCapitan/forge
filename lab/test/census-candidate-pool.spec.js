// lab/test/census-candidate-pool.spec.js
//
// Cycle-004 S03 (FR-11b; AC-2; SDD Lane L5:534; Sprint Plan T3.2/T3.7). Proves the
// frozen candidate pool exists with a fixed, explicit `rank` enumeration in the accepted
// order, and that it is specification-level only (no measured aggregates, no values).
// Fabricated/local; zero network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const POOL = JSON.parse(readFileSync(fileURLToPath(new URL('../census/candidate-pool.json', import.meta.url)), 'utf8'));

const EXPECTED = [
  { rank: 1, provider: 'USGS', product: 'NWIS river stage/discharge' },
  { rank: 2, provider: 'NOAA', product: 'CO-OPS coastal water level' },
  { rank: 3, provider: 'NOAA', product: 'NDBC buoy significant wave height' },
  { rank: 4, provider: 'NWS/ISD', product: 'station weather observations (temp/wind)' },
  { rank: 5, provider: 'EIA', product: 'hourly electricity demand' },
];

test('AC-2: candidate pool is a frozen specification-level authority', () => {
  assert.equal(POOL.authority, 'candidate-pool');
  assert.equal(POOL.status, 'frozen-specification-level');
  assert.ok(Array.isArray(POOL.candidates) && POOL.candidates.length === 5, 'exactly five candidates');
});

test('AC-2: fixed rank enumeration in the accepted order (1..5)', () => {
  const ranks = POOL.candidates.map(c => c.rank);
  assert.deepStrictEqual(ranks, [1, 2, 3, 4, 5], 'ranks are 1..5 in order');
  for (const exp of EXPECTED) {
    const c = POOL.candidates.find(x => x.rank === exp.rank);
    assert.equal(c.provider, exp.provider, `rank ${exp.rank} provider`);
    assert.equal(c.product, exp.product, `rank ${exp.rank} product`);
  }
});

test('AC-2: every candidate carries the L5 schema fields (rank, provider, product, cadence, vintage_structure, notes)', () => {
  for (const c of POOL.candidates) {
    for (const k of ['rank', 'provider', 'product', 'cadence', 'vintage_structure', 'notes']) {
      assert.ok(k in c, `rank ${c.rank} has field ${k}`);
    }
    assert.equal(typeof c.rank, 'number');
  }
});

test('AC-2: EIA carries the explicit endogeneity flag (arch §9:260)', () => {
  const eia = POOL.candidates.find(c => c.provider === 'EIA');
  assert.equal(eia.endogeneity_flag, true, 'EIA endogeneity is flagged');
  assert.ok(typeof eia.endogeneity_note === 'string' && eia.endogeneity_note.length > 0, 'endogeneity concern is documented');
});

test('AC-2: the pool is NOT a census result (no measured aggregates / values)', () => {
  const text = JSON.stringify(POOL);
  assert.ok(!('n_observations' in POOL), 'no top-level measured aggregates');
  for (const c of POOL.candidates) {
    assert.ok(!('n_observations' in c) && !('values' in c) && !('span' in c), `rank ${c.rank} carries no measured aggregate or value-level content`);
  }
  assert.ok(POOL.description.includes('SPECIFICATION-LEVEL ONLY'), 'pool declares itself specification-level');
  assert.ok(!/https?:\/\//.test(text) || POOL.description.includes('no live metadata'), 'no live-metadata inspection implied');
});
