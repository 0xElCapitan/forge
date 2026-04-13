/**
 * test/unit/receipt-builder.spec.js
 * Tests for the ProposalReceipt builder and emitEnvelope receipt integration.
 *
 * FR-6 (ProposalReceipt Schema v0)
 * H-1 (Receipt shape restructuring — attestation field discipline)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildReceipt } from '../../src/receipt/receipt-builder.js';
import { canonicalize } from '../../src/receipt/canonicalize.js';
import { sha256 } from '../../src/receipt/hash.js';
import { ingest } from '../../src/ingester/generic.js';
import { classify } from '../../src/classifier/feed-grammar.js';
import { selectTemplates } from '../../src/selector/template-selector.js';
import { emitEnvelope } from '../../src/ir/emit.js';

// ─── Schema validation helper ───────────────────────────────────────────────

const schema = JSON.parse(readFileSync('spec/receipt-v0.json', 'utf8'));

function validateReceipt(receipt) {
  const errors = [];

  // Check required fields
  for (const field of schema.required) {
    if (!(field in receipt)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Check schema field
  if (receipt.schema !== 'forge-receipt/v0') {
    errors.push(`Invalid schema: ${receipt.schema}`);
  }

  // Check predicateType
  if (receipt.predicateType !== 'https://forge.echelon.build/attestation/v0') {
    errors.push(`Invalid predicateType: ${receipt.predicateType}`);
  }

  // Check hash formats
  const hashPattern = /^sha256:[0-9a-f]{64}$/;

  // subject.digest
  if (receipt.subject?.digest && !hashPattern.test(receipt.subject.digest)) {
    errors.push(`Invalid hash format for subject.digest: ${receipt.subject.digest}`);
  }

  // materials.digest
  if (receipt.materials?.digest && !hashPattern.test(receipt.materials.digest)) {
    errors.push(`Invalid hash format for materials.digest: ${receipt.materials.digest}`);
  }

  // materials.canonicalization
  if (receipt.materials?.canonicalization !== 'jcs-subset/v0') {
    errors.push(`Invalid materials.canonicalization: ${receipt.materials?.canonicalization}`);
  }

  // policy hashes
  if (receipt.policy?.policy_hash && !hashPattern.test(receipt.policy.policy_hash)) {
    errors.push(`Invalid hash format for policy.policy_hash: ${receipt.policy.policy_hash}`);
  }
  if (receipt.policy?.rule_set_hash && !hashPattern.test(receipt.policy.rule_set_hash)) {
    errors.push(`Invalid hash format for policy.rule_set_hash: ${receipt.policy.rule_set_hash}`);
  }

  // builder
  if (receipt.builder) {
    if (receipt.builder.package_lock_sha !== null) {
      errors.push('builder.package_lock_sha should be null at v0');
    }
    if (typeof receipt.builder.node_version !== 'string') {
      errors.push('builder.node_version should be a string');
    }
  }

  // Check computed_at is ISO 8601
  if (receipt.computed_at && isNaN(Date.parse(receipt.computed_at))) {
    errors.push(`Invalid computed_at: ${receipt.computed_at}`);
  }

  // Check http_transcript_receipts is null
  if (receipt.http_transcript_receipts !== null) {
    errors.push('http_transcript_receipts should be null at v0');
  }

  return errors;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const FIXED_TIMESTAMP_BASE = 1700000000000;
const FIXED_NOW = 1700000001000;

function buildTestReceipt(rawData, feedId) {
  const events = ingest(rawData, { timestampBase: FIXED_TIMESTAMP_BASE });
  const profile = classify(events);
  const proposals = selectTemplates(profile);
  const envelope = emitEnvelope({
    feed_id: feedId,
    feed_profile: profile,
    proposals,
    now: FIXED_NOW,
  });
  return buildReceipt({ rawInput: rawData, envelope });
}

// ─── buildReceipt Tests ─────────────────────────────────────────────────────

describe('buildReceipt', () => {
  it('produces a receipt with all required fields', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const receipt = buildTestReceipt(rawData, 'test-tremor');
    const errors = validateReceipt(receipt);
    assert.deepStrictEqual(errors, [], `Schema validation errors: ${errors.join(', ')}`);
  });

  it('has predicateType attestation discriminator', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const receipt = buildTestReceipt(rawData, 'test-tremor');
    assert.equal(receipt.predicateType, 'https://forge.echelon.build/attestation/v0');
  });

  it('subject.digest is hash of canonicalized envelope', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const events = ingest(rawData, { timestampBase: FIXED_TIMESTAMP_BASE });
    const profile = classify(events);
    const proposals = selectTemplates(profile);
    const envelope = emitEnvelope({
      feed_id: 'test-tremor',
      feed_profile: profile,
      proposals,
      now: FIXED_NOW,
    });
    const receipt = buildReceipt({ rawInput: rawData, envelope });
    const expectedHash = sha256(canonicalize(envelope));
    assert.equal(receipt.subject.digest, expectedHash);
  });

  it('materials.digest is hash of canonicalized raw input (not post-normalized events)', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const receipt = buildTestReceipt(rawData, 'test-tremor');
    const expectedHash = sha256(canonicalize(rawData));
    assert.equal(receipt.materials.digest, expectedHash);
  });

  it('materials.canonicalization is jcs-subset/v0', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const receipt = buildTestReceipt(rawData, 'test-tremor');
    assert.equal(receipt.materials.canonicalization, 'jcs-subset/v0');
  });

  it('policy groups policy_hash, rule_set_hash, version_tag', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const receipt = buildTestReceipt(rawData, 'test-tremor');
    assert.ok(receipt.policy.policy_hash);
    assert.ok(receipt.policy.rule_set_hash);
    assert.equal(receipt.policy.version_tag, 'forge-policy/v0.1.0');
  });

  it('builder has uri, git_sha, package_lock_sha, node_version', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const receipt = buildTestReceipt(rawData, 'test-tremor');
    assert.equal(receipt.builder.uri, 'https://forge.echelon.build/builder/v0');
    assert.equal(receipt.builder.package_lock_sha, null);
    assert.ok(typeof receipt.builder.node_version === 'string');
  });

  it('no flat input_hash, output_hash, code_version fields remain', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const receipt = buildTestReceipt(rawData, 'test-tremor');
    assert.equal(receipt.input_hash, undefined, 'flat input_hash should not exist');
    assert.equal(receipt.output_hash, undefined, 'flat output_hash should not exist');
    assert.equal(receipt.code_version, undefined, 'flat code_version should not exist');
    assert.equal(receipt.input_canonicalization, undefined, 'flat input_canonicalization should not exist');
    assert.equal(receipt.policy_hash, undefined, 'flat policy_hash should not exist');
    assert.equal(receipt.rule_set_hash, undefined, 'flat rule_set_hash should not exist');
    assert.equal(receipt.policy_version_tag, undefined, 'flat policy_version_tag should not exist');
  });

  it('computed_at is present as ISO 8601 string', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const receipt = buildTestReceipt(rawData, 'test-tremor');
    assert.ok(receipt.computed_at);
    assert.ok(!isNaN(Date.parse(receipt.computed_at)), 'computed_at must be valid ISO 8601');
  });

  it('http_transcript_receipts is null', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const receipt = buildTestReceipt(rawData, 'test-tremor');
    assert.equal(receipt.http_transcript_receipts, null);
  });

  it('signature and key_id are null without sign function', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const receipt = buildTestReceipt(rawData, 'test-tremor');
    assert.equal(receipt.signature, null);
    assert.equal(receipt.key_id, null);
  });

  it('sign function is called when provided', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const events = ingest(rawData, { timestampBase: FIXED_TIMESTAMP_BASE });
    const profile = classify(events);
    const proposals = selectTemplates(profile);
    const envelope = emitEnvelope({
      feed_id: 'test-tremor',
      feed_profile: profile,
      proposals,
      now: FIXED_NOW,
    });

    let signedPayload = null;
    const mockSign = (payload) => {
      signedPayload = payload;
      return { signature: 'ed25519:test-sig', key_id: 'test-key-001' };
    };

    const receipt = buildReceipt({ rawInput: rawData, envelope, sign: mockSign });
    assert.equal(receipt.signature, 'ed25519:test-sig');
    assert.equal(receipt.key_id, 'test-key-001');
    assert.ok(signedPayload, 'sign function should have been called');
    assert.ok(typeof signedPayload === 'string', 'payload should be canonical string');
  });
});

// ─── Domain fixture receipts (Task 4.4) ─────────────────────────────────────

describe('Receipt fixture generation (Task 4.4)', () => {
  it('TREMOR: generates valid receipt', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const receipt = buildTestReceipt(rawData, 'tremor-fixture');
    const errors = validateReceipt(receipt);
    assert.deepStrictEqual(errors, [], `TREMOR: ${errors.join(', ')}`);
    assert.equal(receipt.materials.digest, sha256(canonicalize(rawData)));
  });

  it('CORONA: generates valid receipt', () => {
    const swpc = JSON.parse(readFileSync('fixtures/swpc-goes-xray.json', 'utf8'));
    const donki = JSON.parse(readFileSync('fixtures/donki-flr-cme.json', 'utf8'));
    const rawData = {
      xray_flux: swpc.xray_flux,
      kp_index: swpc.kp_index,
      flares: donki.flares,
      cmes: donki.cmes,
    };
    const receipt = buildTestReceipt(rawData, 'corona-fixture');
    const errors = validateReceipt(receipt);
    assert.deepStrictEqual(errors, [], `CORONA: ${errors.join(', ')}`);
    assert.equal(receipt.materials.digest, sha256(canonicalize(rawData)));
  });

  it('BREATH: generates valid receipt', () => {
    const purpleair = JSON.parse(readFileSync('fixtures/purpleair-sf-bay.json', 'utf8'));
    const airnow = JSON.parse(readFileSync('fixtures/airnow-sf-bay.json', 'utf8'));
    const rawData = { purpleair, airnow };
    const receipt = buildTestReceipt(rawData, 'breath-fixture');
    const errors = validateReceipt(receipt);
    assert.deepStrictEqual(errors, [], `BREATH: ${errors.join(', ')}`);
    assert.equal(receipt.materials.digest, sha256(canonicalize(rawData)));
  });
});

// ─── emitEnvelope receipt integration (Task 4.3) ─────────────────────────────

describe('emitEnvelope — receipt integration', () => {
  it('receipt: false returns envelope only (backward compatible)', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const events = ingest(rawData, { timestampBase: FIXED_TIMESTAMP_BASE });
    const profile = classify(events);
    const proposals = selectTemplates(profile);
    const result = emitEnvelope({
      feed_id: 'test',
      feed_profile: profile,
      proposals,
      receipt: false,
    });
    // Should be an envelope, not { envelope, receipt }
    assert.ok(result.ir_version, 'Should have ir_version (envelope shape)');
    assert.equal(result.receipt, undefined, 'Should not have receipt property');
  });

  it('receipt: true returns { envelope, receipt }', () => {
    const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
    const events = ingest(rawData, { timestampBase: FIXED_TIMESTAMP_BASE });
    const profile = classify(events);
    const proposals = selectTemplates(profile);
    const result = emitEnvelope({
      feed_id: 'test',
      feed_profile: profile,
      proposals,
      now: FIXED_NOW,
      rawInput: rawData,
      receipt: true,
    });
    assert.ok(result.envelope, 'Should have envelope property');
    assert.ok(result.receipt, 'Should have receipt property');
    assert.ok(result.envelope.ir_version, 'Envelope should have ir_version');
    assert.equal(result.receipt.schema, 'forge-receipt/v0');
    assert.equal(result.receipt.predicateType, 'https://forge.echelon.build/attestation/v0');
  });
});
