/**
 * src/receipt/sign.js
 * ed25519 receipt signing and verification.
 *
 * Fail-closed design: signReceipt() throws if no signing key is available.
 * Signature format: "ed25519:" prefixed base64.
 *
 * @module receipt/sign
 */

import { sign, verify, createPrivateKey, createPublicKey } from 'node:crypto';

/**
 * Sign a canonical receipt payload using ed25519.
 *
 * @param {string} canonicalPayload - Canonical JSON string to sign
 * @param {string} [privateKeyPem] - PEM-encoded ed25519 private key.
 *   If omitted, reads from FORGE_SIGNING_KEY env var.
 * @param {string} [keyId] - Key identifier for the receipt.
 *   If omitted, reads from FORGE_KEY_ID env var (default: 'forge-production-001').
 * @returns {{ signature: string, key_id: string }}
 * @throws {Error} SIGNING_KEY_MISSING if no key is available
 * @throws {Error} SIGNING_KEY_INVALID if key format is wrong
 */
export function signReceipt(canonicalPayload, privateKeyPem, keyId) {
  const pem = privateKeyPem ?? process.env.FORGE_SIGNING_KEY;
  if (!pem) {
    const err = new Error('No signing key available. Set FORGE_SIGNING_KEY env var or pass privateKeyPem.');
    err.code = 'SIGNING_KEY_MISSING';
    throw err;
  }

  let privateKey;
  try {
    privateKey = createPrivateKey(pem);
  } catch (e) {
    const err = new Error(`Invalid signing key format: ${e.message}`);
    err.code = 'SIGNING_KEY_INVALID';
    throw err;
  }

  if (privateKey.asymmetricKeyType !== 'ed25519') {
    const err = new Error(`Expected ed25519 key, got ${privateKey.asymmetricKeyType}`);
    err.code = 'SIGNING_KEY_INVALID';
    throw err;
  }

  const sig = sign(null, Buffer.from(canonicalPayload, 'utf8'), privateKey);
  const key_id = keyId ?? process.env.FORGE_KEY_ID ?? 'forge-production-001';

  return {
    signature: `ed25519:${sig.toString('base64')}`,
    key_id,
  };
}

/**
 * Verify an ed25519 signature against a canonical payload.
 *
 * @param {string} canonicalPayload - Canonical JSON string that was signed
 * @param {string} signature - "ed25519:" prefixed base64 signature
 * @param {string|Buffer} publicKey - PEM-encoded ed25519 public key or KeyObject
 * @returns {boolean} true if signature is valid
 */
export function verifySignature(canonicalPayload, signature, publicKey) {
  if (!signature || !signature.startsWith('ed25519:')) {
    return false;
  }

  const sigBytes = Buffer.from(signature.slice('ed25519:'.length), 'base64');
  const pubKey = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;

  return verify(null, Buffer.from(canonicalPayload, 'utf8'), pubKey, sigBytes);
}
