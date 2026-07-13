/**
 * src/derive/quantile.js
 *
 * The ONLY place HF-1 quantile / existence-bound / existence-minimum /
 * order-statistic-CI arithmetic exists in the repo (Cycle-004 FR-1; SDD DR-4,
 * DR-6, §8.1). Deterministic, IEEE-pinned: exact-integer rank arithmetic and
 * sequential left-fold powers only — no transcendentals, no floating-point
 * `Math.ceil(n * p_f)` rank.
 *
 * Quantile levels enter as an exact rational `{ num, den }` (den = 10^d),
 * derived from a validated decimal string (DR-6).
 *
 * @module derive/quantile
 */

const RANK_N_MAX   = 10_000_000; // 10^7 — DR-4 overflow guard on n
const RANK_DEN_MAX = 1_000_000;  // 10^6 — DR-4 overflow guard on den
const MINN_N_MAX   = 1_000_000;  // 10^6 — existence-minimum search cap

/**
 * Parse a DR-6 decimal string (`^0\.[0-9]{1,6}$`, 0 < value < 1) into the exact
 * rational `{ num, den = 10^d }`. Throws on any malformed input (fail-closed).
 *
 * @param {string} s
 * @returns {{num:number, den:number}}
 */
export function parseDecimalRational(s) {
  if (typeof s !== 'string') throw new TypeError(`quantile level must be a decimal string, got ${typeof s}`);
  const m = /^0\.([0-9]{1,6})$/.exec(s);
  if (!m) throw new Error(`invalid quantile level "${s}" (must match ^0\\.[0-9]{1,6}$)`);
  const num = parseInt(m[1], 10);
  let den = 1;                              // 10^d by repeated multiply (no `**` — derive-lint)
  for (let i = 0; i < m[1].length; i++) den = den * 10;
  if (!(num > 0 && num < den)) throw new Error(`quantile level "${s}" out of range (0 < p < 1)`);
  return { num, den };
}

/**
 * HF-1 rank: `k = ⌈ n·p ⌉` computed in EXACT integer arithmetic (DR-4/DR-6),
 * never `Math.ceil(n * p_f)` (which can drift by an ULP for exact-decimal p).
 *
 *   a = n·num + den − 1;  k = (a − (a mod den)) / den
 *
 * @param {number} n - number of ordered values (n ≥ 1)
 * @param {{num:number, den:number}} p
 * @returns {number} 1-based rank k
 */
export function hf1Rank(n, { num, den }) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`hf1Rank: n must be a positive integer, got ${n}`);
  if (n > RANK_N_MAX) throw new Error(`hf1Rank: n=${n} exceeds overflow guard ${RANK_N_MAX}`);
  if (den > RANK_DEN_MAX) throw new Error(`hf1Rank: den=${den} exceeds overflow guard ${RANK_DEN_MAX}`);
  const a = n * num + den - 1; // exact: n ≤ 10^7, num < 10^6 ⇒ a < 2^53
  return (a - (a % den)) / den;
}

/**
 * HF-1 quantile estimate: the order statistic `v[k−1]` (0-based) of the
 * ascending-sorted values, `k = hf1Rank(n, p)`. Pure order statistic — no
 * interpolation, no arithmetic on the value.
 *
 * @param {number[]} sortedValues - ascending-sorted values
 * @param {{num:number, den:number}} p
 * @returns {number}
 */
export function hf1Quantile(sortedValues, p) {
  const n = sortedValues.length;
  if (n < 1) throw new Error('hf1Quantile: empty value set');
  return sortedValues[hf1Rank(n, p) - 1];
}

/**
 * Existence bound `bound(n, p) = p_f^n + (1−p_f)^n` (DR-4). `p_f = num/den`
 * (one IEEE division); each power is a sequential left-fold of IEEE
 * multiplications with pinned order; the final addition order is pinned
 * `p_f^n + (1−p_f)^n`. Underflow to 0 is accepted exactly where the recurrence
 * produces it (IEEE gradual underflow is deterministic).
 *
 * @param {number} n
 * @param {{num:number, den:number}} p
 * @returns {number} the exact IEEE bound value
 */
export function existenceBound(n, { num, den }) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`existenceBound: n must be a positive integer, got ${n}`);
  const pf = num / den;
  const q = 1 - pf;
  let a = 1;
  for (let i = 0; i < n; i++) a *= pf;   // p_f^n, order pinned
  let b = 1;
  for (let i = 0; i < n; i++) b *= q;    // (1−p_f)^n, order pinned
  return a + b;                          // pinned addition order
}

/**
 * Existence minimum `n*(p, α)`: the smallest n with `bound(n, p) ≤ α`
 * (DR-4). Deterministic increment with running IEEE products; guard cap.
 *
 * @param {{num:number, den:number}} p
 * @param {{num:number, den:number}} alpha
 * @returns {number} n*
 */
export function existenceMinN(p, alpha) {
  const alphaF = alpha.num / alpha.den;
  for (let n = 1; n <= MINN_N_MAX; n++) {
    if (existenceBound(n, p) <= alphaF) return n;
  }
  throw new Error(`existenceMinN: no n* ≤ ${MINN_N_MAX} for p=${p.num}/${p.den}, α=${alpha.num}/${alpha.den}`);
}

/**
 * Order-statistic CI ranks (DR-4, α two-sided, distribution-free under
 * continuity). Binomial(n, p) via the pinned multiplicative PMF recurrence
 * (IEEE-pinned ops only):
 *
 *   pmf(0) = (1−p_f)^n ;  r = p_f/(1−p_f)
 *   pmf(j+1) = pmf(j) · ((n−j)/(j+1)) · r
 *   F(m)     = Σ_{j=0..m} pmf(j)   (left-to-right accumulation)
 *
 * Ranks (1-based): l = largest j∈[1,n] with F(j−1) ≤ α/2 (else 1);
 * u = smallest j∈[1,n] with F(j−1) ≥ 1−α/2 (else n). If the equal-tail
 * coverage F(u−1)−F(l−1) < 1−α, widen to (1, n).
 *
 * @param {number} n
 * @param {{num:number, den:number}} p
 * @param {{num:number, den:number}} alpha
 * @returns {{l:number, u:number, widened:boolean}}
 */
export function orderStatCIRanks(n, { num, den }, alpha) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`orderStatCIRanks: n must be a positive integer, got ${n}`);
  const alphaF = alpha.num / alpha.den;
  const half = alphaF / 2;
  const hi = 1 - alphaF / 2;
  const cov = 1 - alphaF;

  const pf = num / den;
  const q = 1 - pf;
  const r = pf / q;

  // F[m] = P(X ≤ m), X ~ Binomial(n, p_f)
  const F = new Array(n + 1);
  let pmf = 1;
  for (let i = 0; i < n; i++) pmf *= q; // pmf(0) = (1−p_f)^n, left-fold
  let acc = pmf;
  F[0] = acc;
  for (let j = 0; j < n; j++) {
    pmf = pmf * ((n - j) / (j + 1)) * r;
    acc += pmf;
    F[j + 1] = acc;
  }

  let l = 1;
  let foundL = false;
  for (let j = 1; j <= n; j++) {
    if (F[j - 1] <= half) { l = j; foundL = true; } else break;
  }
  if (!foundL) l = 1;

  let u = n;
  let foundU = false;
  for (let j = 1; j <= n; j++) {
    if (F[j - 1] >= hi) { u = j; foundU = true; break; }
  }
  if (!foundU) u = n;

  const coverage = F[u - 1] - F[l - 1];
  if (coverage < cov) return { l: 1, u: n, widened: true };
  return { l, u, widened: false };
}
