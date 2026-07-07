/**
 * test/unit/composed-trust-do-not-emit.spec.js
 *
 * Cycle-003 Sprint 05 — `cycle-003-s05-composed-trust-do-not-emit`
 * (Sprint Plan §6 / SDD S9 / PRD Lane 8 / OD-7; AC-13; NFR-LAYER, COMPAT-8).
 *
 * DELIVERABLE. Prove the FORGE producer emits NONE of the `composed_trust`
 * settlement-authority advisory family — reserve/design only, NO schema key, NO
 * emission. Emission stays blocked until the joint B-2 disposition-mapping call
 * (PRD §13; deferred ledger). This suite is a ceiling-preserving guard: it adds no
 * behavior and no field; it fails closed if the advisory family ever leaks into an
 * emitted surface or a source/emitter/schema path.
 *
 * ── Two-layer design record (NFR-LAYER — T5.3; SDD §5 Lane 8) ──────────────────
 *
 *   Layer 1 — FORGE producer (AdmissionState INPUTS). FORGE emits the provenance
 *   inputs Echelon consumes: oracle_declarations, the `settlement_authority`
 *   structured object (the required manifest field), per-oracle trust_tier and
 *   construct_source_ref, normalization_trace, original_hash, and
 *   negative_policy_flags. These are INPUTS to an admission decision.
 *
 *   Layer 2 — Echelon disposition (COMPUTED, Echelon-owned). Echelon owns the
 *   composed advisory/disposition family — `composed_trust`, `can_settle`,
 *   `settlement_risk`, `risk_flags` — plus the integrity envelope, scoring,
 *   certification, and the final TheatreAdmissionDisposition.
 *
 *   The load-bearing invariant: AdmissionState is an INPUT TO, not EQUAL TO,
 *   TheatreAdmissionDisposition. FORGE never emits or populates the Echelon-owned
 *   advisory/disposition family. (No separate design-doc path is authorized by
 *   Sprint Plan §6; the full record also lives in the Sprint 05 implementation
 *   report `19-s05-implementation-report-composed-trust-do-not-emit.md`.)
 *
 * ── F-B naming-collision guard (SDD §2 F-B; operator-decisions §3) ─────────────
 *
 *   The advisory family is exactly:
 *     { composed_trust, can_settle, settlement_risk, risk_flags,
 *       settlement_authority ONLY WHEN nested inside a `composed_trust` object }.
 *
 *   The bare `settlement_authority` manifest field (fields.js:29, assemble.js:277)
 *   and the `no_settlement_authority` negative-policy flag (negative-policy.js:11,
 *   :33, :48, :51) are LEGITIMATE, required, already-shipped surfaces. This suite
 *   MUST NOT flag them. Therefore the four unambiguous tokens are checked by deep
 *   whole-key / whole-token match, while `settlement_authority` is checked
 *   STRUCTURALLY (absence of any `composed_trust` wrapper) and NEVER as a bare
 *   substring. Same substring-collision class as `emitted_at` ⊂ `emitted_at_ms`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { assembleBundle } from '../../src/bundle/assemble.js';
import { authorBreathManifestParts } from '../../src/bundle/settlement.js';
import { emitEnvelope, BREATH_NORMALIZATION_TRACE } from '../../src/ir/emit.js';

// ── The advisory family (F-B-scoped) ──────────────────────────────────────────
//
// The four UNAMBIGUOUS tokens never appear in legitimate shipped code or output,
// so they are safe to match as deep keys AND as whole-token substrings.
const ADVISORY_FAMILY_TOKENS = ['composed_trust', 'can_settle', 'settlement_risk', 'risk_flags'];
// `settlement_authority` is deliberately NOT in the substring list: it is a legit
// bare manifest field. It is forbidden ONLY nested in a `composed_trust` object,
// which is covered structurally by the absence of `composed_trust` entirely.
const ADVISORY_WRAPPER = 'composed_trust';

const wholeToken = (tok) => new RegExp(`\\b${tok}\\b`);

// Recursively collect every object key at any depth (walks arrays + nested objects).
function collectKeys(node, acc = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectKeys(item, acc);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      acc.push(k);
      collectKeys(v, acc);
    }
  }
  return acc;
}

// Assert the advisory family is absent from a parsed object (deep keys), and that
// no `composed_trust` wrapper exists (so no settlement_authority-in-composed_trust).
function assertNoAdvisoryFamily(obj, label) {
  const keys = collectKeys(obj);
  for (const tok of ADVISORY_FAMILY_TOKENS) {
    assert.ok(!keys.includes(tok), `${label}: must NOT emit advisory-family key "${tok}"`);
  }
  assert.ok(
    !keys.includes(ADVISORY_WRAPPER),
    `${label}: no composed_trust wrapper ⇒ no settlement_authority nested in composed_trust (F-B)`,
  );
}

// Assert raw (markdown / serialized) text carries none of the four unambiguous
// tokens. Never scans for bare `settlement_authority` (F-B).
function assertNoAdvisoryText(text, label) {
  for (const tok of ADVISORY_FAMILY_TOKENS) {
    assert.ok(!wholeToken(tok).test(text), `${label}: raw text must NOT contain advisory-family token "${tok}"`);
  }
}

// ── BREATH worked-path bundle fixture ─────────────────────────────────────────

const PINNED_NOW = 1735689600000;
const { oracleDeclarations, settlementAuthority } = authorBreathManifestParts();

function breathFinal(now = PINNED_NOW) {
  return assembleBundle({
    constructSlug: 'breath',
    constructVersion: '0.1.0',
    capabilityFlags: ['binary_resolution'],
    oracleDeclarations,
    settlementAuthority,
    final: true,
    now,
  });
}

// ── T5.1: advisory family absent from the emitted BREATH bundle ───────────────

describe('S05 T5.1 — composed_trust advisory family is absent from the emitted BREATH bundle', () => {
  it('the in-memory manifest emits none of the advisory family at any depth', () => {
    assertNoAdvisoryFamily(breathFinal().manifest, 'manifest');
  });

  it('the in-memory receipt emits none of the advisory family at any depth', () => {
    assertNoAdvisoryFamily(breathFinal().receipt, 'receipt');
  });

  it('every on-disk JSON member (manifest.json, bundle-receipt.json) emits none of the advisory family', () => {
    const { members } = breathFinal();
    for (const path of ['manifest.json', 'bundle-receipt.json']) {
      assertNoAdvisoryFamily(JSON.parse(members[path]), `member ${path}`);
      assertNoAdvisoryText(members[path], `member ${path} (raw)`);
    }
  });

  it('every markdown member (SKILL.md, reality.md, handoff.md) contains no advisory-family token', () => {
    const { members } = breathFinal();
    for (const path of ['SKILL.md', 'reality.md', 'handoff.md']) {
      assertNoAdvisoryText(members[path], `member ${path}`);
    }
  });

  it('no composed_trust wrapper exists, so no settlement_authority is nested inside one (F-B structural)', () => {
    const { manifest, members } = breathFinal();
    // Walk for a composed_trust object anywhere; there is none, so the advisory
    // nesting of settlement_authority is impossible by construction.
    assert.ok(!collectKeys(manifest).includes('composed_trust'));
    assert.ok(!collectKeys(JSON.parse(members['manifest.json'])).includes('composed_trust'));
  });

  it('F-B positive control: the LEGIT bare settlement_authority manifest field is STILL emitted (not flagged)', () => {
    const { manifest, members } = breathFinal();
    // The advisory-family gate must not have collateral-damaged the required,
    // shipped manifest field. Present in the object and on disk, and it is a
    // top-level manifest field — NOT nested in a composed_trust object.
    assert.ok('settlement_authority' in manifest, 'settlement_authority present in manifest object');
    assert.ok('settlement_authority' in JSON.parse(members['manifest.json']), 'present on disk');
    assert.notEqual(manifest.settlement_authority, undefined);
  });
});

// ── T5.1: advisory family absent from the IR ProposalEnvelope ─────────────────

describe('S05 T5.1 — composed_trust advisory family is absent from the IR ProposalEnvelope', () => {
  const BREATH_PROPOSALS = [
    {
      template: 'threshold_gate',
      params: { threshold: 151, window_hours: 24, input_mode: 'single', threshold_type: 'regulatory', settlement_source: 'airnow', base_rate: null },
      confidence: 0.92,
      rationale: "Rule 'aqi_threshold_gate' fired. Traced to: BREATH/AqiGate.",
    },
  ];
  const baseArgs = {
    feed_id: 'epa_airnow_aqi',
    feed_profile: {
      cadence:      { classification: 'hours', median_ms: 3600000, jitter_coefficient: 0.1 },
      distribution: { type: 'bounded_numeric', min: 0, max: 500, mean: 55 },
      noise:        { classification: 'smooth', spike_rate: 0.02 },
      density:      { classification: 'sparse_network', sensor_count: 3 },
      thresholds:   { type: 'regulatory', detected_thresholds: [151] },
    },
    proposals: BREATH_PROPOSALS,
    now: PINNED_NOW,
  };

  it('the default envelope emits none of the advisory family at any depth', () => {
    assertNoAdvisoryFamily(emitEnvelope(baseArgs), 'default envelope');
  });

  it('the MAXIMALLY-populated envelope (scored + policy-evaluated + trace + metadata + composition) still emits none', () => {
    // The strongest do-not-emit claim: even with usefulness scored, policy
    // evaluated, normalization_trace populated, source_metadata + composition
    // present, the Echelon-owned advisory family never appears.
    const env = emitEnvelope({
      ...baseArgs,
      score_usefulness: true,
      evaluate_policy: true,
      normalization_trace: BREATH_NORMALIZATION_TRACE,
      source_metadata: { source_id: 'epa_airnow', trust_tier: 'T1', event_count: 42 },
      composition: {
        feed_a_id: 'epa_airnow_aqi',
        feed_b_id: 'purpleair_sf',
        feed_a_role: 'threshold_target',
        feed_b_role: 'arrival_predictor',
        causal_order: { leader: 'A', lag_ms: 3600000 },
        aligned_pair_count: 9,
        rule_fired: 'threshold_with_arrival_predictor',
      },
    });
    assertNoAdvisoryFamily(env, 'max-populated envelope');
    assertNoAdvisoryText(JSON.stringify(env), 'max-populated envelope (serialized)');
  });

  it('F-B positive control: negative_policy_flags may carry the LEGIT no_settlement_authority value without tripping the gate', () => {
    // no_settlement_authority is a negative-policy VALUE (string in an array), not
    // an advisory-family key. It fires when source_metadata is absent. The gate
    // must not confuse it for `settlement_authority`-in-`composed_trust`.
    const env = emitEnvelope({ ...baseArgs, evaluate_policy: true });
    assert.ok(Array.isArray(env.negative_policy_flags));
    assert.ok(env.negative_policy_flags.includes('no_settlement_authority'), 'legit flag fires');
    assertNoAdvisoryFamily(env, 'policy-evaluated envelope'); // still clean
  });
});

// ── T5.2: family-scoped source grep (no advisory-family token in src/) ─────────
//
// CI-rideable source check: no producer / emitter / any src module introduces an
// advisory-family token. Scans the whole src/ tree for the four UNAMBIGUOUS tokens
// only (F-B: never a bare `settlement_authority` sweep). This test file lives under
// test/, so it is not self-scanned.

describe('S05 T5.2 — family-scoped source grep: advisory family absent from src/', () => {
  const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

  function walkJs(dir, acc = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walkJs(full, acc);
      else if (entry.isFile() && full.endsWith('.js')) acc.push(full);
    }
    return acc;
  }

  const srcFiles = walkJs(srcDir);

  it('found the src/ module tree', () => {
    assert.ok(srcFiles.length >= 40, `expected >=40 src .js files, found ${srcFiles.length}`);
  });

  it('no src/ file contains any of the four unambiguous advisory-family tokens', () => {
    const offenders = [];
    for (const file of srcFiles) {
      const content = readFileSync(file, 'utf8');
      for (const tok of ADVISORY_FAMILY_TOKENS) {
        if (wholeToken(tok).test(content)) offenders.push(`${file}: ${tok}`);
      }
    }
    assert.deepEqual(offenders, [], `no src/ file may introduce an advisory-family token; found: ${offenders.join(', ')}`);
  });

  it('F-B positive control: the grep is family-scoped — legit settlement_authority / no_settlement_authority survive in src/', () => {
    // Proves the family-scoped grep deliberately does NOT ban the shipped bare
    // manifest field or the negative-policy flag (a naive settlement_authority
    // sweep would false-positive on these and break the gate).
    const fields = readFileSync(join(srcDir, 'bundle', 'fields.js'), 'utf8');
    assert.ok(wholeToken('settlement_authority').test(fields), 'fields.js still declares the required settlement_authority manifest field');
    const negPolicy = readFileSync(join(srcDir, 'policy', 'negative-policy.js'), 'utf8');
    assert.ok(wholeToken('no_settlement_authority').test(negPolicy), 'negative-policy.js still declares the no_settlement_authority flag');
  });
});

// ── T5.3: reserve ≠ activate — no composed_trust schema key (AC-13) ────────────
//
// Reserve/design-only means NO schema key is added. The IR schema must carry no
// composed_trust property; the advisory family is documented (this file's header +
// the implementation report), never emitted. This is the executable anchor for the
// two-layer design record above.

describe('S05 T5.3 — reserve ≠ activate: proposal-ir.json adds no composed_trust schema key', () => {
  const specPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'spec', 'proposal-ir.json');

  it('spec/proposal-ir.json declares no composed_trust key anywhere in the schema', () => {
    const raw = readFileSync(specPath, 'utf8');
    assert.ok(!wholeToken(ADVISORY_WRAPPER).test(raw), 'raw schema text has no composed_trust token');
    assert.ok(!collectKeys(JSON.parse(raw)).includes(ADVISORY_WRAPPER), 'parsed schema has no composed_trust key');
  });

  it('spec/proposal-ir.json declares none of the advisory-family keys (reserve-only)', () => {
    const schema = JSON.parse(readFileSync(specPath, 'utf8'));
    const keys = collectKeys(schema);
    for (const tok of ADVISORY_FAMILY_TOKENS) {
      assert.ok(!keys.includes(tok), `schema must not declare advisory-family key "${tok}"`);
    }
  });
});
