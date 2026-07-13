// test/unit/derive-quantile.spec.js
//
// DR-4/DR-6 quantile + existence primitives: exact-integer HF-1 rank (float-ceil
// trap), existence-bound edges, existence minimum, underflow, order-statistic CI
// (equal-tail and coverage-widen), and the overflow/refusal guards.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDecimalRational, hf1Rank, hf1Quantile, existenceBound, existenceMinN, orderStatCIRanks,
} from '../../src/derive/quantile.js';

const P = parseDecimalRational;
const ALPHA = { num: 5, den: 100 };

test('parseDecimalRational: valid, invalid format, out of range', () => {
  assert.deepStrictEqual(P('0.95'), { num: 95, den: 100 });
  assert.deepStrictEqual(P('0.5'), { num: 5, den: 10 });
  assert.deepStrictEqual(P('0.000001'), { num: 1, den: 1000000 });
  assert.throws(() => P('1.5'), /invalid quantile level/);
  assert.throws(() => P('0.5x'), /invalid quantile level/);
  assert.throws(() => P('.5'), /invalid quantile level/);
  assert.throws(() => P('0.0000001'), /invalid quantile level/); // 7 digits
  assert.throws(() => P(0.5), /decimal string/);
});

test('HF-1 interior ranks (exact integer ceiling)', () => {
  assert.equal(hf1Rank(10, P('0.95')), 10); // ceil(9.5)
  assert.equal(hf1Rank(7, P('0.5')), 4);     // ceil(3.5)
  assert.equal(hf1Rank(3, P('0.5')), 2);     // ceil(1.5)
});

test('HF-1 exact-boundary ranks and the float-ceil trap class (n·p integral)', () => {
  // n·p is exactly integral — the exact-integer formula pins k regardless of float rounding.
  assert.equal(hf1Rank(20, P('0.95')), 19);
  assert.equal(hf1Rank(100, P('0.90')), 90);
  assert.equal(hf1Rank(200, P('0.95')), 190);
  assert.equal(hf1Rank(60, P('0.95')), 57);
  assert.equal(hf1Rank(100, P('0.99')), 99);
});

test('HF-1 quantile is a pure order statistic', () => {
  assert.equal(hf1Quantile([5, 10, 15, 20, 30], P('0.5')), 15);
  assert.equal(hf1Quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], P('0.95')), 10);
  assert.equal(hf1Quantile(Array.from({ length: 20 }, (_, i) => i + 1), P('0.95')), 19);
});

test('existence bound: exact IEEE left-fold values + gate decision at the edges', () => {
  assert.equal(existenceBound(58, P('0.95')), 0.05104686868360325);
  assert.equal(existenceBound(59, P('0.95')), 0.04849452524942309);
  assert.ok(existenceBound(58, P('0.95')) > 0.05, 'n*−1 fails');
  assert.ok(existenceBound(59, P('0.95')) <= 0.05, 'n* passes');
  assert.equal(existenceBound(7, P('0.5')), 0.015625);
});

test('existence minimum n* for the census candidates', () => {
  assert.equal(existenceMinN(P('0.90'), ALPHA), 29);
  assert.equal(existenceMinN(P('0.95'), ALPHA), 59);
  assert.equal(existenceMinN(P('0.99'), ALPHA), 299);
  assert.equal(existenceMinN(P('0.5'), ALPHA), 6);
});

test('underflow region: (1−p_f)^n underflows to exactly 0.0; bound_value = surviving p_f^n', () => {
  // minor term reaches 0.0 at n=249 (p=0.95); bound is then the surviving p_f^n
  let q = 1 - 95 / 100, minor = 1;
  for (let i = 0; i < 249; i++) minor *= q;
  assert.equal(minor, 0, '(1−p_f)^249 underflows to 0.0');
  assert.equal(existenceBound(249, P('0.95')), 0.0000028390805662094717);
  assert.equal(existenceBound(400, P('0.99')), 0.017950553275045134);
});

test('order-statistic CI: equal-tail branch', () => {
  assert.deepStrictEqual(orderStatCIRanks(20, P('0.5'), ALPHA), { l: 6, u: 15, widened: false });
  assert.deepStrictEqual(orderStatCIRanks(30, P('0.5'), ALPHA), { l: 10, u: 21, widened: false });
  assert.deepStrictEqual(orderStatCIRanks(7, P('0.5'), ALPHA), { l: 1, u: 7, widened: false });
});

test('order-statistic CI: coverage-widen branch (asymmetric tail)', () => {
  assert.deepStrictEqual(orderStatCIRanks(59, P('0.95'), ALPHA), { l: 1, u: 59, widened: true });
});

test('overflow / refusal guards', () => {
  assert.throws(() => hf1Rank(10_000_001, P('0.5')), /overflow guard/);       // n > 10^7
  assert.throws(() => hf1Rank(0, P('0.5')), /positive integer/);
  assert.throws(() => hf1Rank(1.5, P('0.5')), /positive integer/);
  assert.throws(() => hf1Quantile([], P('0.5')), /empty/);
  assert.throws(() => existenceBound(0, P('0.5')), /positive integer/);
});
