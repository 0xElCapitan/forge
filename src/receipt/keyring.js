/**
 * src/receipt/keyring.js
 * Public keyring loader for receipt signature verification.
 *
 * The keyring stores public keys used to verify receipt signatures.
 * Private keys are never in the keyring — they come from env vars.
 *
 * @module receipt/keyring
 */

import { readFileSync } from 'node:fs';
import { createPublicKey } from 'node:crypto';

const DEFAULT_KEYRING_PATH = 'keys/forge-keyring.json';

/**
 * Load the public keyring from disk.
 *
 * @param {string} [keyringPath] - Path to keyring JSON file
 * @returns {Map<string, { publicKey: import('node:crypto').KeyObject, algorithm: string, added: string, environment: string }>}
 * @throws {Error} KEYRING_NOT_FOUND if file doesn't exist
 */
export function loadKeyring(keyringPath) {
  const path = keyringPath ?? DEFAULT_KEYRING_PATH;
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    const err = new Error(`Keyring not found at ${path}`);
    err.code = 'KEYRING_NOT_FOUND';
    throw err;
  }

  const data = JSON.parse(raw);
  const keyring = new Map();

  for (const entry of data.keys) {
    const publicKey = createPublicKey(entry.public_key);
    keyring.set(entry.key_id, {
      publicKey,
      algorithm: entry.algorithm,
      added: entry.added,
      environment: entry.environment ?? 'unknown',
    });
  }

  return keyring;
}

/**
 * Get a single public key by key_id from the keyring.
 *
 * @param {string} keyId - Key identifier to look up
 * @param {string} [keyringPath] - Path to keyring JSON file
 * @returns {import('node:crypto').KeyObject} Public key
 * @throws {Error} KEY_ID_UNKNOWN if key_id not in keyring
 * @throws {Error} KEYRING_NOT_FOUND if keyring file missing
 */
export function getPublicKey(keyId, keyringPath) {
  const keyring = loadKeyring(keyringPath);
  const entry = keyring.get(keyId);
  if (!entry) {
    const err = new Error(`Unknown key_id: ${keyId}`);
    err.code = 'KEY_ID_UNKNOWN';
    throw err;
  }
  return entry.publicKey;
}
