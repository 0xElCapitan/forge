/**
 * src/receipt/hash.js
 * SHA-256 hash utility with algorithm-prefixed output.
 *
 * @module receipt/hash
 */

import { createHash } from 'node:crypto';

/**
 * Compute SHA-256 digest of the input, returned as an algorithm-prefixed
 * hex string: `"sha256:<64 hex chars>"`.
 *
 * @param {string|Buffer} data - Data to hash
 * @returns {string} Algorithm-prefixed hex digest (e.g., "sha256:e3b0c44...")
 */
export function sha256(data) {
  const digest = createHash('sha256').update(data).digest('hex');
  return `sha256:${digest}`;
}
