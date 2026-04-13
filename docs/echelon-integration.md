# Echelon Integration Path — ProposalReceipt Verification

## Overview

This document describes how Echelon's admission gate can consume and verify FORGE ProposalReceipts, and the future integration path for `echelon-verify`.

## Current State

FORGE produces ProposalReceipts via `emitEnvelope({ receipt: true, rawInput })` or `ForgeConstruct.analyze(path, { receipt: true })`. Receipts conform to `forge-receipt/v0` schema.

The standalone verifier `bin/forge-verify.js` demonstrates the verification workflow.

## Echelon Admission Gate Integration

When Echelon's admission gate receives a ProposalEnvelope with an accompanying receipt, it should:

### 1. Validate Receipt Schema
```javascript
assert(receipt.schema === 'forge-receipt/v0');
```

### 2. Verify Signature (if signed)
```javascript
import { verifySignature } from 'forge/src/receipt/sign.js';
import { getPublicKey } from 'forge/src/receipt/keyring.js';

const pubKey = getPublicKey(receipt.key_id);
const valid = verifySignature(signedPayload, receipt.signature, pubKey);
```

### 3. Verify Output Hash
```javascript
import { canonicalize } from 'forge/src/receipt/canonicalize.js';
import { sha256 } from 'forge/src/receipt/hash.js';

const envelopeHash = sha256(canonicalize(envelope));
assert(envelopeHash === receipt.subject.digest);
```

This confirms the envelope hasn't been tampered with since receipt generation.

### 4. Optional: Full Replay Verification
For high-assurance contexts, Echelon can replay the full FORGE pipeline:
```javascript
import { verifyReceipt } from 'forge/bin/forge-verify.js';

const result = verifyReceipt({ receipt, inputData });
assert(result.verdict === 'MATCH');
```

## Future: `echelon-verify forge` Subcommand

The standalone `forge-verify` CLI maps directly to a future Echelon subcommand:

```bash
# Current (standalone)
node bin/forge-verify.js receipt.json --input input.json

# Future (Echelon subcommand)
echelon-verify forge receipt.json --input input.json
```

The verification logic (`verifyReceipt()`) is exported as a function and can be imported directly by Echelon without running a subprocess.

## `http_transcript_receipts` Integration Point

The receipt schema reserves `http_transcript_receipts` (currently null at v0) for future chain-of-custody tracking:

```json
{
  "http_transcript_receipts": [
    {
      "url": "https://earthquake.usgs.gov/...",
      "method": "GET",
      "status": 200,
      "response_hash": "sha256:...",
      "timestamp": "2026-04-11T...",
      "tls_certificate_hash": "sha256:..."
    }
  ]
}
```

When populated, this will allow Echelon to verify not just that FORGE processed the data correctly, but that the data came from a trusted source via a verified HTTP connection.

## Verifier Result Codes

The verifier returns structured JSON suitable for programmatic consumption:

| Field | Type | Description |
|-------|------|-------------|
| `verdict` | string | `MATCH`, `MISMATCH`, or `ERROR` |
| `exit_code` | number | 0, 1, or 2 |
| `reason` | string/null | Human-readable explanation (null on MATCH) |
| `details.checks` | object | Per-check results (schema, input_hash, signature, output_hash) — keys are diagnostic labels, not receipt field names |
| `details.warnings` | array | Non-blocking warnings (e.g., node version mismatch) |

Echelon's admission gate can use `verdict` for accept/reject decisions and `details` for audit logging.
