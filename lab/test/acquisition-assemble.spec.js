// lab/test/acquisition-assemble.spec.js
//
// Cycle-005 S01 (PRD FR-A1/FR-A6, FR-C2; SDD DR-4.4, DR-8; Sprint Plan T1.8). The
// exact-14-field census-input assembler (unknown/missing-field refusal; the DR-4.4
// filename rule; DR-8 authored-input injection; canonical bytes) and the FR-A6
// classify() logic (class i/ii/iii/iv; only i and accepted-ii are lawful gate inputs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assembleCandidate, assertExactFieldSet, metadataFilename, writeCandidateMetadata, EXPECTED_FIELDS, AssemblyRefusal, slugify } from '../acquisition/assemble.js';
import { classifyField, FR_A6 } from '../acquisition/classify.js';
import { canonicalize } from '../../src/receipt/canonicalize.js';

const authored = () => ({
  authority_published: true, public: true, machine_readable: true, free: true,
  exogeneity_judgment: 'physical measurement, exogenous', exogenous: true,
  mechanical_outcome_declared: true, revision_vintage_documented: true, cadence: '15-min',
});
const measured = () => ({ n_observations: 1200000, history_years: 34.2, span: { start_ms: 0, end_ms: 1 } });

test('DR-4.4: assembleCandidate produces EXACTLY the 14 census-input fields', () => {
  const obj = assembleCandidate({ rank: 1, provider: 'USGS', product: 'NWIS river stage/discharge', authored_inputs: authored(), measured: measured() });
  assert.deepEqual(Object.keys(obj).sort(), [...EXPECTED_FIELDS].sort());
  assert.equal(Object.keys(obj).length, 14);
});

test('DR-8: authored inputs are injected verbatim', () => {
  const a = authored();
  const obj = assembleCandidate({ rank: 1, provider: 'USGS', product: 'X', authored_inputs: a, measured: measured() });
  for (const f of ['authority_published', 'public', 'machine_readable', 'free', 'exogeneity_judgment', 'exogenous', 'mechanical_outcome_declared', 'revision_vintage_documented', 'cadence']) {
    assert.equal(obj[f], a[f], `${f} injected verbatim`);
  }
});

test('DR-4.4: an unresolved candidate (null n_observations) is REFUSED — no census-input file', () => {
  assert.throws(() => assembleCandidate({ rank: 1, provider: 'USGS', product: 'X', authored_inputs: authored(), measured: { n_observations: null, history_years: 10, span: null } }), AssemblyRefusal);
  assert.throws(() => assembleCandidate({ rank: 1, provider: 'USGS', product: 'X', authored_inputs: authored(), measured: { n_observations: 10000, history_years: null, span: null } }), AssemblyRefusal);
});

test('exact-field-set: an extra field is refused', () => {
  const obj = assembleCandidate({ rank: 1, provider: 'USGS', product: 'X', authored_inputs: authored(), measured: measured() });
  assert.throws(() => assertExactFieldSet({ ...obj, sneaky: 1 }), AssemblyRefusal);
});

test('DR-4.4 filename rule: the five frozen candidate names slug exactly', () => {
  assert.equal(metadataFilename(1, 'USGS', 'NWIS river stage/discharge'), 'rank-1-usgs-nwis-river-stage-discharge.json');
  assert.equal(metadataFilename(2, 'NOAA', 'CO-OPS coastal water level'), 'rank-2-noaa-co-ops-coastal-water-level.json');
  assert.equal(metadataFilename(3, 'NOAA', 'NDBC buoy significant wave height'), 'rank-3-noaa-ndbc-buoy-significant-wave-height.json');
  assert.equal(metadataFilename(4, 'NWS/ISD', 'station weather observations (temp/wind)'), 'rank-4-nws-isd-station-weather-observations-temp-wind.json');
  assert.equal(metadataFilename(5, 'EIA', 'hourly electricity demand'), 'rank-5-eia-hourly-electricity-demand.json');
  assert.equal(slugify('  NWS/ISD (temp/wind) '), 'nws-isd-temp-wind');
});

test('DR-10: writeCandidateMetadata writes canonical (sorted-key) bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c005-meta-'));
  const p = writeCandidateMetadata(dir, { rank: 1, provider: 'USGS', product: 'NWIS river stage/discharge', authored_inputs: authored(), measured: measured() });
  const bytes = readFileSync(p, 'utf8');
  const obj = JSON.parse(bytes);
  assert.equal(bytes, canonicalize(obj) + '\n', 'file bytes are canonical + LF');
  assert.ok(p.endsWith('rank-1-usgs-nwis-river-stage-discharge.json'));
});

test('FR-A6: class (i) exact and accepted class (ii) are gate-eligible; (iii)/(iv) are not', () => {
  assert.deepEqual(classifyField({ field: 'n_observations', value: 87600, intended_class: FR_A6.EXACT }), { classification: 'i', gate_eligible: true, effect_9_1: 'input-eligible', reason: 'n_observations: exact lawful measurement (FR-A6 i)' });
  // intended (ii) WITH operator acceptance → lawful
  assert.equal(classifyField({ field: 'history_years', value: 34, intended_class: FR_A6.DERIVATION, operator_accepted: true }).gate_eligible, true);
  // intended (ii) WITHOUT operator acceptance → approximation (iii), NOT a gate input
  const noAccept = classifyField({ field: 'history_years', value: 34, intended_class: FR_A6.DERIVATION, operator_accepted: false });
  assert.equal(noAccept.classification, 'iii');
  assert.equal(noAccept.gate_eligible, false);
  assert.equal(noAccept.effect_9_1, 'class3');
  // no value → unavailable (iv) → class 3
  const none = classifyField({ field: 'n_observations', value: null, intended_class: FR_A6.EXACT });
  assert.equal(none.classification, 'iv');
  assert.equal(none.effect_9_1, 'class3');
  // spec problem → class (v)
  assert.equal(classifyField({ field: 'n_observations', value: 1, intended_class: FR_A6.EXACT, spec_problem: true }).classification, 'v');
});
