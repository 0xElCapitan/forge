# Artifact Retention Policy — FORGE ProposalReceipts

## Overview

ProposalReceipts enable independent verification that a FORGE proposal envelope was produced from specific inputs under a specific policy and code version. For this verification to work, the relevant artifacts must be retained.

## What Must Be Retained

| Artifact | Retention Owner | Storage | Retention Window |
|----------|----------------|---------|-----------------|
| Input data (raw JSON) | Caller | Caller's storage | 90 days minimum |
| ProposalReceipt | Caller | Caller's storage (alongside envelope) | 90 days minimum |
| ProposalEnvelope | Caller | Caller's storage | 90 days minimum |
| Code at committed SHA | FORGE maintainers | Git repository | Indefinite (standard git) |
| Policy rules (RULES array) | FORGE maintainers | Git repository (`src/selector/rules.js`) | Indefinite (standard git) |
| Regulatory JSON files | FORGE maintainers | Git repository (`src/selector/regulatory-*.json`) | Indefinite (standard git) |
| Public keyring | FORGE maintainers | Git repository (`keys/forge-keyring.json`) | Indefinite (standard git) |

## 90-Day Minimum Window

The recommended minimum retention window for caller-owned artifacts is **90 days**. This covers:

- Typical audit cycles (30-60 days)
- Incident investigation windows
- Regulatory review periods for environmental and seismic data

Callers may extend retention beyond 90 days based on their compliance requirements.

## Git-Retained Artifacts

The following artifacts are available at any committed SHA via standard git operations:

- **Code version**: `git checkout <git_sha>` recovers the exact code that produced the receipt
- **Policy rules**: `src/selector/rules.js` is versioned in git
- **Regulatory data**: `src/selector/regulatory-*.json` files are versioned in git
- **Public keyring**: `keys/forge-keyring.json` is versioned in git

The receipt's `code_version.git_sha` field points to the exact commit. The `policy_hash` and `rule_set_hash` fields allow verification that the policy hasn't changed.

## Caller-Retained Artifacts

These artifacts are the caller's responsibility:

- **Input data**: The raw pre-ingest JSON payload. The receipt's `materials.digest` can verify integrity but cannot reconstruct the data.
- **Receipts**: The ProposalReceipt JSON. Without it, there's no proof of provenance.
- **Envelopes**: The ProposalEnvelope JSON. The receipt's `subject.digest` can verify integrity.

### Storage Recommendations

- Store receipts alongside their envelopes (e.g., same directory, same database row)
- Store input data with a reference to the receipt that covers it
- Use content-addressable storage if available (the hashes are already computed)

## Replay Verification

Within the retention window, any retained receipt can be verified:

```bash
node bin/forge-verify.js receipt.json --input original-input.json
```

This replays the FORGE pipeline and compares the output hash. A MATCH confirms the receipt is genuine.

## Beyond the Retention Window

After the retention window, input data may be deleted. The receipt remains valid as a cryptographic proof but can no longer be independently replayed without the input data. The signature (if present) still proves the receipt was issued by a trusted signer.
