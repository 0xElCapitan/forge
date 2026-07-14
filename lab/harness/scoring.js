/**
 * lab/harness/scoring.js
 *
 * Cycle-004 S02 (FR-7; SDD Lane L3; Sprint Plan §7.2 T2.3). Deterministic
 * scoring: pinball at p (primary), exceedance calibration (secondary), Brier
 * (diagnostic only). All arithmetic is piecewise-linear / comparison / exact
 * integer — IEEE-pinned; no transcendentals; no new pass/fail threshold.
 *
 * The rejected-origin rule (F-2 — pinned, verbatim into code and tests): an
 * origin whose derived method returns NO_INSTRUMENT has NO numeric estimate ⇒
 * NO `Δ_k` ⇒ it is EXCLUDED from the pinball-improvement median and from the
 * sign-test population; it is NOT a tie, a numeric zero, a synthetic loss, or a
 * fabricated prediction; it is NEVER silently dropped; it REMAINS in the total
 * eligible-origin denominator. Numeric ties (`Δ_k = 0` among candidate-emitting
 * origins) are dropped from the sign test SEPARATELY. Coverage and reason-code
 * distribution are reported SEPARATELY from superiority.
 *
 * @module lab/harness/scoring
 */

import { parseDecimalRational, hf1Quantile } from '../../src/derive/quantile.js';

const HALF = Object.freeze({ num: 1, den: 2 });   // p = 1/2 for the median + sign test
const ALPHA_F = 0.05;                              // pre-registered band level (α = 0.05)

/** `p_f = num/den` (one IEEE division) from a DR-6 decimal string. */
export function pFloat(pStr) {
  const { num, den } = parseDecimalRational(pStr);
  return num / den;
}

// ─── Primary: pinball loss at p ───────────────────────────────────────────────

/**
 * Pinball (quantile) loss for a single outcome:
 *   ρ = p_f·(y − q̂)      if y ≥ q̂
 *   ρ = (1 − p_f)·(q̂ − y) otherwise
 */
export function pinball(y, qHat, pf) {
  return y >= qHat ? pf * (y - qHat) : (1 - pf) * (qHat - y);
}

/**
 * Per-origin pinball = chronological left-fold sum ÷ count. `null` when there is
 * no numeric estimate (rejected origin) or no outcomes.
 */
export function perOriginPinball(outcomes, qHat, pf) {
  if (qHat === null || qHat === undefined) return null;
  if (!outcomes || outcomes.length === 0) return null;
  let sum = 0;
  for (const y of outcomes) sum += pinball(y, qHat, pf);
  return sum / outcomes.length;
}

// ─── Secondary: exceedance calibration + 95% binomial band ────────────────────

/**
 * Binomial(n, prob) CDF vector `F[m] = P(X ≤ m)` via the pinned multiplicative
 * pmf recurrence (identical construction to `orderStatCIRanks`; IEEE-pinned).
 */
export function binomialCDF(n, prob) {
  const q = 1 - prob;
  const F = new Array(n + 1);
  let pmf = 1;
  for (let i = 0; i < n; i++) pmf *= q;   // pmf(0) = (1−prob)^n, left-fold
  let acc = pmf;
  F[0] = acc;
  if (prob === 0) { for (let j = 1; j <= n; j++) F[j] = 1; return F; }
  const r = prob / q;
  for (let j = 0; j < n; j++) {
    pmf = pmf * ((n - j) / (j + 1)) * r;
    acc += pmf;
    F[j + 1] = acc;
  }
  return F;
}

/**
 * Central two-sided 95% binomial band on the COUNT for X ~ Binomial(n, prob):
 *   k_lo = smallest k∈[0,n] with F(k) ≥ α/2
 *   k_hi = smallest k∈[0,n] with F(k) ≥ 1 − α/2
 * Band rates = [k_lo/n, k_hi/n]. Deterministic CDF inversion.
 */
export function binomialBand(n, prob, alphaF = ALPHA_F) {
  const F = binomialCDF(n, prob);
  const half = alphaF / 2;
  const hi = 1 - alphaF / 2;
  let kLo = n;
  for (let k = 0; k <= n; k++) { if (F[k] >= half) { kLo = k; break; } }
  let kHi = n;
  for (let k = 0; k <= n; k++) { if (F[k] >= hi) { kHi = k; break; } }
  return { k_lo: kLo, k_hi: kHi, rate_lo: kLo / n, rate_hi: kHi / n };
}

/**
 * Exceedance calibration: empirical exceedance rate = count(y > q̂) ÷ n vs
 * target `1 − p_f`, with the pre-registered 95% binomial band. `null` when no
 * numeric estimate or no outcomes.
 */
export function exceedanceStats(outcomes, qHat, pf) {
  if (qHat === null || qHat === undefined) return null;
  if (!outcomes || outcomes.length === 0) return null;
  const n = outcomes.length;
  let exceed = 0;
  for (const y of outcomes) { if (y > qHat) exceed += 1; }
  const target = 1 - pf;
  const band = binomialBand(n, target, ALPHA_F);
  const empirical_rate = exceed / n;
  return {
    n,
    count_exceed: exceed,
    empirical_rate,
    target,
    band,
    in_band: (exceed >= band.k_lo && exceed <= band.k_hi),
  };
}

// ─── Diagnostic only: Brier (never primary) ───────────────────────────────────

/**
 * Brier diagnostic: forecast exceedance probability = the design target `1 − p_f`;
 * outcome = 1{y > q̂}; Brier = mean squared difference (pinned multiplies).
 * `null` when no numeric estimate or no outcomes. Reported under `diagnostics`.
 */
export function brierDiagnostic(outcomes, qHat, pf) {
  if (qHat === null || qHat === undefined) return null;
  if (!outcomes || outcomes.length === 0) return null;
  const forecast = 1 - pf;
  let sum = 0;
  for (const y of outcomes) {
    const o = y > qHat ? 1 : 0;
    const d = forecast - o;
    sum += d * d;
  }
  return { forecast_prob: forecast, n: outcomes.length, brier: sum / outcomes.length };
}

/**
 * All per-origin scores for one origin. `estimates` are numeric or `null`
 * (a `null` method estimate = rejected origin; baselines may still be scored
 * for diagnostics). Exceedance/Brier are computed for the METHOD estimate only.
 *
 * @param {{outcomes:number[], estimates:{method:number|null, naive:number|null, persistence:number|null, constant:number|null}, pf:number}} p
 */
export function scorePerOrigin({ outcomes, estimates, pf }) {
  return {
    pinball: {
      method: perOriginPinball(outcomes, estimates.method, pf),
      naive: perOriginPinball(outcomes, estimates.naive, pf),
      persistence: perOriginPinball(outcomes, estimates.persistence, pf),
      constant: perOriginPinball(outcomes, estimates.constant, pf),
    },
    exceedance: exceedanceStats(outcomes, estimates.method, pf),
    diagnostics: { brier: brierDiagnostic(outcomes, estimates.method, pf) },
  };
}

// ─── Cross-origin aggregation (F-2) + decision statistics ─────────────────────

/**
 * Two-sided exact sign test at p = 1/2 (ties already excluded upstream):
 *   n_eff = positives + negatives; k = min(positives, negatives);
 *   p_value = min(1, 2·F(k))  under Binomial(n_eff, ½).
 * `p_value: null` when n_eff = 0.
 */
export function signTestTwoSided(positives, negatives, tiesDropped) {
  const nEff = positives + negatives;
  if (nEff === 0) {
    return { n_effective: 0, positives, negatives, ties_dropped: tiesDropped, p_value: null };
  }
  const F = binomialCDF(nEff, 0.5);
  const k = Math.min(positives, negatives);
  const p = 2 * F[k];
  return {
    n_effective: nEff, positives, negatives, ties_dropped: tiesDropped,
    p_value: p > 1 ? 1 : p,
  };
}

/**
 * HF-1 median (exact order statistic, p = 1/2) over an array of numbers via the
 * PRODUCT primitive (zero reimplementation). `null` for an empty array.
 */
export function medianHF1(values) {
  if (!values || values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return hf1Quantile(sorted, HALF);
}

/**
 * Aggregate the F-2 rejection metrics + decision statistics over a run's
 * origins. `Δ_k = score_primaryBaseline,k − score_method,k` (positive ⇒ method
 * better) over the candidate-emitting origins that have a computable delta; the
 * median is taken over those, and the sign test drops `Δ_k = 0` ties separately.
 * Rejected origins carry no `Δ_k` and stay in the eligible denominator only.
 *
 * @param {Array<Object>} origins - per-origin results from the engine
 * @param {{primaryBaseline?:string}} [opts]
 */
export function aggregate(origins, { primaryBaseline = 'naive' } = {}) {
  const eligible = origins.length;
  const candidateEmitting = [];
  const rejected = [];
  const reasonDist = {};

  for (const o of origins) {
    if (o.method.state === 'RANKED_CANDIDATES') {
      candidateEmitting.push(o);
    } else if (o.method.state === 'NO_INSTRUMENT') {
      rejected.push(o);
      const rc = o.method.reason_code;
      reasonDist[rc] = (reasonDist[rc] || 0) + 1;
    }
  }

  // Numeric-comparison population: candidate-emitting origins with a computable
  // Δ (both method and primary-baseline pinball present). Rejections never enter.
  const deltas = [];
  const includedIds = [];
  for (const o of candidateEmitting) {
    const m = o.scores.pinball.method;
    const b = o.scores.pinball[primaryBaseline];
    if (m !== null && b !== null) {
      deltas.push(b - m);           // Δ_k = baseline − method
      includedIds.push(o.origin_ms);
    }
  }

  let positives = 0, negatives = 0, ties = 0;
  for (const d of deltas) { if (d > 0) positives += 1; else if (d < 0) negatives += 1; else ties += 1; }

  const rejection_metrics = {
    eligible_origins: eligible,
    candidate_emitting_origins: candidateEmitting.length,
    rejected_origins: rejected.length,
    numeric_comparison_coverage: eligible === 0 ? 0 : candidateEmitting.length / eligible,
    reason_code_distribution: reasonDist,
    included_origin_ids: includedIds,
  };

  const decision_statistics = {
    primary_baseline: primaryBaseline,
    numeric_population: deltas.length,
    median_delta: medianHF1(deltas),
    sign_test: signTestTwoSided(positives, negatives, ties),
  };

  return { rejection_metrics, decision_statistics };
}
