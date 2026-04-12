# Key Management — FORGE Receipt Signing

## Overview

FORGE receipts are signed using ed25519 to prove that a specific code version produced a specific output from a specific input. This document covers key setup, rotation, and isolation.

## Key Format

- **Algorithm:** ed25519 (RFC 8032)
- **Private key:** PEM-encoded PKCS#8 (`-----BEGIN PRIVATE KEY-----`)
- **Public key:** PEM-encoded SPKI (`-----BEGIN PUBLIC KEY-----`)
- **Signature format:** `ed25519:` prefix + base64-encoded 64-byte signature

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FORGE_SIGNING_KEY` | Yes (production) | PEM-encoded ed25519 private key |
| `FORGE_KEY_ID` | No | Key identifier (default: `forge-production-001`) |

### Local Development

```bash
# Generate a dev key pair
node -e "
const { generateKeyPairSync } = require('node:crypto');
const kp = generateKeyPairSync('ed25519');
console.log(kp.privateKey.export({ type: 'pkcs8', format: 'pem' }));
" > /tmp/forge-dev-key.pem

export FORGE_SIGNING_KEY=$(cat /tmp/forge-dev-key.pem)
export FORGE_KEY_ID=forge-dev-001
```

### CI/CD

Set `FORGE_SIGNING_KEY` as a secret in your CI provider. Never log or echo this value.

### Production

Store the private key in your secrets manager (e.g., AWS Secrets Manager, Vault). Load it into the environment at runtime.

## Public Keyring

The public keyring at `keys/forge-keyring.json` contains public keys for signature verification. Private keys are never stored in the keyring.

```json
{
  "version": 1,
  "keys": [
    {
      "key_id": "forge-test-001",
      "algorithm": "ed25519",
      "public_key": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
      "added": "2026-04-11",
      "environment": "test"
    }
  ]
}
```

## Key Rotation

1. Generate a new ed25519 key pair
2. Add the new public key to `keys/forge-keyring.json` with a new `key_id`
3. Update `FORGE_SIGNING_KEY` and `FORGE_KEY_ID` in your environment
4. Old receipts remain verifiable — the old public key stays in the keyring
5. After confirming all systems use the new key, optionally mark old entries with `"retired": true`

## Test Key Isolation

- Test keys live in `fixtures/receipt-test-key.js` and are clearly marked "FOR TESTING ONLY"
- The keyring entry for `forge-test-001` has `"environment": "test"`
- Production code should reject `environment: "test"` keys in production contexts
- Never use test keys to sign production receipts

## Fail-Closed Design

`signReceipt()` throws `SIGNING_KEY_MISSING` if no key is available. This is intentional — unsigned receipts are permitted (signature/key_id = null), but a misconfigured signer that silently produces unsigned receipts is not.

To produce unsigned receipts, simply don't call `signReceipt()` (or don't pass a `sign` function to `buildReceipt()`).
