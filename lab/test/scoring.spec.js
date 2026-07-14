// lab/test/scoring.spec.js
//
// Cycle-004 S02 (FR-7 scoring + F-2 rejected-origin rule; SDD Lane L3; Sprint
// Plan §7.2 T2.9). Scoring vectors (pinball/median/sign-test/exceedance/Brier/
// aggregate) recomputed to exact deep + digest equality, plus direct F-2 and
// Brier-placement assertions. Fabricated/local; zero network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { canonicalize } from '../../src/receipt/canonicalize.js';
import { sha256 } from '../../src/receipt/hash.js';
import {
  pFloat, pinball, perOriginPinball, medianHF1, signTestTwoSided,
  binomialBand, exceedanceStats, brierDiagnostic, aggregate, scorePerOrigin,
} from '../harness/scoring.js';

const SPEC = JSON.parse(readFileSync(fileURLToPath(new URL('../../spec/derive-vectors.json', import.meta.url)), 'utf8'));
const CATEGORIES = new Set(['scoring-pinball', 'scoring-median', 'scoring-signtest', 'scoring-exceedance', 'scoring-brier', 'scoring-rejection-metrics']);
const vectors = SPEC.vectors.filter(v => v.consumer === 'lab' && CATEGORIES.has(v.category));

const DISPATCH = {
  pinball: (i) => pinball(i.y, i.qHat, pFloat(i.p)),
  perOriginPinball: (i) => perOriginPinball(i.outcomes, i.qHat, pFloat(i.p)),
  median: (i) => medianHF1(i.values),
  signTest: (i) => signTestTwoSided(i.positives, i.negatives, i.ties),
  binomialBand: (i) => binomialBand(i.n, i.prob),
  exceedanceStats: (i) => exceedanceStats(i.outcomes, i.qHat, pFloat(i.p)),
  brierDiagnostic: (i) => brierDiagnostic(i.outcomes, i.qHat, pFloat(i.p)),
  aggregate: (i) => aggregate(i.origins, { primaryBaseline: i.primaryBaseline }),
};

test('every scoring vector recomputes to exact deep + digest equality (F-5)', () => {
  assert.ok(vectors.length >= 10, 'scoring vectors present');
  for (const v of vectors) {
    assert.ok(typeof DISPATCH[v.op] === 'function', `${v.id}: dispatcher for op ${v.op}`);
    const computed = DISPATCH[v.op](v.input);
    assert.deepStrictEqual(computed, v.expected, `${v.id}: computed !== expected`);
    assert.equal(sha256(canonicalize(computed)), v.expected_digest, `${v.id}: expected_digest`);
    const { entry_digest, ...rest } = v;
    assert.equal(sha256(canonicalize(rest)), v.entry_digest, `${v.id}: entry_digest`);
  }
});

test('pinball is symmetric-weighted at p=0.5 and asymmetric at p≠0.5', () => {
  assert.equal(pinball(10, 8, 0.5), pinball(6, 8, 0.5), 'p=0.5 symmetric (|diff|·0.5)');
  assert.ok(pinball(10, 8, 0.75) > pinball(6, 8, 0.75), 'p=0.75 over-penalizes under-prediction of a high quantile');
});

test('F-2: a rejected origin (null method estimate) yields null method pinball but scored baselines', () => {
  const s = scorePerOrigin({ outcomes: [1, 2, 3, 4], estimates: { method: null, naive: 2, persistence: 3, constant: null }, pf: 0.5 });
  assert.equal(s.pinball.method, null, 'rejected origin has no numeric method score');
  assert.notEqual(s.pinball.naive, null, 'baseline still scored for diagnostics');
  assert.equal(s.pinball.constant, null, 'absent constant is null');
  assert.equal(s.exceedance, null, 'no method estimate ⇒ no exceedance');
  assert.equal(s.diagnostics.brier, null, 'no method estimate ⇒ no Brier');
});

test('F-2: rejections stay in the eligible denominator but never enter median/sign-test; ties dropped separately', () => {
  const origins = [
    { origin_ms: 1, method: { state: 'NO_INSTRUMENT', reason_code: 'insufficient_history' }, scores: { pinball: { method: null, naive: 2 } } },
    { origin_ms: 2, method: { state: 'RANKED_CANDIDATES', reason_code: null }, scores: { pinball: { method: 2, naive: 3 } } }, // Δ=+1
    { origin_ms: 3, method: { state: 'RANKED_CANDIDATES', reason_code: null }, scores: { pinball: { method: 2, naive: 2 } } }, // Δ=0 tie
  ];
  const { rejection_metrics: rm, decision_statistics: ds } = aggregate(origins, { primaryBaseline: 'naive' });
  assert.equal(rm.eligible_origins, 3, 'rejection stays in the eligible denominator');
  assert.equal(rm.candidate_emitting_origins, 2);
  assert.equal(rm.rejected_origins, 1);
  assert.deepStrictEqual(rm.included_origin_ids, [2, 3], 'only candidate-emitting origins with a Δ are included');
  assert.deepStrictEqual(rm.reason_code_distribution, { insufficient_history: 1 });
  assert.equal(ds.sign_test.ties_dropped, 1, 'the Δ=0 tie is dropped from the sign test');
  assert.equal(ds.sign_test.n_effective, 1, 'tie excluded ⇒ n_eff = 1 (rejection never counted)');
});

test('Brier is placed under diagnostics only — never in the primary pinball block', () => {
  const s = scorePerOrigin({ outcomes: [1, 2, 3, 4], estimates: { method: 2, naive: 2, persistence: 2, constant: 2 }, pf: 0.5 });
  assert.ok('brier' in s.diagnostics, 'Brier lives under diagnostics');
  assert.ok(!('brier' in s.pinball), 'Brier is never a primary pinball key');
  assert.ok(!('scoring' in s), 'no forbidden claim-ceiling key');
});

test('empty outcomes / empty delta population degrade to null, never throw', () => {
  assert.equal(perOriginPinball([], 5, 0.5), null);
  assert.equal(medianHF1([]), null);
  const st = signTestTwoSided(0, 0, 0);
  assert.equal(st.p_value, null, 'no non-tie candidates ⇒ null p-value');
});
