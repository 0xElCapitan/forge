/**
 * test/integration/receipt-pipeline.spec.js
 * End-to-end integration test: analyze → receipt → verify → MATCH.
 *
 * Task 7.6 — Full pipeline integration test.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ForgeConstruct } from '../../src/index.js';
import { verifyReceipt }  from '../../bin/forge-verify.js';
import { signReceipt }    from '../../src/receipt/sign.js';
import { TEST_PRIVATE_KEY, TEST_KEY_ID } from '../../fixtures/receipt-test-key.js';
import { readFileSync } from 'node:fs';

// ─── Constants ──────────────────────────────────────────────────────────────

const FIXED_TIMESTAMP_BASE = 1700000000000;
const FIXED_NOW = FIXED_TIMESTAMP_BASE + 1000;

// ─── Full round-trip tests ──────────────────────────────────────────────────

describe('Receipt pipeline — full round-trip', () => {
  it('TREMOR: analyze → receipt → verify → MATCH', async () => {
    const forge = new ForgeConstruct();
    const result = await forge.analyze('fixtures/usgs-m4.5-day.json', {
      feed_id: 'tremor-e2e',
      receipt: true,
      timestampBase: FIXED_TIMESTAMP_BASE,
      now: FIXED_NOW,
    });

    assert.ok(result.envelope, 'should have envelope');
    assert.ok(result.receipt, 'should have receipt');
    assert.equal(result.receipt.schema, 'forge-receipt/v0');

    // Now verify the receipt with the envelope
    const inputData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const verification = verifyReceipt({
      receipt: result.receipt,
      inputData,
      envelope: result.envelope,
    });
    assert.equal(verification.verdict, 'MATCH', `Expected MATCH, got ${verification.verdict}: ${verification.reason}`);
    assert.equal(verification.exit_code, 0);
  });

  it('CORONA: analyze → receipt → verify → MATCH', async () => {
    // CORONA uses combined input — write a temp fixture
    const swpc = JSON.parse(readFileSync('fixtures/swpc-goes-xray.json', 'utf8'));
    const donki = JSON.parse(readFileSync('fixtures/donki-flr-cme.json', 'utf8'));
    const rawData = {
      xray_flux: swpc.xray_flux,
      kp_index: swpc.kp_index,
      flares: donki.flares,
      cmes: donki.cmes,
    };

    // For CORONA, we use the lower-level pipeline since analyze() reads from file
    const { ingest } = await import('../../src/ingester/generic.js');
    const { classify } = await import('../../src/classifier/feed-grammar.js');
    const { selectTemplates } = await import('../../src/selector/template-selector.js');
    const { emitEnvelope } = await import('../../src/ir/emit.js');

    const events = ingest(rawData, { timestampBase: FIXED_TIMESTAMP_BASE });
    const profile = classify(events);
    const proposals = selectTemplates(profile);
    const emitResult = emitEnvelope({
      feed_id: 'corona-e2e',
      feed_profile: profile,
      proposals,
      now: FIXED_NOW,
      rawInput: rawData,
      receipt: true,
    });

    assert.ok(emitResult.receipt);
    assert.equal(emitResult.receipt.schema, 'forge-receipt/v0');

    // Verify with envelope
    const verification = verifyReceipt({
      receipt: emitResult.receipt,
      inputData: rawData,
      envelope: emitResult.envelope,
    });
    assert.equal(verification.verdict, 'MATCH');
  });

  it('signed receipt: analyze → sign → verify → MATCH', async () => {
    const forge = new ForgeConstruct();
    const signFn = (payload) => signReceipt(payload, TEST_PRIVATE_KEY, TEST_KEY_ID);
    const result = await forge.analyze('fixtures/usgs-m4.5-day.json', {
      feed_id: 'tremor-signed-e2e',
      receipt: true,
      timestampBase: FIXED_TIMESTAMP_BASE,
      now: FIXED_NOW,
      sign: signFn,
    });

    assert.ok(result.receipt.signature, 'receipt should be signed');
    assert.ok(result.receipt.signature.startsWith('ed25519:'));
    assert.equal(result.receipt.key_id, TEST_KEY_ID);

    // Verify with keyring and envelope
    const inputData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const verification = verifyReceipt({
      receipt: result.receipt,
      inputData,
      envelope: result.envelope,
      keyringPath: 'keys/forge-keyring.json',
    });
    assert.equal(verification.verdict, 'MATCH');
    assert.equal(verification.details.checks.signature, 'pass');
  });

  it('backward compatible: analyze without receipt returns existing shape', async () => {
    const forge = new ForgeConstruct();
    const result = await forge.analyze('fixtures/usgs-m4.5-day.json', {
      feed_id: 'tremor-compat',
    });

    assert.ok(result.envelope, 'should have envelope');
    assert.ok(result.envelope.ir_version, 'envelope should have ir_version');
    assert.equal(result.receipt, undefined, 'should NOT have receipt');
    assert.ok(result.proposals.length > 0);
  });
});

// ─── Goal validation (Task 7.7) ─────────────────────────────────────────────

describe('PRD Goal Validation (Task 7.7)', () => {
  it('G-1: Determinism gate — identical inputs produce identical envelopes', async () => {
    const forge = new ForgeConstruct();
    const r1 = await forge.analyze('fixtures/usgs-m4.5-day.json', {
      feed_id: 'g1-test', timestampBase: FIXED_TIMESTAMP_BASE, now: FIXED_NOW,
    });
    const r2 = await forge.analyze('fixtures/usgs-m4.5-day.json', {
      feed_id: 'g1-test', timestampBase: FIXED_TIMESTAMP_BASE, now: FIXED_NOW,
    });
    assert.deepStrictEqual(r1.envelope, r2.envelope, 'Identical inputs must produce identical envelopes');
  });

  it('G-2: Receipt generated with all required fields', async () => {
    const forge = new ForgeConstruct();
    const result = await forge.analyze('fixtures/usgs-m4.5-day.json', {
      feed_id: 'g2-test', receipt: true, timestampBase: FIXED_TIMESTAMP_BASE, now: FIXED_NOW,
    });
    const required = ['schema', 'input_hash', 'input_canonicalization', 'code_version',
      'policy_hash', 'rule_set_hash', 'output_hash', 'computed_at', 'signer', 'key_id', 'signature'];
    for (const field of required) {
      assert.ok(field in result.receipt, `Missing required field: ${field}`);
    }
  });

  it('G-3: forge-verify returns MATCH on known-good receipt', async () => {
    const forge = new ForgeConstruct();
    const result = await forge.analyze('fixtures/usgs-m4.5-day.json', {
      feed_id: 'g3-test', receipt: true, timestampBase: FIXED_TIMESTAMP_BASE, now: FIXED_NOW,
    });
    const inputData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const verification = verifyReceipt({ receipt: result.receipt, inputData, envelope: result.envelope });
    assert.equal(verification.verdict, 'MATCH');
  });

  it('G-4: http_transcript_receipts field present and nullable', async () => {
    const forge = new ForgeConstruct();
    const result = await forge.analyze('fixtures/usgs-m4.5-day.json', {
      feed_id: 'g4-test', receipt: true, timestampBase: FIXED_TIMESTAMP_BASE, now: FIXED_NOW,
    });
    assert.ok('http_transcript_receipts' in result.receipt);
    assert.equal(result.receipt.http_transcript_receipts, null);
  });

  it('G-5: Retention policy document exists', () => {
    const doc = readFileSync('docs/retention-policy.md', 'utf8');
    assert.ok(doc.includes('90 days'), 'Retention policy should specify 90-day minimum');
    assert.ok(doc.includes('caller'), 'Should clarify caller responsibility');
  });
});
