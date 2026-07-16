// lab/test/resolution-invariance.spec.js
//
// Cycle-005 S01 (PRD FR-D2, §9.1, UD-5/UD-7; SDD DR-5; Sprint Plan T1.8). The DR-5
// truth table proving the enumeration implements FR-D2 EXACTLY: k=0 trivial;
// below-pair irrelevance; above-rank blocking; none/primary-only blocking; Tier-2
// fixed-gate narrowing (the EIA authored-exogenous:false case); fail-closed on any
// throw; and the DR-5.6 self-check invariant (all-ineligible branch == resolved run).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runInvarianceTest } from '../resolution/invariance.js';
import { runFrozenSelection } from '../resolution/select.js';

const RES = fileURLToPath(new URL('../resolution/fixtures/', import.meta.url));
const standIns = {
  eligible: JSON.parse(readFileSync(RES + 'hypothetical-eligible.json', 'utf8')),
  ineligible: JSON.parse(readFileSync(RES + 'hypothetical-ineligible.json', 'utf8')),
};
const BURNED = { entries: [] };
const elig = (p, pr) => ({ provider: p, product: pr, n_observations: 1000000, history_years: 100, span: null, cadence: 'h', authority_published: true, public: true, machine_readable: true, free: true, exogeneity_judgment: 'x', exogenous: true, mechanical_outcome_declared: true, revision_vintage_documented: true });
const R = (rank, provider, product) => ({ rank, provider, product, metadata: elig(provider, product) });
const U = (rank, provider, product, fixed_fields) => ({ rank, provider, product, class: 'class3', ...(fixed_fields ? { fixed_fields } : {}) });

test('k=0 trivial: a resolved primary+reserve is invariant (tier 1, 1 branch)', () => {
  const r = runInvarianceTest({ resolved: [R(1, 'USGS', 'a'), R(2, 'NOAA', 'b')], unresolved: [], burnedList: BURNED, standIns });
  assert.equal(r.invariant, true);
  assert.equal(r.tier, 1);
  assert.equal(r.branch_count, 1);
  assert.equal(r.common_outcome.primary.rank, 1);
  assert.equal(r.common_outcome.reserve.rank, 2);
});

test('below-pair irrelevance: an unresolved candidate below a full {primary,reserve} pair does not block', () => {
  const r = runInvarianceTest({ resolved: [R(1, 'USGS', 'a'), R(2, 'NOAA', 'b')], unresolved: [U(3, 'EIA', 'c')], burnedList: BURNED, standIns });
  assert.equal(r.invariant, true, 'rank 3 cannot displace a full pair');
  assert.equal(r.common_outcome.primary.rank, 1);
  assert.equal(r.common_outcome.reserve.rank, 2);
});

test('above-rank blocking: an unresolved candidate ranked ABOVE the primary blocks', () => {
  const r = runInvarianceTest({ resolved: [R(3, 'EIA', 'c')], unresolved: [U(1, 'USGS', 'a')], burnedList: BURNED, standIns });
  assert.equal(r.invariant, false);
  assert.deepEqual(r.blocking_candidates.map(b => b.rank), [1]);
});

test('primary-only blocking: an unresolved candidate that could ADD a reserve blocks', () => {
  const r = runInvarianceTest({ resolved: [R(1, 'USGS', 'a')], unresolved: [U(2, 'NOAA', 'b')], burnedList: BURNED, standIns });
  assert.equal(r.invariant, false, 'a primary-only seal must not seal while a reserve could still appear');
  assert.deepEqual(r.blocking_candidates.map(b => b.rank), [2]);
});

test('none blocking: an unresolved candidate that could ADD a primary blocks a "none" seal', () => {
  const r = runInvarianceTest({ resolved: [], unresolved: [U(1, 'USGS', 'a')], burnedList: BURNED, standIns });
  assert.equal(r.invariant, false);
  assert.deepEqual(r.blocking_candidates.map(b => b.rank), [1]);
});

test('Tier-2 fixed-gate narrowing: EIA authored exogenous:false → ineligible-in-every-completion → invariant', () => {
  const r = runInvarianceTest({
    resolved: [R(1, 'USGS', 'a')],
    unresolved: [U(5, 'EIA', 'hourly electricity demand', { exogenous: false, exogeneity_judgment: 'endogeneity_flag:true → non-exogenous' })],
    burnedList: BURNED, standIns,
  });
  assert.equal(r.invariant, true);
  assert.equal(r.tier, 2);
  assert.deepEqual(r.tier2_exclusions.map(e => e.rank), [5]);
  assert.equal(r.common_outcome.primary.rank, 1);
  assert.equal(r.common_outcome.reserve, null, 'EIA excluded → no reserve appears');
});

test('fail-closed: any throw during enumeration ⇒ invariant:false (no seal)', () => {
  const r = runInvarianceTest({ resolved: [R(1, 'A', 'x'), R(1, 'B', 'y')], unresolved: [], burnedList: BURNED, standIns });
  assert.equal(r.invariant, false);
  assert.equal(r.fail_closed, true);
  assert.ok(r.error);
});

test('DR-5.6 self-check: the all-ineligible branch equals the real resolved-subset run', () => {
  const resolved = [R(2, 'NOAA', 'b')];
  const r = runInvarianceTest({ resolved, unresolved: [U(1, 'USGS', 'a'), U(3, 'EIA', 'c')], burnedList: BURNED, standIns });
  const realResolved = runFrozenSelection(resolved, BURNED);
  // branches[0] = mask 0 = all unresolved assigned ineligible.
  const allIneligible = r.branches[0];
  assert.equal(allIneligible.outcome.primary.rank, realResolved.primary.rank);
  assert.equal(allIneligible.outcome.reserve, realResolved.reserve);
});

test('DR-5.8 structural lemma: cost is ≤ 2^k branches', () => {
  const r = runInvarianceTest({ resolved: [], unresolved: [U(1, 'a', 'a'), U(2, 'b', 'b'), U(3, 'c', 'c')], burnedList: BURNED, standIns });
  assert.equal(r.branch_count, 8, '2^3 = 8 branches');
});
