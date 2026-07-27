/**
 * lab/survey/derive-constants.js
 *
 * Cycle-006 S01 LU-1 (PRD UD-C6-8, NFR-C6-RUNTIME, AC-C8; SDD DR-3.1–3.4; Sprint Plan
 * T1.3). The CI-line re-derivation harness: a READ-ONLY measurement script that runs on
 * the CI node line and reports the four constant families the pool-entry criteria will
 * later be derived from.
 *
 * ── What this module is NOT ──────────────────────────────────────────────────────
 *
 * It authors no criterion, fixes no numeric constant, names no candidate, and contacts
 * nothing. It performs **no filesystem write of any kind** — there is no fs import in
 * this file — so it cannot produce a repository artifact by construction; the dispatch
 * workflow redirects stdout into the job workspace and uploads that as a per-leg
 * artifact. A LOCAL run is ADVISORY ONLY (§2 fact 13: local Node 25 is above the
 * supported CI ceiling); binding values exist only after {@link aggregateLegs} combines
 * the four landed CI legs, which is T1.7's post-landing act, not LU-1's.
 *
 * ── Aggregation (DR-3.3, binding) ────────────────────────────────────────────────
 *
 * Every CEILING-type constant aggregates by **MIN** across the four legs; every
 * COST-type constant by **MAX** (the slowest leg). Always the conservative direction.
 *
 * ── Fences (DR-4.7) ──────────────────────────────────────────────────────────────
 *
 * `lab/survey/` is a fourth lab lane and is NOT an apparatus namespace. It imports
 * nothing from `lab/acquisition`, `lab/driver`, or `lab/resolution`; it references no
 * networking or subprocess API; and it names no scientific-ledger token. The frozen
 * modules below are imported READ-ONLY for measurement, exactly as DR-3.2 specifies.
 *
 * @module lab/survey/derive-constants
 */

import { performance } from 'node:perf_hooks';

import { classify } from '../../src/classifier/feed-grammar.js';
import { existenceBound, parseDecimalRational } from '../../src/derive/quantile.js';
import { DAY_MS, H_MS, PURGE_GAP_MS, TAIL_DIVISOR, computeSchedule } from '../harness/walk-forward.js';
import { applySelectionRule } from '../census/selection-rule.js';

/** The frozen experimental parameters every derivation is expressed over (DR-3.4). */
export const FROZEN_INPUTS = Object.freeze({
  W_days: 90,
  n_min: 59,
  H_days: 30,
  P: 'H',
  gate3_min_years: 3,
  gate3_min_n: 10000,
  alpha: '0.05',
  existence_margin: 'alpha/3',
});

/**
 * The cadence sweep the break-even table is computed over, in seconds per observation.
 * These are STRUCTURAL measurement inputs, not criteria: no cadence class, band, or
 * admissibility rule is authored here — Gate P fixes those (I-1, C6-FR-N4/P6).
 */
export const CADENCE_SWEEP_SECONDS = Object.freeze([60, 300, 900, 3600, 21600, 86400]);

const SECONDS_PER_DAY = 86400;

/** Constant registry: every measured constant with its aggregation direction + formula. */
export const CONSTANT_SPECS = Object.freeze([
  { constant_id: 'classifier_input_ceiling_n_ci', kind: 'ceiling', direction: 'min', formula: 'max input length for which classify() completes at the default stack (binary search)' },
  { constant_id: 'max_slice_fraction', kind: 'ceiling', direction: 'min', formula: '(0.8·span − H − P)/span, verified empirically against computeSchedule() training cutoffs' },
  ...CADENCE_SWEEP_SECONDS.map(sec => ({
    constant_id: `cadence_break_even_days_c${sec}`,
    kind: 'ceiling',
    direction: 'min',
    formula: `T_max(c) = N_ci / (obs_per_day(c) · max_slice_fraction), obs_per_day = 86400/${sec}`,
  })),
  { constant_id: 'existence_bound_ms_per_1e6_n', kind: 'cost', direction: 'max', formula: 'wall-clock slope of existenceBound(n, "0.90") in ms per 10^6 n (two-point, median of repeats)' },
  { constant_id: 'single_candidate_probe_ms', kind: 'cost', direction: 'max', formula: 'wall clock of applySelectionRule([candidate], burnedList), median of repeats' },
  { constant_id: 'definitional_enumeration_branch_ms', kind: 'cost', direction: 'max', formula: 'wall clock of one 2^k enumeration branch = applySelectionRule(k candidates, burnedList), median of repeats' },
]);

const SPEC_BY_ID = new Map(CONSTANT_SPECS.map(s => [s.constant_id, s]));

/** The four CI legs the binding aggregation requires (DR-3.1 matrix). */
export const REQUIRED_LEGS = Object.freeze([
  { os: 'ubuntu-latest', node_major: 20 },
  { os: 'ubuntu-latest', node_major: 24 },
  { os: 'windows-latest', node_major: 20 },
  { os: 'windows-latest', node_major: 24 },
]);

// ── Measurement helpers ────────────────────────────────────────────────────────

/** A deterministic synthetic series — no randomness, no fixture file, no network. */
export function syntheticSeries(n, { startMs = Date.UTC(2015, 0, 1), stepMs = 60_000 } = {}) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = { timestamp: startMs + i * stepMs, value: (i % 97) + 1, metadata: {} };
  return out;
}

function median(values) {
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** An eligible aggregate-metadata candidate for the frozen-rule probes. */
function probeCandidate(rank, { n_observations = FROZEN_INPUTS.gate3_min_n } = {}) {
  const provider = `PROBE-${rank}`;
  const product = `series-${rank}`;
  return {
    rank,
    provider,
    product,
    metadata: {
      provider, product,
      n_observations, history_years: 100, span: null, cadence: 'h',
      authority_published: true, public: true, machine_readable: true, free: true,
      exogeneity_judgment: 'structural measurement probe', exogenous: true,
      mechanical_outcome_declared: true, revision_vintage_documented: true,
    },
  };
}

/**
 * (a) Classifier input ceiling `N_ci` (DR-3.2a): the largest synthetic-series length
 * for which the frozen `classify()` completes at the DEFAULT stack. Exponential probe
 * to the first failure, then binary search. Ceiling-type ⇒ aggregates by MIN.
 */
export function measureClassifierCeiling({ cap = 1 << 21, start = 1024 } = {}) {
  const ok = (n) => { try { classify(syntheticSeries(n)); return true; } catch { return false; } };
  let lo = 0;
  let hi = 0;
  for (let n = start; n <= cap; n *= 2) {
    if (ok(n)) lo = n; else { hi = n; break; }
  }
  if (lo === 0) return { value: 0, saturated: false, cap, note: 'classify() failed at the smallest probe' };
  if (hi === 0) return { value: lo, saturated: true, cap, note: 'no ceiling below the probe cap — the reported value is the cap, not a measured ceiling' };
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) lo = mid; else hi = mid;
  }
  return { value: lo, saturated: false, cap, note: null };
}

/**
 * (b) Max-slice fraction (DR-3.2b): the analytical locked-tail bound
 * `(0.8·span − H − P)/span`, EMPIRICALLY confirmed against the training cutoffs the
 * frozen `computeSchedule()` actually keeps. Ceiling-type ⇒ aggregates by MIN.
 */
export function measureMaxSliceFraction({ years = 10 } = {}) {
  const tMin = Date.UTC(2010, 0, 1);
  const tMax = tMin + Math.round(years * 365.25 * DAY_MS);
  const span = tMax - tMin;
  const analytical = (span - Math.floor(span / TAIL_DIVISOR) - H_MS - PURGE_GAP_MS) / span;

  const schedule = computeSchedule({ tMin, tMax, minDays: FROZEN_INPUTS.W_days });
  let empirical = 0;
  for (const origin of schedule.kept) empirical = Math.max(empirical, (origin.training_cutoff_ms - tMin) / span);

  return {
    value: empirical,
    analytical,
    empirical,
    within_analytical_bound: empirical <= analytical,
    origins_kept: schedule.kept.length,
    span_ms: span,
  };
}

/**
 * (c) Cadence break-even table (DR-3.2c): `T_max(c) = N_ci / (obs_per_day(c) ·
 * max_slice_fraction)` in days — computed, never chosen. Ceiling-type ⇒ MIN.
 */
export function measureCadenceBreakEven({ n_ci, max_slice_fraction }) {
  if (!(n_ci > 0) || !(max_slice_fraction > 0)) throw new Error('measureCadenceBreakEven: n_ci and max_slice_fraction must be positive');
  return CADENCE_SWEEP_SECONDS.map(cadence_seconds => {
    const obs_per_day = SECONDS_PER_DAY / cadence_seconds;
    return {
      constant_id: `cadence_break_even_days_c${cadence_seconds}`,
      cadence_seconds,
      obs_per_day,
      t_max_days: n_ci / (obs_per_day * max_slice_fraction),
    };
  });
}

/**
 * (d) FR-D2 cost constants (DR-3.2d): the `existenceBound` wall-clock slope, the
 * single-candidate probe overhead, and the definitional-enumeration branch cost —
 * the inputs to `n_ceiling`, the probe budget, and the corroboration budget (DR-8.6).
 * Cost-type ⇒ aggregates by MAX (slowest leg).
 */
export function measureFrD2Costs({ repeats = 5, k = 4 } = {}) {
  const p = parseDecimalRational('0.90');
  const timeOf = (fn) => { const t0 = performance.now(); fn(); return performance.now() - t0; };

  const nLow = 200_000;
  const nHigh = 1_000_000;
  const tLow = median(Array.from({ length: repeats }, () => timeOf(() => existenceBound(nLow, p))));
  const tHigh = median(Array.from({ length: repeats }, () => timeOf(() => existenceBound(nHigh, p))));
  const existence_bound_ms_per_1e6_n = (tHigh - tLow) / ((nHigh - nLow) / 1e6);

  const burnedList = { entries: [] };
  const one = [probeCandidate(1)];
  const single_candidate_probe_ms = median(Array.from({ length: repeats }, () => timeOf(() => applySelectionRule(one, burnedList))));

  const branch = Array.from({ length: k }, (_, i) => probeCandidate(i + 1));
  const definitional_enumeration_branch_ms = median(Array.from({ length: repeats }, () => timeOf(() => applySelectionRule(branch, burnedList))));

  return {
    existence_bound_ms_per_1e6_n,
    single_candidate_probe_ms,
    definitional_enumeration_branch_ms,
    probe_points: { n_low: nLow, n_high: nHigh, repeats, k },
  };
}

// ── Leg record and binding aggregation ─────────────────────────────────────────

/** Node major version of the running interpreter. */
function nodeMajor(version = process.version) { return Number.parseInt(String(version).replace(/^v/, '').split('.')[0], 10); }

/**
 * Run every measurement on THIS node and return one leg record. Pure with respect to
 * the filesystem and the network: it computes and returns, and writes nothing.
 *
 * @returns {Object} a `ci-line-derivation-leg` record
 */
export function deriveLeg({ os = process.platform, node_version = process.version, measured_at = new Date().toISOString() } = {}) {
  const ceiling = measureClassifierCeiling();
  const slice = measureMaxSliceFraction();
  const cadence = measureCadenceBreakEven({ n_ci: ceiling.value, max_slice_fraction: slice.value });
  const costs = measureFrD2Costs();

  const measurements = {
    classifier_input_ceiling_n_ci: ceiling.value,
    max_slice_fraction: slice.value,
    existence_bound_ms_per_1e6_n: costs.existence_bound_ms_per_1e6_n,
    single_candidate_probe_ms: costs.single_candidate_probe_ms,
    definitional_enumeration_branch_ms: costs.definitional_enumeration_branch_ms,
  };
  for (const row of cadence) measurements[row.constant_id] = row.t_max_days;

  return {
    record_kind: 'ci-line-derivation-leg',
    schema_version: '1.0.0',
    cycle: 'cycle-006',
    leg: { os, node_version, node_major: nodeMajor(node_version), measured_at },
    frozen_inputs: FROZEN_INPUTS,
    measurements,
    detail: { classifier_ceiling: ceiling, max_slice: slice, cadence_table: cadence, fr_d2_costs: costs },
    binding: false,
    advisory_note: 'ADVISORY unless produced by the landed dispatch-only ci-line-derivations workflow; binding values require all four CI legs (DR-3.3).',
  };
}

/**
 * Aggregate four landed CI legs into the `criteria-derivations.json` provenance
 * document (DR-3.3/3.4). CEILING-type constants take the **MIN** across legs;
 * COST-type the **MAX**. Fail-closed: refuses unless all four required legs are
 * present and every leg reports every constant.
 *
 * This RETURNS the document. Nothing here writes it — the tracked artifact is
 * authored in LU-2A, after the four-leg dispatch (T1.7).
 *
 * @param {Object[]} legRecords - four leg records, each with `provenance` attached
 * @param {{advisory_local_values?: Object}} [opts]
 * @returns {Object}
 */
export function aggregateLegs(legRecords, { advisory_local_values = {} } = {}) {
  if (!Array.isArray(legRecords) || legRecords.length !== REQUIRED_LEGS.length) {
    throw new Error(`aggregateLegs: expected exactly ${REQUIRED_LEGS.length} legs, got ${Array.isArray(legRecords) ? legRecords.length : typeof legRecords}`);
  }
  for (const required of REQUIRED_LEGS) {
    const found = legRecords.filter(l => l.leg?.os === required.os && l.leg?.node_major === required.node_major);
    if (found.length !== 1) throw new Error(`aggregateLegs: expected exactly one ${required.os} / node ${required.node_major} leg, found ${found.length}`);
  }
  for (const leg of legRecords) {
    for (const field of ['workflow_run_url', 'run_id', 'commit_sha']) {
      if (!leg.provenance || typeof leg.provenance[field] !== 'string' || leg.provenance[field].length === 0) {
        throw new Error(`aggregateLegs: leg ${leg.leg?.os}/${leg.leg?.node_major} is missing provenance.${field} — a binding value requires CI-line provenance (AC-C8)`);
      }
    }
  }

  const constants = CONSTANT_SPECS.map(spec => {
    const legs = legRecords.map(l => {
      const raw_value = l.measurements?.[spec.constant_id];
      if (typeof raw_value !== 'number' || !Number.isFinite(raw_value)) {
        throw new Error(`aggregateLegs: leg ${l.leg?.os}/${l.leg?.node_major} has no finite value for "${spec.constant_id}"`);
      }
      return {
        os: l.leg.os,
        node_version: l.leg.node_version,
        workflow_run_url: l.provenance.workflow_run_url,
        run_id: l.provenance.run_id,
        commit_sha: l.provenance.commit_sha,
        raw_value,
        measured_at: l.leg.measured_at,
      };
    });
    const values = legs.map(l => l.raw_value);
    return {
      constant_id: spec.constant_id,
      binding_value: spec.direction === 'min' ? Math.min(...values) : Math.max(...values),
      direction: spec.direction,
      legs,
      formula: spec.formula,
      frozen_inputs: FROZEN_INPUTS,
      advisory_local_values: advisory_local_values[spec.constant_id] ?? [],
    };
  });

  return { record_kind: 'criteria-derivations', schema_version: '1.0.0', cycle: 'cycle-006', constants };
}

/**
 * AC-C8 completeness check: every numeric constant in a digest-fixed derivation
 * document carries a `legs[]` block naming all four CI legs, and its `binding_value`
 * equals the conservative aggregation of those legs. PURE.
 *
 * @returns {{valid:boolean, problems:string[]}}
 */
export function validateDerivationProvenance(doc) {
  const problems = [];
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.constants)) {
    return { valid: false, problems: ['derivation document must carry a constants[] array'] };
  }
  for (const c of doc.constants) {
    const spec = SPEC_BY_ID.get(c.constant_id);
    const at = `constant "${c.constant_id}"`;
    if (!spec) { problems.push(`${at}: not in the constant registry`); continue; }
    if (c.direction !== spec.direction) problems.push(`${at}: direction must be "${spec.direction}"`);
    if (typeof c.formula !== 'string' || c.formula.length === 0) problems.push(`${at}: missing formula`);
    if (!c.frozen_inputs || typeof c.frozen_inputs !== 'object') problems.push(`${at}: missing frozen_inputs`);
    if (!Array.isArray(c.advisory_local_values)) problems.push(`${at}: advisory_local_values must be an array`);
    if (!Array.isArray(c.legs) || c.legs.length !== REQUIRED_LEGS.length) {
      problems.push(`${at}: requires exactly ${REQUIRED_LEGS.length} CI legs, got ${Array.isArray(c.legs) ? c.legs.length : 'none'}`);
      continue;
    }
    for (const required of REQUIRED_LEGS) {
      const hit = c.legs.filter(l => l.os === required.os && nodeMajor(l.node_version) === required.node_major);
      if (hit.length !== 1) problems.push(`${at}: missing or duplicated leg ${required.os} / node ${required.node_major}`);
    }
    for (const l of c.legs) {
      for (const field of ['workflow_run_url', 'run_id', 'commit_sha']) {
        if (typeof l[field] !== 'string' || l[field].length === 0) problems.push(`${at}: leg ${l.os}/${l.node_version} missing ${field}`);
      }
      if (typeof l.raw_value !== 'number' || !Number.isFinite(l.raw_value)) problems.push(`${at}: leg ${l.os}/${l.node_version} has no finite raw_value`);
    }
    const values = c.legs.map(l => l.raw_value).filter(v => typeof v === 'number' && Number.isFinite(v));
    if (values.length === c.legs.length) {
      const expected = spec.direction === 'min' ? Math.min(...values) : Math.max(...values);
      if (c.binding_value !== expected) problems.push(`${at}: binding_value ${c.binding_value} is not the conservative ${spec.direction} of the legs (${expected})`);
    }
  }
  return { valid: problems.length === 0, problems };
}

// Executed as a script by the dispatch-only workflow: emit ONE leg record on stdout.
// The workflow redirects stdout into the job workspace; this module never writes a file.
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url === new URL(`file:///${String(process.argv[1]).replace(/\\/g, '/')}`).href) {
  process.stdout.write(JSON.stringify(deriveLeg(), null, 2) + '\n');
}
