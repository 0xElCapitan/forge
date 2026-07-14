// lab/test/census-eligibility.spec.js
//
// Cycle-004 S03 (FR-11c; AC-3; SDD Lane L5:535; arch §9:244-250; Sprint Plan T3.3/T3.7).
// Proves the six mechanical eligibility gates over fabricated aggregate metadata: pure,
// deterministic, reason-bearing; the 3x-margin existence bound is the imported product
// primitive (no reimplementation); eligibility is the conjunction of the five hard gates
// and gate 6 is a tie-breaker only. Fabricated/local; zero network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  evaluateEligibility, gateHistory, existenceMarginThreshold, ALPHA, CENSUS_MARGIN_P, MIN_OBSERVATIONS, MIN_HISTORY_YEARS,
} from '../census/eligibility.js';
import { existenceBound, parseDecimalRational } from '../../src/derive/quantile.js';

const BURNED = JSON.parse(readFileSync(fileURLToPath(new URL('../census/burned-list.json', import.meta.url)), 'utf8'));
const fx = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../census/fixtures/${name}`, import.meta.url)), 'utf8'));

test('AC-3: fully-eligible fabricated candidate passes all six gates', () => {
  const r = evaluateEligibility(fx('pass-fully-eligible.json'), BURNED);
  assert.equal(r.eligible, true);
  assert.deepStrictEqual(r.failed_hard_gates, []);
  for (const g of ['authority', 'exogeneity', 'history', 'mechanical_outcome', 'burned', 'vintage']) {
    assert.equal(r.gates[g].pass, true, `gate ${g} passes`);
  }
});

test('AC-3: each hard gate fails on its dedicated fabricated fixture', () => {
  assert.deepStrictEqual(evaluateEligibility(fx('fail-gate1-authority.json'), BURNED).failed_hard_gates, ['authority']);
  assert.deepStrictEqual(evaluateEligibility(fx('fail-gate2-exogeneity.json'), BURNED).failed_hard_gates, ['exogeneity']);
  assert.deepStrictEqual(evaluateEligibility(fx('fail-gate3-insufficient-years.json'), BURNED).failed_hard_gates, ['history']);
  assert.deepStrictEqual(evaluateEligibility(fx('fail-gate3-insufficient-observations.json'), BURNED).failed_hard_gates, ['history']);
  assert.deepStrictEqual(evaluateEligibility(fx('fail-gate3-existence-margin.json'), BURNED).failed_hard_gates, ['history']);
  assert.deepStrictEqual(evaluateEligibility(fx('fail-gate4-no-mechanical-outcome.json'), BURNED).failed_hard_gates, ['mechanical_outcome']);
  assert.deepStrictEqual(evaluateEligibility(fx('fail-gate5-burned-exact-match.json'), BURNED).failed_hard_gates, ['burned']);
});

test('AC-3: gate 3 sub-conditions isolate years / count / existence-margin', () => {
  // insufficient-observations: count fails, years + existence-margin PASS (isolates count)
  const g = gateHistory(fx('fail-gate3-insufficient-observations.json'));
  assert.equal(g.pass, false);
  assert.equal(g.sub.years_ok, true);
  assert.equal(g.sub.count_ok, false);
  assert.equal(g.sub.existence_margin_ok, true);
  // insufficient-years: years fails only
  const gy = gateHistory(fx('fail-gate3-insufficient-years.json'));
  assert.equal(gy.sub.years_ok, false);
  assert.equal(gy.sub.count_ok, true);
});

test('AC-3: the 3x-margin bound is the IMPORTED product primitive (existenceBound(n, "0.90") <= alpha/3)', () => {
  const threshold = existenceMarginThreshold();
  assert.equal(threshold, (ALPHA.num / ALPHA.den) / 3, 'threshold = alpha/3 (one pinned division)');
  // The gate value equals the imported primitive's value exactly (no reimplementation).
  const n = 30;
  const g = gateHistory({ history_years: 5, n_observations: n });
  assert.equal(g.sub.existence_bound, existenceBound(n, CENSUS_MARGIN_P), 'gate uses existenceBound verbatim');
  // Boundary: n=38 fails the margin, n=39 clears it (p=0.90, alpha/3).
  assert.equal(gateHistory({ history_years: 5, n_observations: 38 }).sub.existence_margin_ok, false);
  assert.equal(gateHistory({ history_years: 5, n_observations: 39 }).sub.existence_margin_ok, true);
  assert.equal(existenceBound(38, parseDecimalRational('0.90')) > threshold, true);
  assert.equal(existenceBound(39, parseDecimalRational('0.90')) <= threshold, true);
});

test('AC-3: gate 6 (vintage) is a tie-breaker only — undocumented vintage stays eligible', () => {
  const r = evaluateEligibility(fx('edge-vintage-undocumented.json'), BURNED);
  assert.equal(r.eligible, true, 'eligibility holds on gates 1-5');
  assert.equal(r.gates.vintage.pass, false, 'gate 6 recorded as not-documented');
  assert.equal(r.gates.vintage.tiebreaker, true, 'gate 6 is a tie-breaker');
  assert.ok(!r.failed_hard_gates.includes('vintage'), 'vintage is never a hard-gate failure');
});

test('AC-3: gate 5 does not over-burn — same provider, different product stays eligible', () => {
  const r = evaluateEligibility(fx('pass-gate5-same-provider-different-product.json'), BURNED);
  assert.equal(r.eligible, true);
  assert.equal(r.gates.burned.pass, true, 'NOAA CO-OPS not burned despite NOAA SWPC being burned');
});

test('AC-3: gates are pure + deterministic (same input => same output; no input mutation)', () => {
  const input = fx('pass-fully-eligible.json');
  const snapshot = JSON.stringify(input);
  const a = evaluateEligibility(input, BURNED);
  const b = evaluateEligibility(input, BURNED);
  assert.deepStrictEqual(a, b, 'deterministic');
  assert.equal(JSON.stringify(input), snapshot, 'input object is not mutated');
});

test('constants match the accepted thresholds (years >= 3, n >= 10^4)', () => {
  assert.equal(MIN_HISTORY_YEARS, 3);
  assert.equal(MIN_OBSERVATIONS, 10000);
});
