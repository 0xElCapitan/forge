/**
 * test/unit/forge-verify.spec.js
 * Tests for the forge-verify replay verifier.
 *
 * FR-8 (Replay Verifier)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { verifyReceipt } from '../../bin/forge-verify.js';
import { ingest }          from '../../src/ingester/generic.js';
import { classify }        from '../../src/classifier/feed-grammar.js';
import { selectTemplates } from '../../src/selector/template-selector.js';
import { emitEnvelope }    from '../../src/ir/emit.js';
import { buildReceipt }    from '../../src/receipt/receipt-builder.js';
import { signReceipt }     from '../../src/receipt/sign.js';
import { TEST_PRIVATE_KEY, TEST_KEY_ID } from '../../fixtures/receipt-test-key.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

// These must match the constants in forge-verify.js for replay determinism
const REPLAY_TIMESTAMP_BASE = 1700000000000;
const REPLAY_NOW = REPLAY_TIMESTAMP_BASE + 1000;

function generateReceipt(rawData, feedId, { sign: signFn } = {}) {
  const events = ingest(rawData, { timestampBase: REPLAY_TIMESTAMP_BASE });
  const profile = classify(events);
  const proposals = selectTemplates(profile);
  // Use feed_id='replay-verify' to match what the verifier uses
  const envelope = emitEnvelope({
    feed_id: 'replay-verify',
    feed_profile: profile,
    proposals,
    now: REPLAY_NOW,
  });
  return buildReceipt({ rawInput: rawData, envelope, sign: signFn });
}

// ─── MATCH path ─────────────────────────────────────────────────────────────

describe('forge-verify — MATCH path', () => {
  it('TREMOR: known-good receipt verifies as MATCH', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const receipt = generateReceipt(rawData, 'tremor');
    const result = verifyReceipt({ receipt, inputData: rawData });
    assert.equal(result.verdict, 'MATCH');
    assert.equal(result.exit_code, 0);
    assert.equal(result.details.checks.input_hash, 'pass');
    assert.equal(result.details.checks.output_hash, 'pass');
  });

  it('CORONA: known-good receipt verifies as MATCH', () => {
    const swpc = JSON.parse(readFileSync('fixtures/swpc-goes-xray.json', 'utf8'));
    const donki = JSON.parse(readFileSync('fixtures/donki-flr-cme.json', 'utf8'));
    const rawData = {
      xray_flux: swpc.xray_flux,
      kp_index: swpc.kp_index,
      flares: donki.flares,
      cmes: donki.cmes,
    };
    const receipt = generateReceipt(rawData, 'corona');
    const result = verifyReceipt({ receipt, inputData: rawData });
    assert.equal(result.verdict, 'MATCH');
    assert.equal(result.exit_code, 0);
  });

  it('BREATH: known-good receipt verifies as MATCH', () => {
    const purpleair = JSON.parse(readFileSync('fixtures/purpleair-sf-bay.json', 'utf8'));
    const airnow = JSON.parse(readFileSync('fixtures/airnow-sf-bay.json', 'utf8'));
    const rawData = { purpleair, airnow };
    const receipt = generateReceipt(rawData, 'breath');
    const result = verifyReceipt({ receipt, inputData: rawData });
    assert.equal(result.verdict, 'MATCH');
    assert.equal(result.exit_code, 0);
  });
});

// ─── MISMATCH path ──────────────────────────────────────────────────────────

describe('forge-verify — MISMATCH path', () => {
  it('tampered subject.digest detected as MISMATCH', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const receipt = generateReceipt(rawData, 'tremor');
    receipt.subject.digest = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
    const result = verifyReceipt({ receipt, inputData: rawData });
    assert.equal(result.verdict, 'MISMATCH');
    assert.equal(result.exit_code, 1);
    assert.ok(result.reason.includes('Output hash mismatch'));
  });

  it('wrong input data detected as MISMATCH', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const receipt = generateReceipt(rawData, 'tremor');
    const wrongInput = { different: 'data' };
    const result = verifyReceipt({ receipt, inputData: wrongInput });
    assert.equal(result.verdict, 'MISMATCH');
    assert.equal(result.exit_code, 1);
    assert.ok(result.reason.includes('Input hash mismatch'));
  });
});

// ─── ERROR path ─────────────────────────────────────────────────────────────

describe('forge-verify — ERROR path', () => {
  it('unknown schema returns ERROR', () => {
    const result = verifyReceipt({
      receipt: { schema: 'unknown/v99' },
      inputData: {},
    });
    assert.equal(result.verdict, 'ERROR');
    assert.equal(result.exit_code, 2);
  });

  it('unknown key_id returns ERROR', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const receipt = generateReceipt(rawData, 'tremor');
    receipt.signature = 'ed25519:fakesignature';
    receipt.key_id = 'nonexistent-key-999';
    const result = verifyReceipt({
      receipt,
      inputData: rawData,
      keyringPath: 'keys/forge-keyring.json',
    });
    assert.equal(result.verdict, 'ERROR');
    assert.equal(result.exit_code, 2);
    assert.ok(result.reason.includes('Unknown key_id'));
  });

  it('invalid signature returns ERROR', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const receipt = generateReceipt(rawData, 'tremor');
    // Set a valid key_id but bad signature
    receipt.signature = 'ed25519:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    receipt.key_id = 'forge-test-001';
    const result = verifyReceipt({
      receipt,
      inputData: rawData,
      keyringPath: 'keys/forge-keyring.json',
    });
    assert.equal(result.verdict, 'ERROR');
    assert.equal(result.exit_code, 2);
    assert.ok(result.reason.includes('Signature verification failed'));
  });
});

// ─── Signature verification ─────────────────────────────────────────────────

describe('forge-verify — signed receipt', () => {
  it('validly signed receipt passes signature check', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const signFn = (payload) => signReceipt(payload, TEST_PRIVATE_KEY, TEST_KEY_ID);
    const receipt = generateReceipt(rawData, 'tremor', { sign: signFn });
    const result = verifyReceipt({
      receipt,
      inputData: rawData,
      keyringPath: 'keys/forge-keyring.json',
    });
    assert.equal(result.verdict, 'MATCH');
    assert.equal(result.exit_code, 0);
    assert.equal(result.details.checks.signature, 'pass');
  });
});

// ─── Node version warning ───────────────────────────────────────────────────

describe('forge-verify — warnings', () => {
  it('node version mismatch produces warning but does not block', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const receipt = generateReceipt(rawData, 'tremor');
    // Fake a different node version
    receipt.builder.node_version = '99.99.99';
    const result = verifyReceipt({ receipt, inputData: rawData });
    // Should still MATCH (node version is advisory)
    assert.equal(result.verdict, 'MATCH');
    assert.ok(result.details.warnings.length > 0, 'should have warnings');
    assert.ok(result.details.warnings[0].includes('Node version mismatch'));
  });

  it('unsigned receipt skips signature check', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const receipt = generateReceipt(rawData, 'tremor');
    assert.equal(receipt.signature, null);
    const result = verifyReceipt({ receipt, inputData: rawData });
    assert.equal(result.verdict, 'MATCH');
    assert.equal(result.details.checks.signature, 'unsigned (skipped)');
  });
});

// ─── Sprint 01 §7 dual-version replay gate (PRD §7 / SDD §7.4) ─────────────
//
// Closes the PRD §7 merge gate "Verification path (Path 1)": forge-verify
// exits MATCH for one preserved v0.1.0 envelope+receipt AND the three
// refreshed v0.2.0 fixtures (TREMOR, CORONA, BREATH), in a single test run,
// with bin/forge-verify.js UNCHANGED.
//
// ───────────────────────── v0.1.0 inline literal provenance ────────────────
// Per Sprint 01 plan §10 Option (b) (operator selection 2026-05-26 by el
// capitan), the preserved v0.1.0 envelope + receipt pair below are inline JS
// object literals — NOT tracked fixture files. This comment documents the
// four mandatory items per §10 Option (b):
//
//   1. Why these literals exist:
//      Closure of the PRD §7 dual-version merge gate. See PRD §7 and Sprint
//      01 plan §10 Option (b). Tracked fixtures (Option a) were not taken;
//      no `fixtures/v0.1.0-preserved-*.json` paths exist for this sprint.
//
//   2. Which v0.1.0 envelope + receipt pair they represent:
//      TREMOR scenario, generated from `fixtures/usgs-m4.5-day.json` with
//      feed_id='replay-verify' (matching the verifier's replay convention
//      at bin/forge-verify.js:144). Single representative scenario per PRD
//      §7 "at least one preserved v0.1.0 fixture".
//
//   3. Pre-edit commit SHA at which they were captured:
//      931d4c89 — the master HEAD on which branch `cycle-002/ir-0.2.0-bundle`
//      was opened, prior to ANY of FR-1/FR-2/FR-3/FR-4/FR-5 edits.
//
//   4. Command / replay constants used to regenerate them:
//      REPLAY_TIMESTAMP_BASE = 1700000000000
//      REPLAY_NOW            = 1700000001000
//      Capture command (run at commit 931d4c89):
//        node --input-type=module -e "
//          import { readFileSync } from 'node:fs';
//          import { ingest } from './src/ingester/generic.js';
//          import { classify } from './src/classifier/feed-grammar.js';
//          import { selectTemplates } from './src/selector/template-selector.js';
//          import { emitEnvelope } from './src/ir/emit.js';
//          import { buildReceipt } from './src/receipt/receipt-builder.js';
//          const raw = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json','utf8'));
//          const events = ingest(raw, { timestampBase: 1700000000000 });
//          const profile = classify(events);
//          const proposals = selectTemplates(profile);
//          const envelope = emitEnvelope({
//            feed_id: 'replay-verify',
//            feed_profile: profile,
//            proposals,
//            now: 1700000001000,
//            rawInput: raw,
//          });
//          const receipt = buildReceipt({ rawInput: raw, envelope });
//          console.log(JSON.stringify({envelope, receipt}, null, 2));
//        "
//      The receipt's non-deterministic fields (computed_at, builder.node_version,
//      builder.git_sha) are NOT load-bearing for verifyReceipt's MATCH check —
//      verifyReceipt with `envelope` passed in direct-envelope mode (see
//      bin/forge-verify.js:123) hashes the provided envelope and compares to
//      receipt.subject.digest. The digest is the only field that gates MATCH.

const V0_1_0_PRESERVED_ENVELOPE = {
  ir_version: '0.1.0',
  forge_version: '0.1.0',
  classifier_version: '0.1.0',
  emitted_at: 1700000001000,
  feed_id: 'replay-verify',
  feed_profile: {
    cadence: {
      classification: 'event_driven',
      median_ms: 3876464,
      jitter_coefficient: 0.9692706996254467,
    },
    distribution: { type: 'unbounded_numeric', min: null, max: null, mean: null },
    noise: { classification: 'spike_driven', spike_rate: null },
    density: { classification: 'sparse_network', sensor_count: 18 },
    thresholds: { type: 'statistical', detected_thresholds: null },
  },
  proposals: [
    {
      proposal_id: '683a353da04d991b',
      template: 'threshold_gate',
      params: { threshold: 5, window_hours: 24, base_rate: null, input_mode: 'single', threshold_type: 'statistical', settlement_source: null },
      confidence: 0.9,
      rationale: "Rule 'seismic_threshold_gate' fired (3/3 conditions). Traced to: TREMOR/MagGate.",
      brier_type: 'binary',
      usefulness_score: null,
    },
    {
      proposal_id: 'a7f4347d9c5238d4',
      template: 'cascade',
      params: { trigger_threshold: 6, bucket_count: 5, window_hours: 72, prior_model: 'omori' },
      confidence: 0.85,
      rationale: "Rule 'seismic_cascade' fired (2/2 conditions). Traced to: TREMOR/AftershockCascade.",
      brier_type: 'multi_class',
      usefulness_score: null,
    },
    {
      proposal_id: '17b96b5de16fb9e8',
      template: 'divergence',
      params: { source_a_type: 'automatic', source_b_type: 'reviewed', divergence_threshold: null, resolution_mode: 'self-resolving' },
      confidence: 0.8,
      rationale: "Rule 'seismic_review_divergence' fired (2/2 conditions). Traced to: TREMOR/OracleDivergence.",
      brier_type: 'binary',
      usefulness_score: null,
    },
    {
      proposal_id: '2a4cfd5dc3805484',
      template: 'anomaly',
      params: { baseline_metric: 'b-value', sigma_threshold: null, window_hours: 168 },
      confidence: 0.75,
      rationale: "Rule 'seismic_anomaly' fired (2/2 conditions). Traced to: TREMOR/SwarmWatch.",
      brier_type: 'binary',
      usefulness_score: null,
    },
    {
      proposal_id: 'cf23a0f2d0a88893',
      template: 'regime_shift',
      params: { state_boundary: null, zone_prior: null },
      confidence: 0.7,
      rationale: "Rule 'seismic_regime_shift' fired (2/2 conditions). Traced to: TREMOR/DepthRegime.",
      brier_type: 'binary',
      usefulness_score: null,
    },
  ],
  composition: null,
  usefulness_scores: null,
  original_hash: 'sha256:b9a0493851e9667a710223d1bfd90805be90416df874e68cebe30cf8d0d1ce73',
  hash_algorithm: 'sha256',
  negative_policy_flags: null,
};

const V0_1_0_PRESERVED_RECEIPT = {
  schema: 'forge-receipt/v0',
  predicateType: 'https://forge.echelon.build/attestation/v0',
  subject: {
    digest: 'sha256:a089dc7599f7a2cd6f4a62fc569887a06c5af322c8adeecf627ef9ab085c1014',
    uri: null,
  },
  materials: {
    digest: 'sha256:b9a0493851e9667a710223d1bfd90805be90416df874e68cebe30cf8d0d1ce73',
    canonicalization: 'jcs-subset/v0',
    uri: null,
  },
  policy: {
    policy_hash: 'sha256:574da11de8b46e1df448dd8073372f9575916646ae9f9ae7c36f1ec41f246dbc',
    rule_set_hash: 'sha256:4909056b9cbc827fa9c9275254861a2c66f3953473973103f1d201f358c407c3',
    version_tag: 'forge-policy/v0.1.0',
  },
  builder: {
    uri: 'https://forge.echelon.build/builder/v0',
    git_sha: '931d4c892dc7f33a70506a2a34d22028e3590fa5',
    package_lock_sha: null,
    node_version: '25.2.1',
  },
  // computed_at is not load-bearing for verifyReceipt — direct-envelope mode
  // gates MATCH on subject.digest alone. Pinned literal preserves capture
  // provenance.
  computed_at: '2026-05-27T16:18:08.347Z',
  http_transcript_receipts: null,
  signer: 'forge-production',
  key_id: null,
  signature: null,
};

describe('Sprint 01 §7 dual-version gate', () => {
  it('forge-verify exits MATCH for one preserved v0.1.0 fixture (TREMOR, inline literals)', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const result = verifyReceipt({
      receipt: V0_1_0_PRESERVED_RECEIPT,
      inputData: rawData,
      envelope: V0_1_0_PRESERVED_ENVELOPE,
    });
    assert.equal(result.verdict, 'MATCH', `expected MATCH, got ${result.verdict}: ${result.reason}`);
    assert.equal(result.exit_code, 0);
    assert.equal(result.details.checks.output_hash, 'pass');
    assert.equal(result.details.checks.output_hash_mode, 'direct');
  });

  it('forge-verify exits MATCH for v0.2.0 TREMOR', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const receipt = generateReceipt(rawData, 'tremor');
    const result = verifyReceipt({ receipt, inputData: rawData });
    assert.equal(result.verdict, 'MATCH', `expected MATCH, got ${result.verdict}: ${result.reason}`);
    assert.equal(result.exit_code, 0);
  });

  it('forge-verify exits MATCH for v0.2.0 CORONA', () => {
    const swpc = JSON.parse(readFileSync('fixtures/swpc-goes-xray.json', 'utf8'));
    const donki = JSON.parse(readFileSync('fixtures/donki-flr-cme.json', 'utf8'));
    const rawData = {
      xray_flux: swpc.xray_flux,
      kp_index: swpc.kp_index,
      flares: donki.flares,
      cmes: donki.cmes,
    };
    const receipt = generateReceipt(rawData, 'corona');
    const result = verifyReceipt({ receipt, inputData: rawData });
    assert.equal(result.verdict, 'MATCH', `expected MATCH, got ${result.verdict}: ${result.reason}`);
    assert.equal(result.exit_code, 0);
  });

  it('forge-verify exits MATCH for v0.2.0 BREATH', () => {
    const purpleair = JSON.parse(readFileSync('fixtures/purpleair-sf-bay.json', 'utf8'));
    const airnow = JSON.parse(readFileSync('fixtures/airnow-sf-bay.json', 'utf8'));
    const rawData = { purpleair, airnow };
    const receipt = generateReceipt(rawData, 'breath');
    const result = verifyReceipt({ receipt, inputData: rawData });
    assert.equal(result.verdict, 'MATCH', `expected MATCH, got ${result.verdict}: ${result.reason}`);
    assert.equal(result.exit_code, 0);
  });
});
