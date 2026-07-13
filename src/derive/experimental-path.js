/**
 * src/derive/experimental-path.js
 *
 * Fail-closed experimental-option parsing and the zero-match orchestration
 * helper (Cycle-004 FR-3; SDD DR-3). The only derivation module `src/index.js`
 * newly imports. Default-OFF: absent / null / `{}` / `{derivation:false}` all
 * normalize to OFF (null). When ON, unknown keys throw, `p` must match the
 * DR-6 grammar, and the window integer constraints are enforced.
 *
 * @module derive/experimental-path
 */

import { parseDecimalRational, existenceMinN } from './quantile.js';
import { deriveThresholdParameter } from './kernel.js';
import { buildFallbackProposal } from './fallback-rule.js';
import { OUTPUT_STATES } from './reason-codes.js';

const ALPHA = { num: 5, den: 100 }; // α = 0.05, non-configurable
const DEFAULT_P = '0.95';
const DEFAULT_MIN_DAYS = 90;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Parse the `experimental` option (fail-closed, DR-3). Returns a normalized
 * derivation config when ON, or `null` when OFF. Throws on any invalid ON shape.
 *
 * @param {Object} options - the full `analyze()` options object
 * @returns {{p:string, pRational:{num:number,den:number}, alpha:{num:number,den:number}, min_days:number, n_min:number}|null}
 */
export function parseExperimentalOptions(options) {
  const exp = options ? options.experimental : undefined;
  if (exp === undefined || exp === null) return null;                        // OFF
  if (!isPlainObject(exp)) throw new TypeError('experimental must be null or a plain object');
  for (const k of Object.keys(exp)) {
    if (k !== 'derivation') throw new Error(`unknown experimental key: ${k}`);
  }
  const der = exp.derivation;
  if (der === undefined || der === false) return null;                       // OFF
  if (der === true) return normalizeDerivation({});                          // ON — spec defaults
  if (!isPlainObject(der)) throw new TypeError('experimental.derivation must be a boolean or a plain object');
  for (const k of Object.keys(der)) {
    if (k !== 'p' && k !== 'window') throw new Error(`unknown derivation key: ${k}`);
  }
  return normalizeDerivation(der);
}

function normalizeDerivation(der) {
  const pStr = der.p === undefined ? DEFAULT_P : der.p;
  const pRational = parseDecimalRational(pStr); // throws on bad format / out of range (DR-6)

  let min_days = DEFAULT_MIN_DAYS;
  let n_min;
  const w = der.window;
  if (w !== undefined) {
    if (!isPlainObject(w)) throw new TypeError('experimental.derivation.window must be a plain object');
    for (const k of Object.keys(w)) {
      if (k !== 'min_days' && k !== 'n_min') throw new Error(`unknown window key: ${k}`);
    }
    if (w.min_days !== undefined) {
      if (!Number.isInteger(w.min_days) || w.min_days < 1) throw new Error(`min_days must be an integer ≥ 1, got ${w.min_days}`);
      min_days = w.min_days;
    }
    if (w.n_min !== undefined) {
      if (!Number.isInteger(w.n_min) || w.n_min < 2) throw new Error(`n_min must be an integer ≥ 2, got ${w.n_min}`);
      n_min = w.n_min;
    }
  }
  if (n_min === undefined) n_min = existenceMinN(pRational, ALPHA); // default = existence minimum

  return { p: pStr, pRational, alpha: ALPHA, min_days, n_min };
}

/**
 * Run the experimental derivation and return the DR-3 result surface. Called
 * only after both fences pass (ON, and zero authored proposals). `now` is the
 * deterministic window end (required when ON).
 *
 * @param {{events:Array, config:Object, now:number}} args
 * @returns {{state:string, record?:Object, proposal?:Object, rejection?:Object}}
 */
export function runExperimentalDerivation({ events, config, now }) {
  const kernelConfig = { p: config.p, now, window: { min_days: config.min_days, n_min: config.n_min } };
  const result = deriveThresholdParameter(events, kernelConfig);
  if (result.state === OUTPUT_STATES.RANKED_CANDIDATES) {
    return { state: OUTPUT_STATES.RANKED_CANDIDATES, record: result.record, proposal: buildFallbackProposal(result.record) };
  }
  return { state: OUTPUT_STATES.NO_INSTRUMENT, rejection: result };
}
