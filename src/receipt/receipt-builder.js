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
 * Receipt fields are grouped into attestation-aligned structures:
 *   - subject: output identity (digest of the envelope)
 *   - materials: input identity (digest + canonicalization of raw input)
 *   - policy: policy_hash, rule_set_hash, version_tag
 *   - builder: code identity (uri, git_sha, package_lock_sha, node_version)
 *   - predicateType: attestation type discriminator
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
  const inputDigest = sha256(canonicalInput);

  // 2. Hash the canonicalized envelope
  const canonicalEnvelope = canonicalize(envelope);
  const outputDigest = sha256(canonicalEnvelope);

  // 3. Policy hashes
  const { policy_hash, rule_set_hash, policy_version_tag } = computePolicyHash();

  // 4. Code identity
  const codeId = getCodeIdentity();

  // 5. Metadata timestamp (not in signed payload)
  const computed_at = new Date().toISOString();

  // 6. Assemble the receipt (pre-signature)
  const receipt = {
    schema: 'forge-receipt/v0',
    predicateType: 'https://forge.echelon.build/attestation/v0',
    subject: {
      digest: outputDigest,
      uri: null,
    },
    materials: {
      digest: inputDigest,
      canonicalization: 'jcs-subset/v0',
      uri: null,
    },
    policy: {
      policy_hash,
      rule_set_hash,
      version_tag: policy_version_tag,
    },
    builder: {
      uri: 'https://forge.echelon.build/builder/v0',
      git_sha: codeId.git_sha,
      package_lock_sha: codeId.package_lock_sha,
      node_version: codeId.node_version,
    },
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
      predicateType: receipt.predicateType,
      subject: receipt.subject,
      materials: receipt.materials,
      policy: receipt.policy,
      builder: receipt.builder,
      http_transcript_receipts: receipt.http_transcript_receipts,
      signer: receipt.signer,
    });
    const { signature, key_id } = sign(signedPayload);
    receipt.signature = signature;
    receipt.key_id = key_id;
  }

  return receipt;
}
