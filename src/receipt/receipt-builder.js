/**
 * src/receipt/receipt-builder.js
 * Orchestrates all receipt modules to build a complete ProposalReceipt.
 *
 * @module receipt/receipt-builder
 */

import { canonicalize } from './canonicalize.js';
import { sha256 } from './hash.js';
import { computePolicyHash } from './policy-hasher.js';
import { getCodeIdentity } from './code-identity.js';

/**
 * Build a ProposalReceipt from raw input and a proposal envelope.
 *
 * @param {Object} opts
 * @param {any}      opts.rawInput      - Raw pre-ingest input payload
 * @param {Object}   opts.envelope      - Proposal IR envelope from emitEnvelope()
 * @param {string}   [opts.signerName='forge-production'] - Signer identity
 * @param {Function} [opts.sign]        - Signing function: (canonicalPayload) => { signature, key_id }.
 *                   Defaults to no-op (null signature). Real signing wired in Sprint 5.
 * @returns {Object} ProposalReceipt conforming to spec/receipt-v0.json
 */
export function buildReceipt({
  rawInput,
  envelope,
  signerName = 'forge-production',
  sign = null,
}) {
  // 1. Hash the canonicalized raw input
  const canonicalInput = canonicalize(rawInput);
  const input_hash = sha256(canonicalInput);

  // 2. Hash the canonicalized envelope
  const canonicalEnvelope = canonicalize(envelope);
  const output_hash = sha256(canonicalEnvelope);

  // 3. Policy hashes
  const { policy_hash, rule_set_hash, policy_version_tag } = computePolicyHash();

  // 4. Code identity
  const code_version = getCodeIdentity();

  // 5. Metadata timestamp (not in signed payload)
  const computed_at = new Date().toISOString();

  // 6. Assemble the receipt (pre-signature)
  const receipt = {
    schema: 'forge-receipt/v0',
    input_hash,
    input_canonicalization: 'jcs-subset/v0',
    code_version,
    policy_hash,
    rule_set_hash,
    policy_version_tag,
    output_hash,
    computed_at,
    http_transcript_receipts: null,
    signer: signerName,
    key_id: null,
    signature: null,
  };

  // 7. Sign if a sign function is provided
  if (sign) {
    // Build the signed payload (excludes computed_at — it's metadata only)
    const signedPayload = canonicalize({
      schema: receipt.schema,
      input_hash: receipt.input_hash,
      input_canonicalization: receipt.input_canonicalization,
      code_version: receipt.code_version,
      policy_hash: receipt.policy_hash,
      rule_set_hash: receipt.rule_set_hash,
      policy_version_tag: receipt.policy_version_tag,
      output_hash: receipt.output_hash,
      http_transcript_receipts: receipt.http_transcript_receipts,
      signer: receipt.signer,
    });
    const { signature, key_id } = sign(signedPayload);
    receipt.signature = signature;
    receipt.key_id = key_id;
  }

  return receipt;
}
