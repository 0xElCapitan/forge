/**
 * src/receipt/code-identity.js
 * Code identity triple for the ProposalReceipt.
 *
 * @module receipt/code-identity
 */

import { execSync } from 'node:child_process';

/**
 * Get the current code identity triple.
 *
 * @returns {{ git_sha: string|null, package_lock_sha: null, node_version: string }}
 */
export function getCodeIdentity() {
  let git_sha = null;
  try {
    git_sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    // Not in a git repo or git not available — return null
  }

  return {
    git_sha,
    package_lock_sha: null, // v0: zero-dep posture
    node_version: process.version.replace(/^v/, ''),
  };
}
