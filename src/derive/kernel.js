/**
 * src/derive/kernel.js
 *
 * Derivation-kernel orchestration (Cycle-004 FR-1/FR-2/FR-5; SDD Lane L1, DR-5):
 *   qualify → trailing window → effective information → MAY-gates
 *   (unacceptable_missingness, no_nontrivial_parameter) → existence gate →
 *   HF-1 estimate → order-statistic uncertainty → ParameterRecord v0 | RejectionRecord.
 *
 * A bare number is never emitted: a derived record carries `uncertainty` and
 * `effective_information` by construction (asserted, else DR-5 specification
 * error). All kernel math lives in the single-source modules; the kernel only
 * orchestrates.
 *
 * @module derive/kernel
 */

import {
  parseDecimalRational, hf1Quantile, existenceBound, existenceMinN, orderStatCIRanks,
} from './quantile.js';
import { qualifyingObservations, effectiveInformation } from './effective-information.js';
import { trailingWindow } from './window.js';
import { OUTPUT_STATES, REASON_CODES } from './reason-codes.js';

const ALPHA = { num: 5, den: 100 }; // α = 0.05, non-configurable
const ALPHA_STR = '0.05';
const ALPHA_FLOAT = 5 / 100;

const GATE_ID = 'quantile-ci-existence';
const ALGORITHM_ID = 'quantile-trailing-window';
const ALGORITHM_VERSION = '1.0.0';
const QUANTILE_DEFINITION = 'HF-1';
const UNITS = 'feed-native (declared)';
const CI_METHOD = 'order-statistic-ci';
const COVERAGE_MODEL = 'distribution-free; exact if no ties, else conservative';
const RECONSIDER_CONDITION =
  'window may satisfy the existence bound after (needed_n − n) further qualifying observations';

/**
 * @param {Array<{timestamp:number, value:number, metadata:Object}>} events - raw NormalizedEvents
 * @param {{p:string, now:number, window:{min_days:number, n_min:number}}} config
 * @returns {{state:string, record:Object}|{state:string, reason_code:string, evidence:Object, reconsideration?:Object}}
 */
export function deriveThresholdParameter(events, config) {
  const pStr = config.p;
  const p = parseDecimalRational(pStr);
  const endMs = config.now;
  const { min_days, n_min } = config.window;

  // 1. canonical qualifying observations (F-3)
  const q = qualifyingObservations(events);

  // 2. trailing window
  const win = trailingWindow(q, endMs, { min_days, n_min });

  // window failed to form (< n_min qualifying) ⇒ insufficient history
  if (win === null) {
    return {
      state: OUTPUT_STATES.NO_INSTRUMENT,
      reason_code: REASON_CODES.insufficient_history,
      evidence: {
        gate_id: GATE_ID, n: q.length, p: pStr, alpha: ALPHA_STR,
        window: null, effective_information: effectiveInformation(q),
      },
      reconsideration: {
        needed_n: Math.max(n_min, existenceMinN(p, ALPHA)),
        condition: RECONSIDER_CONDITION,
      },
    };
  }

  // 3. effective information over the window's qualifying observations
  const qWin = q.filter(e => e.timestamp >= win.start_ms && e.timestamp <= win.end_ms);
  const ei = effectiveInformation(qWin);
  const windowBounds = { start_ms: win.start_ms, end_ms: win.end_ms };

  // 4. MAY-gates (before the existence gate), in the accepted order
  // 4a. unacceptable_missingness — qualifying < 1/2 of raw window records
  const rawInWindow = events.filter(e =>
    typeof e.timestamp === 'number' && e.timestamp >= win.start_ms && e.timestamp <= win.end_ms).length;
  if (qWin.length * 2 < rawInWindow) {
    return {
      state: OUTPUT_STATES.NO_INSTRUMENT,
      reason_code: REASON_CODES.unacceptable_missingness,
      evidence: {
        window: windowBounds, effective_information: ei,
        qualifying: qWin.length, raw_window_records: rawInWindow,
      },
    };
  }
  // 4b. no_nontrivial_parameter — zero value spread
  let vMin = win.values[0];
  let vMax = win.values[0];
  for (const v of win.values) { if (v < vMin) vMin = v; if (v > vMax) vMax = v; }
  if (vMin === vMax) {
    return {
      state: OUTPUT_STATES.NO_INSTRUMENT,
      reason_code: REASON_CODES.no_nontrivial_parameter,
      evidence: { window: windowBounds, effective_information: ei },
    };
  }

  // 5. existence gate
  const n = win.n;
  const bound_value = existenceBound(n, p);
  const n_star = existenceMinN(p, ALPHA);
  if (!(bound_value <= ALPHA_FLOAT)) {
    return {
      state: OUTPUT_STATES.NO_INSTRUMENT,
      reason_code: REASON_CODES.insufficient_history,
      evidence: {
        gate_id: GATE_ID, n, p: pStr, alpha: ALPHA_STR, bound_value,
        window: windowBounds, effective_information: ei,
      },
      reconsideration: { needed_n: n_star, condition: RECONSIDER_CONDITION },
    };
  }

  // 6. HF-1 estimate (order statistic over the ascending-sorted window values)
  const sorted = win.values.slice().sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const value = hf1Quantile(sorted, p);

  // 7. order-statistic uncertainty
  const ranks = orderStatCIRanks(n, p, ALPHA);
  const lo = sorted[ranks.l - 1];
  const hi = sorted[ranks.u - 1];

  // 8. ParameterRecord v0
  const record = {
    name: 'threshold',
    value,
    units: UNITS,
    origin: 'derived',
    derivation: {
      algorithm_id: ALGORITHM_ID,
      algorithm_version: ALGORITHM_VERSION,
      quantile_definition: QUANTILE_DEFINITION,
      p: pStr,
      input_window: { start_ms: win.start_ms, end_ms: win.end_ms, n_obs: win.n },
      effective_information: ei,
      quantization: { grid: 'identity/order-statistic', mode: 'none' },
    },
    uncertainty: {
      kind: 'interval',
      lo,
      hi,
      method: CI_METHOD,
      coverage_model: COVERAGE_MODEL,
      alpha: ALPHA_STR,
      ranks,
    },
    evidence: {
      ei_gate: { gate_id: GATE_ID, passed: true, bound_value, alpha: ALPHA_STR, n_star },
    },
  };

  // record constructor invariant: cannot emit a bare number (DR-5 spec error)
  if (!record.uncertainty || !record.derivation.effective_information) {
    throw new Error('deriveThresholdParameter: incomplete ParameterRecord (uncertainty / effective_information missing) — DR-5 specification error');
  }

  return { state: OUTPUT_STATES.RANKED_CANDIDATES, record };
}
