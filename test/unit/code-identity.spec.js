/**
 * test/unit/code-identity.spec.js
 * Tests for the code identity triple.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getCodeIdentity } from '../../src/receipt/code-identity.js';

describe('getCodeIdentity', () => {
  it('returns git_sha as a 40-character hex string', () => {
    const { git_sha } = getCodeIdentity();
    // Running in a git repo, so git_sha should be present
    assert.ok(git_sha !== null, 'git_sha should not be null in a git repo');
    assert.equal(git_sha.length, 40, 'git_sha must be 40 hex characters');
    assert.match(git_sha, /^[0-9a-f]{40}$/, 'git_sha must be valid hex');
  });

  it('package_lock_sha is null (v0 zero-dep posture)', () => {
    const { package_lock_sha } = getCodeIdentity();
    assert.equal(package_lock_sha, null);
  });

  it('node_version matches process.version without "v" prefix', () => {
    const { node_version } = getCodeIdentity();
    assert.equal(node_version, process.version.replace(/^v/, ''));
    assert.ok(!node_version.startsWith('v'), 'node_version should not have v prefix');
  });

  it('returns consistent results across calls', () => {
    const a = getCodeIdentity();
    const b = getCodeIdentity();
    assert.equal(a.git_sha, b.git_sha);
    assert.equal(a.node_version, b.node_version);
    assert.equal(a.package_lock_sha, b.package_lock_sha);
  });
});
