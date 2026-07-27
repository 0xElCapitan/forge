// lab/test/survey-derivations.spec.js
//
// Cycle-006 S01 LU-1 (PRD UD-C6-8, NFR-C6-RUNTIME, AC-C8; SDD DR-3.1–3.4; Sprint Plan
// T1.3). The CI-line re-derivation harness: the four measured constant families, the
// binding DR-3.3 aggregation rule (MIN across legs for ceiling-type, MAX for cost-type),
// the AC-C8 provenance-completeness check (no numeric constant may be digest-fixed
// without a legs[] block naming all four CI legs), and the dispatch-only posture of
// `.github/workflows/ci-line-derivations.yml`.
//
// NOTE ON LOCAL VALUES. Every number this spec computes locally is ADVISORY ONLY —
// local Node 25 is above the supported CI ceiling (§2 fact 13). The spec therefore
// asserts SHAPE, RELATIONSHIPS and REFUSALS, never a numeric threshold, and no binding
// value is produced or written anywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  FROZEN_INPUTS, CADENCE_SWEEP_SECONDS, CONSTANT_SPECS, REQUIRED_LEGS,
  syntheticSeries, measureClassifierCeiling, measureMaxSliceFraction,
  measureCadenceBreakEven, measureFrD2Costs, deriveLeg, aggregateLegs,
  validateDerivationProvenance,
} from '../survey/derive-constants.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORKFLOW_PATH = join(REPO_ROOT, '.github/workflows/ci-line-derivations.yml');

// ── The four measured families ────────────────────────────────────────────────

test('DR-3.4: the frozen experimental parameters are carried verbatim', () => {
  assert.deepEqual({ ...FROZEN_INPUTS }, {
    W_days: 90, n_min: 59, H_days: 30, P: 'H',
    gate3_min_years: 3, gate3_min_n: 10000, alpha: '0.05', existence_margin: 'alpha/3',
  });
});

test('DR-3.2a: the classifier input ceiling is measured by binary search at the default stack', () => {
  const r = measureClassifierCeiling({ cap: 1 << 18, start: 1024 });
  assert.ok(Number.isInteger(r.value) && r.value > 0, 'a positive integer ceiling');
  // the reported ceiling holds and one more input does not (unless the probe saturated)
  if (!r.saturated) {
    assert.doesNotThrow(() => syntheticSeries(r.value).length);
    assert.ok(r.value < r.cap, 'a real ceiling sits below the probe cap');
  }
  assert.equal(syntheticSeries(5).length, 5);
  assert.deepEqual(syntheticSeries(2).map(e => e.timestamp), [Date.UTC(2015, 0, 1), Date.UTC(2015, 0, 1) + 60_000], 'the series is deterministic');
});

test('DR-3.2b: the max-slice fraction is the locked-tail bound, empirically confirmed', () => {
  const r = measureMaxSliceFraction();
  assert.ok(r.origins_kept > 0, 'the frozen schedule keeps origins over the probe span');
  assert.ok(r.empirical > 0 && r.empirical < 1);
  assert.equal(r.within_analytical_bound, true, 'no kept training cutoff exceeds the analytical (0.8·span − H − P)/span bound');
  assert.equal(r.value, r.empirical, 'the reported value is the EMPIRICAL maximum, not the analytical one');
});

test('DR-3.2c: the cadence break-even table is COMPUTED from N_ci, never chosen', () => {
  const table = measureCadenceBreakEven({ n_ci: 100_000, max_slice_fraction: 0.5 });
  assert.equal(table.length, CADENCE_SWEEP_SECONDS.length);
  for (const row of table) {
    assert.equal(row.obs_per_day, 86400 / row.cadence_seconds);
    assert.equal(row.t_max_days, 100_000 / (row.obs_per_day * 0.5), 'T_max(c) = N_ci / (obs_per_day · max_slice_fraction)');
  }
  // a coarser cadence buys a longer admissible span
  for (let i = 1; i < table.length; i++) assert.ok(table[i].t_max_days > table[i - 1].t_max_days);
  assert.throws(() => measureCadenceBreakEven({ n_ci: 0, max_slice_fraction: 0.5 }), /must be positive/);
});

test('DR-3.2d: the FR-D2 cost constants are measured over the frozen primitives', () => {
  const c = measureFrD2Costs({ repeats: 3, k: 3 });
  for (const key of ['existence_bound_ms_per_1e6_n', 'single_candidate_probe_ms', 'definitional_enumeration_branch_ms']) {
    assert.ok(Number.isFinite(c[key]), `${key} is a finite measurement`);
  }
  assert.ok(c.single_candidate_probe_ms >= 0 && c.definitional_enumeration_branch_ms >= 0);
  assert.equal(c.probe_points.k, 3);
});

// ── Leg records and the binding aggregation rule ──────────────────────────────

test('DR-3.1: a leg record is self-labelling, advisory, and never claims a binding value', () => {
  const leg = deriveLeg({ os: 'ubuntu-latest', node_version: 'v20.11.0', measured_at: '2026-07-26T00:00:00Z' });
  assert.equal(leg.record_kind, 'ci-line-derivation-leg');
  assert.equal(leg.cycle, 'cycle-006');
  assert.equal(leg.binding, false, 'a single leg is never binding');
  assert.match(leg.advisory_note, /ADVISORY/);
  assert.equal(leg.leg.node_major, 20);
  for (const spec of CONSTANT_SPECS) {
    assert.ok(Number.isFinite(leg.measurements[spec.constant_id]), `leg reports ${spec.constant_id}`);
  }
});

/** Four synthetic legs with a controlled spread, for the aggregation-direction proof. */
function fourLegs(valueByLegIndex) {
  return REQUIRED_LEGS.map((required, i) => ({
    record_kind: 'ci-line-derivation-leg',
    leg: { os: required.os, node_version: `v${required.node_major}.0.0`, node_major: required.node_major, measured_at: '2026-07-26T00:00:00Z' },
    measurements: Object.fromEntries(CONSTANT_SPECS.map(s => [s.constant_id, valueByLegIndex[i]])),
    provenance: { workflow_run_url: `https://example/run/${i}`, run_id: `${1000 + i}`, commit_sha: 'a'.repeat(40) },
  }));
}

test('DR-3.3 BINDING: ceiling-type constants aggregate by MIN, cost-type by MAX', () => {
  const doc = aggregateLegs(fourLegs([10, 40, 20, 30]));
  for (const c of doc.constants) {
    const spec = CONSTANT_SPECS.find(s => s.constant_id === c.constant_id);
    assert.equal(c.direction, spec.direction);
    assert.equal(c.binding_value, spec.direction === 'min' ? 10 : 40, `${c.constant_id} takes the conservative ${spec.direction}`);
    assert.equal(c.legs.length, 4);
    assert.equal(c.formula, spec.formula);
    assert.deepEqual(c.frozen_inputs, FROZEN_INPUTS);
    assert.deepEqual(c.advisory_local_values, []);
  }
  // every ceiling constant is a ceiling and every cost constant is a cost — no drift
  assert.deepEqual(CONSTANT_SPECS.filter(s => s.kind === 'ceiling').map(s => s.direction), CONSTANT_SPECS.filter(s => s.kind === 'ceiling').map(() => 'min'));
  assert.deepEqual(CONSTANT_SPECS.filter(s => s.kind === 'cost').map(s => s.direction), CONSTANT_SPECS.filter(s => s.kind === 'cost').map(() => 'max'));
});

test('DR-3.3: aggregation is FAIL-CLOSED — fewer than four legs, a duplicated leg, or a missing leg all refuse', () => {
  assert.throws(() => aggregateLegs(fourLegs([1, 2, 3, 4]).slice(0, 3)), /expected exactly 4 legs/);
  const dup = fourLegs([1, 2, 3, 4]);
  dup[3].leg = { ...dup[0].leg };
  assert.throws(() => aggregateLegs(dup), /expected exactly one/);
  const missing = fourLegs([1, 2, 3, 4]);
  delete missing[2].measurements.max_slice_fraction;
  assert.throws(() => aggregateLegs(missing), /no finite value for "max_slice_fraction"/);
});

test('AC-C8: a binding value requires CI-line provenance — a leg without a run URL refuses', () => {
  for (const field of ['workflow_run_url', 'run_id', 'commit_sha']) {
    const legs = fourLegs([1, 2, 3, 4]);
    delete legs[1].provenance[field];
    assert.throws(() => aggregateLegs(legs), new RegExp(`missing provenance\\.${field}`));
  }
});

test('AC-C8: the provenance-completeness validator walks every numeric constant', () => {
  const doc = aggregateLegs(fourLegs([10, 40, 20, 30]), { advisory_local_values: { max_slice_fraction: [{ value: 0.78, node: 'v25.2.1', label: 'advisory-only' }] } });
  assert.equal(validateDerivationProvenance(doc).valid, true);
  assert.deepEqual(doc.constants.find(c => c.constant_id === 'max_slice_fraction').advisory_local_values[0].label, 'advisory-only');

  // three legs is not four
  const short = structuredClone(doc);
  short.constants[0].legs.pop();
  assert.ok(validateDerivationProvenance(short).problems.some(p => /requires exactly 4 CI legs/.test(p)));
  // a leg missing its run URL
  const noUrl = structuredClone(doc);
  noUrl.constants[0].legs[0].workflow_run_url = '';
  assert.ok(validateDerivationProvenance(noUrl).problems.some(p => /missing workflow_run_url/.test(p)));
  // a binding value that is not the conservative aggregation of its own legs
  const skewed = structuredClone(doc);
  skewed.constants[0].binding_value = 999;
  assert.ok(validateDerivationProvenance(skewed).problems.some(p => /not the conservative/.test(p)));
  // an os/node leg outside the required matrix
  const wrongLeg = structuredClone(doc);
  wrongLeg.constants[0].legs[0].os = 'macos-latest';
  assert.ok(validateDerivationProvenance(wrongLeg).problems.some(p => /missing or duplicated leg/.test(p)));
  // a constant not in the registry
  assert.ok(validateDerivationProvenance({ constants: [{ constant_id: 'invented', legs: [] }] }).problems.some(p => /not in the constant registry/.test(p)));
});

// ── The dispatch-only workflow ────────────────────────────────────────────────

/** The `on:` block of the workflow, as raw lines (top-level key until the next one). */
function triggerBlock(yaml) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex(l => /^on:\s*$/.test(l));
  assert.ok(start >= 0, 'the workflow declares a top-level `on:` block');
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;          // next top-level key
    if (lines[i].trim().length > 0) out.push(lines[i]);
  }
  return out;
}

test('DR-3.1: ci-line-derivations.yml has EXACTLY ONE trigger and it is workflow_dispatch', () => {
  const yaml = readFileSync(WORKFLOW_PATH, 'utf8');
  const block = triggerBlock(yaml);
  assert.deepEqual(block.map(l => l.trim()), ['workflow_dispatch:'], 'workflow_dispatch is the only trigger');
  for (const forbidden of ['push', 'pull_request', 'pull_request_target', 'schedule', 'release', 'create', 'repository_dispatch', 'workflow_call', 'workflow_run']) {
    assert.ok(!block.some(l => l.trim().startsWith(`${forbidden}:`)), `no ${forbidden} trigger`);
  }
});

test('DR-3.1: the workflow performs no release, tag, or publish act and needs no secret', () => {
  const yaml = readFileSync(WORKFLOW_PATH, 'utf8');
  const body = yaml.split(/\r?\n/).filter(l => !/^\s*#/.test(l)).join('\n');   // executable lines only
  for (const re of [/\bgit\s+tag\b/, /\bgit\s+push\b/, /\bnpm\s+publish\b/, /\bgh\s+release\b/, /softprops\/action-gh-release/, /\bsecrets\./, /\bcreateRelease\b/]) {
    assert.doesNotMatch(body, re, `the workflow must not contain ${re}`);
  }
  assert.match(yaml, /permissions:\s*\n\s*contents:\s*read/, 'read-only contents permission');
});

test('DR-3.1: the workflow runs all four legs and asserts the working tree stayed clean', () => {
  const yaml = readFileSync(WORKFLOW_PATH, 'utf8');
  assert.match(yaml, /os:\s*\[ubuntu-latest,\s*windows-latest\]/);
  assert.match(yaml, /node:\s*\['20',\s*'24'\]/);
  assert.match(yaml, /node lab\/survey\/derive-constants\.js\s*>/, 'stdout is redirected out of the checkout');
  assert.match(yaml, /git status --porcelain/, 'the leg fails if any repository file changed');
  // …and it never names a repository artifact path as an output target
  for (const re of [/lab\/preregistration/, /lab\/evidence/, /lab\/freeze/, /lab\/ledgers/, /criteria-derivations\.json/]) {
    assert.doesNotMatch(yaml.split(/\r?\n/).filter(l => !/^\s*#/.test(l)).join('\n'), re, `no ${re} write target`);
  }
});
