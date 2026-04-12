/**
 * test/unit/hash.spec.js
 * Tests for the SHA-256 hash utility.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { sha256 } from '../../src/receipt/hash.js';

describe('sha256', () => {
  it('returns sha256-prefixed hex digest', () => {
    const result = sha256('hello');
    assert.ok(result.startsWith('sha256:'), 'Must start with sha256: prefix');
    const hex = result.slice(7);
    assert.equal(hex.length, 64, 'Hex digest must be 64 characters');
    assert.match(hex, /^[0-9a-f]{64}$/, 'Must be valid hex');
  });

  it('empty string has known stable hash', () => {
    // SHA-256 of empty string is well-known
    const result = sha256('');
    assert.equal(
      result,
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('known test vector: "abc"', () => {
    const result = sha256('abc');
    assert.equal(
      result,
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('accepts Buffer input', () => {
    const fromString = sha256('test');
    const fromBuffer = sha256(Buffer.from('test'));
    assert.equal(fromString, fromBuffer);
  });

  it('different inputs produce different hashes', () => {
    const a = sha256('input-a');
    const b = sha256('input-b');
    assert.notEqual(a, b);
  });

  it('same input produces same hash (deterministic)', () => {
    const input = 'determinism test';
    const results = Array.from({ length: 10 }, () => sha256(input));
    for (const r of results) {
      assert.equal(r, results[0]);
    }
  });
});
