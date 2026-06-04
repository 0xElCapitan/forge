/**
 * test/unit/bundle-receipt-whitelist.spec.js
 * S03-F conformance — bundle-receipt.json member-set whitelist (target 1; carries
 * forward S03-D D-1 + S03-B review LOW-1).
 *
 * Regression coverage for the receipt member-set attacks the S03-D whitelist
 * (assertReceiptMemberSet) must reject BEFORE any content is hashed/digested
 * (fail-closed). Verifies the normal BREATH final output still emits EXACTLY the
 * four non-receipt members and that bundle_digest is deterministic.
 *
 * Scope: producer authoring safety only — NOT Echelon receiving-end validation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertReceiptMemberSet,
  buildBundleReceipt,
  RECEIPT_DIGEST_MEMBERS,
} from '../../src/bundle/receipt.js';
import { assembleBundle } from '../../src/bundle/assemble.js';
import { authorBreathManifestParts } from '../../src/bundle/settlement.js';
import { BUNDLE_RECEIPT_MEMBER } from '../../src/bundle/index.js';

const VALID = ['manifest.json', 'SKILL.md', 'reality.md', 'handoff.md'];
const PINNED_NOW = 1735689600000; // fixed Unix-ms for byte-deterministic assembly

// Adversarial member names constructed from char codes so the source stays pure
// ASCII (no invisible bytes): a real NUL byte, and a Cyrillic homoglyph.
const NULL_BYTE_NAME = 'handoff.md' + String.fromCharCode(0); // "handoff.md\x00"
const HOMOGLYPH_NAME = 'r' + String.fromCharCode(0x0435) + 'ality.md'; // Cyrillic "e"

describe('bundle/receipt — member-set whitelist (S03-D D-1)', () => {
  it('accepts EXACTLY the four non-receipt members', () => {
    assert.doesNotThrow(() => assertReceiptMemberSet([...VALID]));
    // the whitelist is derived from BUNDLE_MEMBERS minus the receipt itself
    assert.deepEqual([...RECEIPT_DIGEST_MEMBERS].sort(), [...VALID].sort());
  });

  it('rejects a MISSING member', () => {
    assert.throws(
      () => assertReceiptMemberSet(['manifest.json', 'SKILL.md', 'reality.md']),
      /missing member/,
    );
  });

  it('rejects an EXTRA member', () => {
    assert.throws(() => assertReceiptMemberSet([...VALID, 'extra.txt']), /unexpected member/);
  });

  it('rejects a DUPLICATE member', () => {
    assert.throws(() => assertReceiptMemberSet([...VALID, 'manifest.json']), /duplicate member/);
  });

  it('rejects a NESTED-path member name', () => {
    assert.throws(
      () => assertReceiptMemberSet(['manifest.json', 'SKILL.md', 'reality.md', 'sub/handoff.md']),
      /unsafe member name/,
    );
  });

  it('rejects a PATH-TRAVERSAL member name', () => {
    assert.throws(
      () => assertReceiptMemberSet(['manifest.json', 'SKILL.md', 'reality.md', '../handoff.md']),
      /unsafe member name/,
    );
  });

  it('rejects bundle-receipt.json appearing INSIDE members[]', () => {
    assert.throws(
      () => assertReceiptMemberSet(['manifest.json', 'SKILL.md', 'reality.md', BUNDLE_RECEIPT_MEMBER]),
      /MUST NOT appear in members/,
    );
  });

  // The whitelist is backed by a Set, so prototype-builtin keys are plain
  // non-members (no prototype-pollution surface) — rejected as "unexpected".
  it('rejects a "__proto__" member name', () => {
    assert.throws(
      () => assertReceiptMemberSet(['manifest.json', 'SKILL.md', 'reality.md', '__proto__']),
      /unexpected member/,
    );
  });

  it('rejects a "constructor" member name', () => {
    assert.throws(
      () => assertReceiptMemberSet(['manifest.json', 'SKILL.md', 'reality.md', 'constructor']),
      /unexpected member/,
    );
  });

  it('rejects a NULL-BYTE member name', () => {
    assert.throws(
      () => assertReceiptMemberSet(['manifest.json', 'SKILL.md', 'reality.md', NULL_BYTE_NAME]),
      /unexpected member/,
    );
  });

  it('rejects a UNICODE-LOOKALIKE member name (Cyrillic homoglyph)', () => {
    assert.throws(
      () => assertReceiptMemberSet(['manifest.json', 'SKILL.md', HOMOGLYPH_NAME, 'handoff.md']),
      /unexpected member/,
    );
  });

  it('rejects a non-array and non-string/empty member names', () => {
    assert.throws(() => assertReceiptMemberSet('manifest.json'), /must be provided as an array/);
    assert.throws(() => assertReceiptMemberSet([...VALID.slice(0, 3), '']), /non-empty string/);
    assert.throws(() => assertReceiptMemberSet([...VALID.slice(0, 3), 42]), /non-empty string/);
  });
});

describe('bundle/receipt — rejection happens BEFORE digesting (fail-closed)', () => {
  it('does not read (hash) any member value when the set is rejected', () => {
    // A getter on a member VALUE marks if it is ever read. buildReceiptMembers
    // inspects member NAMES (Object.keys) and runs assertReceiptMemberSet BEFORE
    // it reads any value for hashing — so an invalid set throws with no value read.
    let handoffValueAccessed = false;
    const memberContent = {
      'manifest.json': 'M',
      'SKILL.md': 'S',
      'reality.md': 'R',
    };
    Object.defineProperty(memberContent, 'handoff.md', {
      enumerable: true,
      configurable: true,
      get() {
        handoffValueAccessed = true;
        return 'H';
      },
    });
    memberContent['extra.md'] = 'X'; // invalid extra member → set rejected

    assert.throws(
      () =>
        buildBundleReceipt({
          memberContent,
          bundleSchemaVersion: '0.1.0',
          constructSlug: 'breath',
          constructVersion: '0.1.0',
          emittedAt: PINNED_NOW,
        }),
      /unexpected member/,
    );
    assert.equal(
      handoffValueAccessed,
      false,
      'member values must not be read/hashed when the member set is rejected (rejection precedes digesting)',
    );
  });
});

describe('bundle/receipt — normal BREATH final output', () => {
  const { oracleDeclarations, settlementAuthority } = authorBreathManifestParts();

  function breathFinal(now = PINNED_NOW) {
    return assembleBundle({
      constructSlug: 'breath',
      constructVersion: '0.1.0',
      capabilityFlags: ['binary_resolution'],
      oracleDeclarations,
      settlementAuthority,
      final: true,
      now,
    });
  }

  it('emits EXACTLY the four receipt members (receipt excluded)', () => {
    const { receipt } = breathFinal();
    assert.equal(receipt.members.length, 4);
    const paths = receipt.members.map((m) => m.path).sort();
    assert.deepEqual(paths, [...VALID].sort());
    assert.ok(!paths.includes(BUNDLE_RECEIPT_MEMBER), 'receipt never digests itself');
    for (const m of receipt.members) {
      assert.match(m.content_hash, /^sha256:[0-9a-f]{64}$/);
      assert.ok(Number.isInteger(m.size_bytes) && m.size_bytes > 0);
    }
    assert.match(receipt.bundle_digest, /^sha256:[0-9a-f]{64}$/);
  });

  it('bundle_digest is deterministic over identical pinned inputs', () => {
    const a = breathFinal(PINNED_NOW);
    const b = breathFinal(PINNED_NOW);
    assert.equal(a.receipt.bundle_digest, b.receipt.bundle_digest);
    assert.deepEqual(a.members, b.members);
  });
});
