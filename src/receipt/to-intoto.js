/**
 * src/receipt/to-intoto.js
 * Pure-function converter: FORGE ProposalReceipt → in-toto Statement v1.
 *
 * This is a separate utility, not in the receipt's critical path.
 * It maps FORGE's attestation-aligned receipt fields to the standard
 * in-toto Statement v1 JSON shape for interoperability.
 *
 * @module receipt/to-intoto
 */

/**
 * Convert a FORGE ProposalReceipt to a valid in-toto Statement v1 JSON object.
 *
 * @param {Object} receipt - ProposalReceipt conforming to spec/receipt-v0.json
 * @returns {Object} in-toto Statement v1 JSON
 * @throws {TypeError} If receipt is missing required fields (subject, materials, builder)
 */
export function toInTotoStatement(receipt) {
  if (!receipt || !receipt.subject || !receipt.materials || !receipt.builder) {
    throw new TypeError('toInTotoStatement: receipt must have subject, materials, and builder');
  }
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{
      name: receipt.subject.uri ?? 'forge-output',
      digest: { sha256: receipt.subject.digest.replace('sha256:', '') },
    }],
    predicateType: receipt.predicateType,
    predicate: {
      builder: { id: receipt.builder.uri },
      metadata: {
        buildInvocationId: receipt.builder.git_sha,
        completeness: { parameters: true, environment: false, materials: true },
      },
      materials: [{
        uri: receipt.materials.uri ?? 'forge-input',
        digest: { sha256: receipt.materials.digest.replace('sha256:', '') },
      }],
      policy: {
        policy_hash: receipt.policy.policy_hash,
        rule_set_hash: receipt.policy.rule_set_hash,
        version_tag: receipt.policy.version_tag,
      },
    },
  };
}
