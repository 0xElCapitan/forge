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
  it('tampered output_hash detected as MISMATCH', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const receipt = generateReceipt(rawData, 'tremor');
    receipt.output_hash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
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
    receipt.code_version.node_version = '99.99.99';
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
