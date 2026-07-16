// lab/test/resolution-pstar.spec.js
//
// Cycle-005 S01 (PRD FR-D4; SDD DR-6; Sprint Plan T1.8). The frozen-code known-answer
// tests (existence-bound clearing minima n=39/80/408 for 0.90/0.95/0.99; the 10⁴
// boundary), the defensive no-clear HALT branch, and the FR-D4 lawfulness precondition
// (p* resolves ONLY for a sealed primary whose n is FR-A6 class (i)/accepted (ii)).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePStar, resolveLawful, PStarRefusal, PSTAR_LEVELS, THRESHOLD } from '../resolution/pstar.js';

test('DR-6 known answers: clearing minima are exactly n=39/80/408 for 0.90/0.95/0.99', () => {
  assert.equal(resolvePStar(39).p_star, '0.90');
  assert.equal(resolvePStar(79).p_star, '0.90');
  assert.equal(resolvePStar(80).p_star, '0.95');
  assert.equal(resolvePStar(407).p_star, '0.95');
  assert.equal(resolvePStar(408).p_star, '0.99');
});

test('DR-6: at every Gate-3-passing n (≥ 10⁴) p* saturates to 0.99', () => {
  for (const n of [10000, 100000, 1000000]) assert.equal(resolvePStar(n).p_star, '0.99');
});

test('DR-6 bound table is full + descending, with clears_3x flags', () => {
  const { bounds } = resolvePStar(10000);
  assert.deepEqual(bounds.map(b => b.p), ['0.99', '0.95', '0.90']);
  assert.ok(bounds.every(b => b.clears_3x === true));
  assert.ok(bounds.every(b => typeof b.bound === 'number' && b.bound <= THRESHOLD));
});

test('DR-6.5 defensive branch: no level clears below the minimum ⇒ PStarRefusal (never a silent default)', () => {
  assert.throws(() => resolvePStar(38), PStarRefusal, 'n=38 clears no level');
  assert.throws(() => resolvePStar(0), PStarRefusal);
});

test('FR-D4: p* resolves for a sealed primary with class-(i) n', () => {
  const r = resolveLawful({ sealed_primary: { rank: 1, provider: 'EIA', product: 'x' }, n: 87600, n_classification: 'i' });
  assert.equal(r.p_star, '0.99');
  assert.equal(r.blocked, undefined);
  assert.equal(r.alpha, '0.05');
});

test('FR-D4: accepted class-(ii) n also resolves', () => {
  assert.equal(resolveLawful({ sealed_primary: { rank: 1, provider: 'a', product: 'b' }, n: 50000, n_classification: 'ii' }).p_star, '0.99');
});

test('FR-D4 block: an unclassified/approximation n is blocked (not a resolved p*)', () => {
  const r = resolveLawful({ sealed_primary: { rank: 1, provider: 'a', product: 'b' }, n: 50000, n_classification: 'iii' });
  assert.equal(r.p_star, null);
  assert.ok(r.blocked && /FR-A6 class \(i\)\/\(ii\)/.test(r.blocked.reason));
});

test('FR-D4 block: no sealed primary is blocked', () => {
  const r = resolveLawful({ sealed_primary: null, n: 50000, n_classification: 'i' });
  assert.equal(r.p_star, null);
  assert.ok(r.blocked);
});

test('the three frozen levels are the exact candidate set', () => {
  assert.deepEqual([...PSTAR_LEVELS], ['0.99', '0.95', '0.90']);
});
