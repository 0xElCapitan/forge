// lab/test/baselines.spec.js
//
// Cycle-004 S02 (FR-8 baseline hierarchy; SDD Lane L3; Sprint Plan §7.2 T2.9,
// AC-17). Import-string assertions (product primitives, zero reimplementation),
// naive HF-1 quantile identity, persistence behavior, transplanted-constant
// mapping rule, reject-all point. Fabricated/local; zero network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { hf1Quantile, parseDecimalRational } from '../../src/derive/quantile.js';
import {
  naiveQuantileBaseline, persistenceBaselineValue, transplantedConstant, rejectAllPoint,
  sharedProfileDims, PROFILE_DIMENSIONS, LEGACY_NUMERIC_THRESHOLD_CANDIDATES,
} from '../harness/baselines.js';

const baselinesSrc = readFileSync(fileURLToPath(new URL('../harness/baselines.js', import.meta.url)), 'utf8');

test('AC-17: baselines import the PRODUCT primitives (import-string asserted; zero reimplementation)', () => {
  assert.match(baselinesSrc, /import\s*\{[^}]*hf1Quantile[^}]*\}\s*from\s*'\.\.\/\.\.\/src\/derive\/quantile\.js'/, 'hf1Quantile from src/derive/quantile.js');
  assert.match(baselinesSrc, /import\s*\{\s*persistenceForecast\s*\}\s*from\s*'\.\.\/\.\.\/src\/baseline\/persistence\.js'/, 'persistenceForecast from the landed module');
  // No re-derivation of HF-1 math in the baseline adapter.
  assert.ok(!/function\s+hf1/.test(baselinesSrc), 'no local hf1* reimplementation');
});

test('naive expanding-window baseline uses the product HF-1 primitive (identical result)', () => {
  const training = [3, 1, 2, 5, 4].map((v, i) => ({ timestamp: i, value: v }));
  const got = naiveQuantileBaseline(training, '0.5');
  const want = hf1Quantile([1, 2, 3, 4, 5], parseDecimalRational('0.5'));
  assert.equal(got, want, 'naive quantile equals a direct product-primitive call');
  assert.equal(got, 3, 'HF-1 median order statistic of [1..5]');
  assert.equal(naiveQuantileBaseline([], '0.5'), null, 'empty training ⇒ null');
});

test('persistence baseline consumes the landed persistenceForecast (most-recent value)', () => {
  const training = [
    { timestamp: 30, value: 9 }, { timestamp: 10, value: 3 }, { timestamp: 20, value: 7 },
  ];
  assert.equal(persistenceBaselineValue(training), 9, 'latest-timestamp value');
  assert.equal(persistenceBaselineValue([]), null, 'empty ⇒ null');
});

test('transplanted-constant mapping: most-shared 5-dim profile; tie → lexical rule id', () => {
  const target = { cadence: 'daily', distribution: 'heavy-tail', noise: 'low', density: 'sparse', thresholds: 'single' };
  const table = [
    { rule_id: 'aqi_threshold_gate', threshold: 151, profile: { cadence: 'hourly', distribution: 'heavy-tail', noise: 'low', density: 'sparse', thresholds: 'single' } }, // shares 4
    { rule_id: 'seismic_threshold_gate', threshold: 5.0, profile: { cadence: 'daily', distribution: 'heavy-tail', noise: 'low', density: 'sparse', thresholds: 'single' } }, // shares 5
    { rule_id: 'space_weather_kp_gate', threshold: 5, profile: { cadence: 'daily', distribution: 'heavy-tail', noise: 'low', density: 'sparse', thresholds: 'single' } }, // shares 5 (tie)
  ];
  const got = transplantedConstant(target, table);
  assert.equal(got.rule_id, 'seismic_threshold_gate', 'tie between seismic & kp (both 5 shared) → lexical min');
  assert.equal(got.threshold, 5.0);
  assert.equal(got.shared_dims, 5);
});

test('transplanted-constant: empty candidate table → null (evaluated table freezes in S03)', () => {
  assert.equal(transplantedConstant({ cadence: 'x' }, []), null);
  assert.throws(() => transplantedConstant({}, [{ rule_id: 'flare', threshold: 'M1.0', profile: {} }]), /non-numeric threshold/, 'non-numeric (string) threshold is excluded/rejected');
});

test('sharedProfileDims counts exactly the 5 FeedProfile dimensions (canonical equality)', () => {
  assert.deepStrictEqual([...PROFILE_DIMENSIONS], ['cadence', 'distribution', 'noise', 'density', 'thresholds']);
  const a = { cadence: 'daily', distribution: 'normal', noise: 'low', density: 'dense', thresholds: { kind: 'single' } };
  const b = { cadence: 'daily', distribution: 'heavy', noise: 'low', density: 'dense', thresholds: { kind: 'single' } };
  assert.equal(sharedProfileDims(a, b), 4, 'differs only on distribution');
});

test('LEGACY_NUMERIC_THRESHOLD_CANDIDATES are the three numeric burned gates (flare M1.0 excluded)', () => {
  assert.deepStrictEqual(LEGACY_NUMERIC_THRESHOLD_CANDIDATES, { seismic_threshold_gate: 5.0, space_weather_kp_gate: 5, aqi_threshold_gate: 151 });
  assert.ok(!('space_weather_flare_gate' in LEGACY_NUMERIC_THRESHOLD_CANDIDATES), 'non-numeric flare gate excluded');
});

test('reject-all is a (risk, coverage) point anchor with no numeric estimate', () => {
  assert.deepStrictEqual(rejectAllPoint(), { kind: 'reject-all', coverage: 0, estimate: null });
});
