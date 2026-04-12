/**
 * test/unit/sign.spec.js
 * Tests for ed25519 receipt signing and verification.
 *
 * FR-7 (Receipt Signing)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { signReceipt, verifySignature } from '../../src/receipt/sign.js';
import { loadKeyring, getPublicKey } from '../../src/receipt/keyring.js';
import { TEST_PRIVATE_KEY, TEST_PUBLIC_KEY, TEST_KEY_ID } from '../../fixtures/receipt-test-key.js';
import { canonicalize } from '../../src/receipt/canonicalize.js';

// ─── signReceipt / verifySignature ─────────────────────────────────────────

describe('signReceipt', () => {
  const payload = canonicalize({ schema: 'forge-receipt/v0', input_hash: 'sha256:abc123' });

  it('sign -> verify round-trips successfully', () => {
    const { signature, key_id } = signReceipt(payload, TEST_PRIVATE_KEY, TEST_KEY_ID);
    assert.ok(signature.startsWith('ed25519:'), 'signature must have ed25519: prefix');
    assert.equal(key_id, TEST_KEY_ID);
    const valid = verifySignature(payload, signature, TEST_PUBLIC_KEY);
    assert.equal(valid, true);
  });

  it('signature format is ed25519: prefixed base64', () => {
    const { signature } = signReceipt(payload, TEST_PRIVATE_KEY, TEST_KEY_ID);
    assert.ok(signature.startsWith('ed25519:'));
    const b64Part = signature.slice('ed25519:'.length);
    // Valid base64 should not throw when decoded
    const buf = Buffer.from(b64Part, 'base64');
    assert.ok(buf.length > 0, 'signature should decode to non-empty buffer');
    // ed25519 signatures are 64 bytes
    assert.equal(buf.length, 64, 'ed25519 signature should be 64 bytes');
  });

  it('tampered payload fails verification', () => {
    const { signature } = signReceipt(payload, TEST_PRIVATE_KEY, TEST_KEY_ID);
    const tampered = payload + ' tampered';
    const valid = verifySignature(tampered, signature, TEST_PUBLIC_KEY);
    assert.equal(valid, false);
  });

  it('throws SIGNING_KEY_MISSING when no key provided and env unset', () => {
    const saved = process.env.FORGE_SIGNING_KEY;
    delete process.env.FORGE_SIGNING_KEY;
    try {
      assert.throws(
        () => signReceipt(payload),
        (err) => err.code === 'SIGNING_KEY_MISSING',
      );
    } finally {
      if (saved !== undefined) process.env.FORGE_SIGNING_KEY = saved;
    }
  });

  it('throws SIGNING_KEY_INVALID for bad key format', () => {
    assert.throws(
      () => signReceipt(payload, 'not-a-valid-pem', TEST_KEY_ID),
      (err) => err.code === 'SIGNING_KEY_INVALID',
    );
  });

  it('reads from FORGE_SIGNING_KEY env var when no key argument', () => {
    const saved = process.env.FORGE_SIGNING_KEY;
    process.env.FORGE_SIGNING_KEY = TEST_PRIVATE_KEY;
    try {
      const { signature, key_id } = signReceipt(payload);
      assert.ok(signature.startsWith('ed25519:'));
      const valid = verifySignature(payload, signature, TEST_PUBLIC_KEY);
      assert.equal(valid, true);
    } finally {
      if (saved !== undefined) {
        process.env.FORGE_SIGNING_KEY = saved;
      } else {
        delete process.env.FORGE_SIGNING_KEY;
      }
    }
  });

  it('deterministic: same payload + key produces same signature', () => {
    const { signature: sig1 } = signReceipt(payload, TEST_PRIVATE_KEY, TEST_KEY_ID);
    const { signature: sig2 } = signReceipt(payload, TEST_PRIVATE_KEY, TEST_KEY_ID);
    assert.equal(sig1, sig2, 'ed25519 signatures should be deterministic');
  });
});

describe('verifySignature', () => {
  it('returns false for null signature', () => {
    assert.equal(verifySignature('payload', null, TEST_PUBLIC_KEY), false);
  });

  it('returns false for non-ed25519 prefixed signature', () => {
    assert.equal(verifySignature('payload', 'rsa:abc', TEST_PUBLIC_KEY), false);
  });
});

// ─── loadKeyring / getPublicKey ────────────────────────────────────────────

describe('loadKeyring', () => {
  it('loads keyring and returns Map', () => {
    const keyring = loadKeyring('keys/forge-keyring.json');
    assert.ok(keyring instanceof Map);
    assert.ok(keyring.size >= 1, 'keyring should have at least one key');
  });

  it('keyring contains forge-test-001', () => {
    const keyring = loadKeyring('keys/forge-keyring.json');
    const entry = keyring.get('forge-test-001');
    assert.ok(entry, 'should have forge-test-001');
    assert.equal(entry.algorithm, 'ed25519');
    assert.equal(entry.environment, 'test');
  });

  it('throws KEYRING_NOT_FOUND for missing file', () => {
    assert.throws(
      () => loadKeyring('nonexistent/keyring.json'),
      (err) => err.code === 'KEYRING_NOT_FOUND',
    );
  });
});

describe('getPublicKey', () => {
  it('returns public key for forge-test-001', () => {
    const pubKey = getPublicKey('forge-test-001', 'keys/forge-keyring.json');
    assert.ok(pubKey, 'should return a key object');
    assert.equal(pubKey.asymmetricKeyType, 'ed25519');
  });

  it('throws KEY_ID_UNKNOWN for missing key_id', () => {
    assert.throws(
      () => getPublicKey('nonexistent-key', 'keys/forge-keyring.json'),
      (err) => err.code === 'KEY_ID_UNKNOWN',
    );
  });

  it('keyring key verifies test-signed payload', () => {
    const payload = canonicalize({ test: true });
    const { signature } = signReceipt(payload, TEST_PRIVATE_KEY, TEST_KEY_ID);
    const pubKey = getPublicKey(TEST_KEY_ID, 'keys/forge-keyring.json');
    const valid = verifySignature(payload, signature, pubKey);
    assert.equal(valid, true, 'keyring public key should verify test signature');
  });
});
