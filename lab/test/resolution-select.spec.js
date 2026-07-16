// lab/test/resolution-select.spec.js
//
// Cycle-005 S01 (PRD FR-D1/FR-D3, FR-C2, §9.1; SDD DR-4.4, DR-3 FR-C2; Sprint Plan
// T1.8). Fail-closed reconciliation between the census report, the frozen pool, and the
// §9.1 classification set: unknown census candidate, an unresolved candidate leaking
// into the census (DR-4.4 poisoning), a resolved rank missing from the census, a
// duplicate, and a pool member with no status — every one a HALT.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, runFrozenSelection, SelectRefusal } from '../resolution/select.js';

const POOL = {
  candidates: [
    { rank: 1, provider: 'USGS', product: 'NWIS river stage/discharge' },
    { rank: 2, provider: 'NOAA', product: 'CO-OPS coastal water level' },
    { rank: 3, provider: 'EIA', product: 'hourly electricity demand' },
  ],
};
const BURNED = { entries: [] };
const elig = (provider, product) => ({ provider, product, n_observations: 1000000, history_years: 100, span: null, cadence: 'h', authority_published: true, public: true, machine_readable: true, free: true, exogeneity_judgment: 'x', exogenous: true, mechanical_outcome_declared: true, revision_vintage_documented: true });
const censusReport = (cands) => ({ report_kind: 'aggregate-census', candidates: cands.map(c => ({ source_file: `f-${c.rank}.json`, ...elig(c.provider, c.product) })) });

test('happy: two resolved candidates reconcile; unresolved rank absent from census', () => {
  const report = censusReport([{ rank: 1, provider: 'USGS', product: 'NWIS river stage/discharge' }, { rank: 2, provider: 'NOAA', product: 'CO-OPS coastal water level' }]);
  const status = { 1: { status: 'resolved', class: 'class1' }, 2: { status: 'resolved', class: 'class1' }, 3: { status: 'unresolved', class: 'class3' } };
  const rec = reconcile({ censusReport: report, pool: POOL, statusByRank: status });
  assert.equal(rec.resolved.length, 2);
  assert.equal(rec.unresolved.length, 1);
  assert.equal(rec.unresolved[0].rank, 3);
  const sel = runFrozenSelection(rec.resolved, BURNED);
  assert.equal(sel.sealed, true);
  assert.equal(sel.primary.rank, 1);
  assert.equal(sel.reserve.rank, 2);
});

test('HALT: an unknown census candidate (no exact pool match)', () => {
  const report = censusReport([{ rank: 9, provider: 'GHOST', product: 'phantom feed' }]);
  const status = { 1: { status: 'unresolved', class: 'class3' }, 2: { status: 'unresolved', class: 'class3' }, 3: { status: 'unresolved', class: 'class3' } };
  assert.throws(() => reconcile({ censusReport: report, pool: POOL, statusByRank: status }), SelectRefusal);
});

test('HALT: an unresolved candidate leaked into the census (DR-4.4 poisoning)', () => {
  const report = censusReport([{ rank: 1, provider: 'USGS', product: 'NWIS river stage/discharge' }]);
  const status = { 1: { status: 'unresolved', class: 'class3' }, 2: { status: 'unresolved', class: 'class3' }, 3: { status: 'unresolved', class: 'class3' } };
  assert.throws(() => reconcile({ censusReport: report, pool: POOL, statusByRank: status }), SelectRefusal);
});

test('HALT: a resolved rank is missing from the census report', () => {
  const report = censusReport([{ rank: 1, provider: 'USGS', product: 'NWIS river stage/discharge' }]);
  const status = { 1: { status: 'resolved', class: 'class1' }, 2: { status: 'resolved', class: 'class1' }, 3: { status: 'unresolved', class: 'class3' } };
  assert.throws(() => reconcile({ censusReport: report, pool: POOL, statusByRank: status }), SelectRefusal);
});

test('HALT: a duplicate census candidate', () => {
  const report = censusReport([{ rank: 1, provider: 'USGS', product: 'NWIS river stage/discharge' }, { rank: 1, provider: 'USGS', product: 'NWIS river stage/discharge' }]);
  const status = { 1: { status: 'resolved', class: 'class1' }, 2: { status: 'unresolved', class: 'class3' }, 3: { status: 'unresolved', class: 'class3' } };
  assert.throws(() => reconcile({ censusReport: report, pool: POOL, statusByRank: status }), SelectRefusal);
});

test('HALT: a pool member carries no resolved/unresolved status (FR-A5 — no silent drop)', () => {
  const report = censusReport([{ rank: 1, provider: 'USGS', product: 'NWIS river stage/discharge' }]);
  const status = { 1: { status: 'resolved', class: 'class1' }, 2: { status: 'unresolved', class: 'class3' } }; // rank 3 missing
  assert.throws(() => reconcile({ censusReport: report, pool: POOL, statusByRank: status }), SelectRefusal);
});
