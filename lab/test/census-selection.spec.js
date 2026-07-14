// lab/test/census-selection.spec.js
//
// Cycle-004 S03 (FR-11d; AC-4; SDD Lane L5:536; arch §9:262; Sprint Plan T3.4/T3.7).
// Proves the sealed mechanical selection rule over fabricated pools: primary = first
// passing (ascending rank), reserve = second passing, deterministic, no human-choice hook.
// Fabricated/local; zero network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { applySelectionRule } from '../census/selection-rule.js';

const BURNED = JSON.parse(readFileSync(fileURLToPath(new URL('../census/burned-list.json', import.meta.url)), 'utf8'));
const POOL = JSON.parse(readFileSync(fileURLToPath(new URL('../census/fixtures/selection-pool.json', import.meta.url)), 'utf8'));

test('AC-4: primary = first passing, reserve = second passing (ineligible ranks skipped)', () => {
  const r = applySelectionRule(POOL.candidates, BURNED);
  assert.equal(r.sealed, true, 'result is sealed');
  assert.equal(r.primary.rank, POOL.expected_primary_rank, 'primary is the first passing candidate (rank 2)');
  assert.equal(r.reserve.rank, POOL.expected_reserve_rank, 'reserve is the second passing candidate (rank 4)');
  // rank 1 (paywalled) and rank 3 (burned) are skipped.
  const evalByRank = new Map(r.evaluations.map(e => [e.rank, e]));
  assert.equal(evalByRank.get(1).eligible, false);
  assert.equal(evalByRank.get(3).eligible, false);
  assert.equal(evalByRank.get(2).eligible, true);
  assert.equal(evalByRank.get(4).eligible, true);
});

test('AC-4: selection is deterministic and independent of input array order (rank is the sole authority)', () => {
  const forward = applySelectionRule(POOL.candidates, BURNED);
  const reversed = applySelectionRule(POOL.candidates.slice().reverse(), BURNED);
  assert.deepStrictEqual(forward.primary, reversed.primary, 'primary is order-independent');
  assert.deepStrictEqual(forward.reserve, reversed.reserve, 'reserve is order-independent');
});

test('AC-4: no human-choice hook — the function takes only candidates + burned list', () => {
  // applySelectionRule has exactly two parameters and no injected chooser/tiebreaker hook.
  assert.equal(applySelectionRule.length, 2, 'arity is (candidates, burnedList) — no chooser hook');
});

test('AC-4: fewer than two passing candidates => reserve (or primary) is null, still sealed', () => {
  const onlyOne = [POOL.candidates[1]]; // rank 2 (eligible)
  const r1 = applySelectionRule(onlyOne, BURNED);
  assert.equal(r1.primary.rank, 2);
  assert.equal(r1.reserve, null, 'no second passing candidate => reserve null');
  const none = [POOL.candidates[0], POOL.candidates[2]]; // paywalled + burned (both ineligible)
  const r0 = applySelectionRule(none, BURNED);
  assert.equal(r0.primary, null);
  assert.equal(r0.reserve, null);
  assert.equal(r0.sealed, true);
});

test('AC-4: duplicate rank is a specification error (total-order requirement)', () => {
  const dup = [
    { rank: 1, provider: 'a', product: 'x', metadata: {} },
    { rank: 1, provider: 'b', product: 'y', metadata: {} },
  ];
  assert.throws(() => applySelectionRule(dup, BURNED), /duplicate rank/);
});

test('AC-4: the input candidates array is not mutated', () => {
  const snapshot = JSON.stringify(POOL.candidates);
  applySelectionRule(POOL.candidates, BURNED);
  assert.equal(JSON.stringify(POOL.candidates), snapshot, 'candidates array is untouched');
});
