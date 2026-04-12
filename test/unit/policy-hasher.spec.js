/**
 * test/unit/policy-hasher.spec.js
 * Tests for policy content-addressing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computePolicyHash } from '../../src/receipt/policy-hasher.js';

describe('computePolicyHash', () => {
  it('returns policy_hash, rule_set_hash, and policy_version_tag', () => {
    const result = computePolicyHash();
    assert.ok(result.policy_hash, 'policy_hash must be present');
    assert.ok(result.rule_set_hash, 'rule_set_hash must be present');
    assert.equal(result.policy_version_tag, 'forge-policy/v0.1.0');
  });

  it('hashes are sha256-prefixed', () => {
    const result = computePolicyHash();
    assert.ok(result.policy_hash.startsWith('sha256:'));
    assert.ok(result.rule_set_hash.startsWith('sha256:'));
    assert.equal(result.policy_hash.slice(7).length, 64);
    assert.equal(result.rule_set_hash.slice(7).length, 64);
  });

  it('returns identical hashes across 10 calls (deterministic)', () => {
    const reference = computePolicyHash();
    for (let i = 0; i < 10; i++) {
      const result = computePolicyHash();
      assert.equal(result.policy_hash, reference.policy_hash, `policy_hash diverged at call ${i + 1}`);
      assert.equal(result.rule_set_hash, reference.rule_set_hash, `rule_set_hash diverged at call ${i + 1}`);
    }
  });

  it('policy_hash and rule_set_hash are different', () => {
    const result = computePolicyHash();
    assert.notEqual(result.policy_hash, result.rule_set_hash,
      'policy_hash should differ from rule_set_hash (concatenation includes regulatory hashes)');
  });
});
