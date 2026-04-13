/**
 * test/unit/to-intoto.spec.js
 * Tests for the FORGE receipt → in-toto Statement v1 converter.
 *
 * H-1 (Receipt shape — in-toto interoperability)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { toInTotoStatement } from '../../src/receipt/to-intoto.js';
import { buildReceipt } from '../../src/receipt/receipt-builder.js';
import { ingest } from '../../src/ingester/generic.js';
import { classify } from '../../src/classifier/feed-grammar.js';
import { selectTemplates } from '../../src/selector/template-selector.js';
import { emitEnvelope } from '../../src/ir/emit.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

const FIXED_TIMESTAMP_BASE = 1700000000000;
const FIXED_NOW = 1700000001000;

function buildTestReceipt() {
  const rawData = JSON.parse(readFileSync('fixtures/usgs-m4.5-day.json', 'utf8'));
  const events = ingest(rawData, { timestampBase: FIXED_TIMESTAMP_BASE });
  const profile = classify(events);
  const proposals = selectTemplates(profile);
  const envelope = emitEnvelope({
    feed_id: 'intoto-test',
    feed_profile: profile,
    proposals,
    now: FIXED_NOW,
  });
  return buildReceipt({ rawInput: rawData, envelope });
}

// ─── toInTotoStatement Tests ────────────────────────────────────────────────

describe('toInTotoStatement', () => {
  it('produces correct in-toto Statement v1 _type', () => {
    const receipt = buildTestReceipt();
    const stmt = toInTotoStatement(receipt);
    assert.equal(stmt._type, 'https://in-toto.io/Statement/v1');
  });

  it('subject is array with name and digest.sha256', () => {
    const receipt = buildTestReceipt();
    const stmt = toInTotoStatement(receipt);
    assert.ok(Array.isArray(stmt.subject), 'subject must be array');
    assert.equal(stmt.subject.length, 1);
    assert.equal(stmt.subject[0].name, 'forge-output');
    assert.ok(stmt.subject[0].digest.sha256, 'must have sha256 digest');
    // Digest should not have sha256: prefix (bare hex)
    assert.ok(/^[0-9a-f]{64}$/.test(stmt.subject[0].digest.sha256),
      'digest must be bare 64-char hex');
  });

  it('predicate.materials is array with uri and digest.sha256', () => {
    const receipt = buildTestReceipt();
    const stmt = toInTotoStatement(receipt);
    assert.ok(Array.isArray(stmt.predicate.materials), 'materials must be array');
    assert.equal(stmt.predicate.materials.length, 1);
    assert.equal(stmt.predicate.materials[0].uri, 'forge-input');
    assert.ok(/^[0-9a-f]{64}$/.test(stmt.predicate.materials[0].digest.sha256),
      'materials digest must be bare 64-char hex');
  });

  it('predicate.builder.id matches receipt.builder.uri', () => {
    const receipt = buildTestReceipt();
    const stmt = toInTotoStatement(receipt);
    assert.equal(stmt.predicate.builder.id, receipt.builder.uri);
    assert.equal(stmt.predicate.builder.id, 'https://forge.echelon.build/builder/v0');
  });

  it('predicateType matches receipt predicateType', () => {
    const receipt = buildTestReceipt();
    const stmt = toInTotoStatement(receipt);
    assert.equal(stmt.predicateType, receipt.predicateType);
    assert.equal(stmt.predicateType, 'https://forge.echelon.build/attestation/v0');
  });

  it('predicate.policy preserves receipt policy fields', () => {
    const receipt = buildTestReceipt();
    const stmt = toInTotoStatement(receipt);
    assert.equal(stmt.predicate.policy.policy_hash, receipt.policy.policy_hash);
    assert.equal(stmt.predicate.policy.rule_set_hash, receipt.policy.rule_set_hash);
    assert.equal(stmt.predicate.policy.version_tag, receipt.policy.version_tag);
  });

  it('predicate.metadata has buildInvocationId from git_sha', () => {
    const receipt = buildTestReceipt();
    const stmt = toInTotoStatement(receipt);
    assert.equal(stmt.predicate.metadata.buildInvocationId, receipt.builder.git_sha);
    assert.deepStrictEqual(stmt.predicate.metadata.completeness,
      { parameters: true, environment: false, materials: true });
  });
});
