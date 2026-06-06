/**
 * test/unit/bundle-conformance-posture.spec.js
 * S03-F conformance — deferred-field posture, provenance hash semantics, and
 * emitted_at_ms determinism (targets 5, 6, 7, 8).
 *
 *  - T5 (S03-E L2): SKILL.md `bundle_member_hash` is present-and-null; the
 *    authoritative SKILL.md digest lives in bundle-receipt.json::members[].
 *    Echelon parser null-compatibility remains a co-design follow-up (not asserted).
 *  - T6 (S03-E L3): reality.md per-entry `content_hash` is non-circular, `sha256:`
 *    prefixed, derived from the record's stable grounding fields (NOT the whole
 *    member bytes); the whole-member hash stays in the receipt.
 *  - T7 (S03-E L4): handoff.md `feed_id` is producer-authored / convention-based
 *    (not live-adapter verified) — asserted as a fixed convention value only.
 *  - T8 (S03-B/D LOW-2 → cycle-003 Lane 1): emitted_at_ms is a Unix-ms integer;
 *    identical pinned `now` is byte-deterministic; emitted_at_ms embedded in the
 *    manifest member changes the digest, while the receipt's scalar emitted_at_ms is
 *    outside the digest. No bare `emitted_at` key remains in emitted output.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { assembleBundle } from '../../src/bundle/assemble.js';
import { buildBundleReceipt } from '../../src/bundle/receipt.js';
import { authorBreathManifestParts } from '../../src/bundle/settlement.js';
import { sha256 } from '../../src/receipt/hash.js';
import { canonicalize } from '../../src/receipt/canonicalize.js';

const PINNED_NOW = 1735689600000;
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

const memberHash = (receipt, path) => receipt.members.find((m) => m.path === path).content_hash;
const extractContentHashes = (md) =>
  [...md.matchAll(/content_hash:\s*"(sha256:[0-9a-f]{64})"/g)].map((m) => m[1]);

// ── T5: bundle_member_hash present-and-null posture ───────────────────────────

describe('T5 — SKILL.md bundle_member_hash is present-and-null (deferred)', () => {
  it('SKILL.md frontmatter carries `bundle_member_hash: null`', () => {
    const { members } = breathFinal();
    assert.match(members['SKILL.md'], /bundle_member_hash: null/);
  });

  it('the authoritative SKILL.md digest lives in bundle-receipt.json::members[]', () => {
    const { receipt } = breathFinal();
    const skill = receipt.members.find((m) => m.path === 'SKILL.md');
    assert.ok(skill, 'receipt has a SKILL.md member entry');
    assert.match(skill.content_hash, /^sha256:[0-9a-f]{64}$/);
  });
});

// ── T6: reality.md per-entry content_hash semantics ───────────────────────────

describe('T6 — reality.md per-entry content_hash is non-circular and grounding-derived', () => {
  it('each per-entry content_hash is sha256-prefixed and the two entries differ', () => {
    const { members } = breathFinal();
    const hashes = extractContentHashes(members['reality.md']);
    assert.equal(hashes.length, 2, 'two parameter_provenance entries');
    for (const h of hashes) assert.match(h, /^sha256:[0-9a-f]{64}$/);
    assert.notEqual(hashes[0], hashes[1], 'per-entry (not whole-file) hashes differ');
  });

  it('entry hash is derived from the record grounding fields (recomputable; excludes content_hash)', () => {
    const { members } = breathFinal();
    const [h1, h2] = extractContentHashes(members['reality.md']);
    // Recompute over the record's OWN grounding fields only (canonicalize sorts keys,
    // so field order here is irrelevant). content_hash is NOT part of the input.
    const expected1 = sha256(
      canonicalize({
        parameter: 'aqi_threshold_gate.threshold',
        value: 151,
        source_side: 'forge',
        source_id: 'epa_airnow',
        derivation: 'regulatory',
        verification_status: 'verified',
      }),
    );
    const expected2 = sha256(
      canonicalize({
        parameter: 'aqi_threshold_gate.window_hours',
        value: 24,
        source_side: 'forge',
        source_id: 'epa_airnow',
        derivation: 'regulatory',
        verification_status: 'provisional',
      }),
    );
    assert.equal(h1, expected1);
    assert.equal(h2, expected2);
  });

  it('the per-entry hash is distinct from the whole reality.md member hash (non-circular)', () => {
    const { members, receipt } = breathFinal();
    const wholeMemberHash = memberHash(receipt, 'reality.md');
    const entryHashes = extractContentHashes(members['reality.md']);
    for (const h of entryHashes) {
      assert.notEqual(h, wholeMemberHash, 'entry content_hash != whole-member receipt hash');
    }
    assert.match(wholeMemberHash, /^sha256:[0-9a-f]{64}$/);
  });
});

// ── T7: feed_id provenance / convention framing ───────────────────────────────

describe('T7 — handoff.md feed_id is a producer-authored convention (not live-adapter)', () => {
  it('emits the convention feed_id value (no live-adapter verification implied)', () => {
    const { members } = breathFinal();
    // `epa_airnow_aqi` is producer-authored/convention-based until a generated BREATH
    // adapter mapping exists (S03-E L4); S03-F asserts the convention value only.
    assert.match(members['handoff.md'], /feed_id: "epa_airnow_aqi"/);
  });
});

// ── T8: emitted_at_ms determinism + digest behavior ───────────────────────────

describe('T8 — emitted_at_ms is Unix-ms integer; pinned-now determinism', () => {
  it('emitted_at_ms is a Unix-ms integer mirrored in manifest and receipt', () => {
    const b = breathFinal(PINNED_NOW);
    assert.ok(Number.isInteger(b.manifest.emitted_at_ms));
    assert.equal(b.manifest.emitted_at_ms, PINNED_NOW);
    assert.equal(b.receipt.emitted_at_ms, PINNED_NOW);
  });

  it('emitted_at_ms is the exact key; no bare `emitted_at` remains in emitted output (cycle-003 Lane 1)', () => {
    const { manifest, receipt, members } = breathFinal(PINNED_NOW);
    // Parsed-JSON key assertions — NOT substring (emitted_at_ms ⊃ emitted_at).
    assert.ok(Object.keys(manifest).includes('emitted_at_ms'));
    assert.ok(!Object.keys(manifest).includes('emitted_at'));
    assert.ok(Object.keys(receipt).includes('emitted_at_ms'));
    assert.ok(!Object.keys(receipt).includes('emitted_at'));
    // The on-disk serialized members carry the renamed key, never the bare old key.
    const manifestObj = JSON.parse(members['manifest.json']);
    assert.ok(Object.keys(manifestObj).includes('emitted_at_ms'));
    assert.ok(!Object.keys(manifestObj).includes('emitted_at'));
    const receiptObj = JSON.parse(members['bundle-receipt.json']);
    assert.ok(Object.keys(receiptObj).includes('emitted_at_ms'));
    assert.ok(!Object.keys(receiptObj).includes('emitted_at'));
  });

  it('identical pinned now ⇒ byte-identical bundle (members + digest)', () => {
    const a = breathFinal(PINNED_NOW);
    const b = breathFinal(PINNED_NOW);
    assert.deepEqual(a.members, b.members);
    assert.equal(a.receipt.bundle_digest, b.receipt.bundle_digest);
  });

  it('different now ⇒ different digest (emitted_at_ms embedded in the manifest member)', () => {
    const a = breathFinal(PINNED_NOW);
    const b = breathFinal(PINNED_NOW + 1);
    assert.notEqual(a.receipt.bundle_digest, b.receipt.bundle_digest);
    // The manifest member embeds emitted_at_ms, so its content_hash changes...
    assert.notEqual(memberHash(a.receipt, 'manifest.json'), memberHash(b.receipt, 'manifest.json'));
    // ...but the markdown members do NOT contain emitted_at_ms, so they are invariant.
    for (const path of ['SKILL.md', 'reality.md', 'handoff.md']) {
      assert.equal(memberHash(a.receipt, path), memberHash(b.receipt, path), `${path} hash stable across now`);
    }
    assert.notEqual(a.receipt.emitted_at_ms, b.receipt.emitted_at_ms);
  });

  it('content-addressing: identical members + different emittedAtMs ⇒ same bundle_digest (S03-D A5)', () => {
    // The receipt's scalar emitted_at_ms is OUTSIDE the digest (the digest is over
    // members[] only). With identical member content, the digest is invariant to
    // the receipt's own emitted_at_ms field.
    const memberContent = { 'manifest.json': 'a', 'SKILL.md': 'b', 'reality.md': 'c', 'handoff.md': 'd' };
    const common = { memberContent, bundleSchemaVersion: '0.1.0', constructSlug: 'breath', constructVersion: '0.1.0' };
    const r1 = buildBundleReceipt({ ...common, emittedAtMs: 1 });
    const r2 = buildBundleReceipt({ ...common, emittedAtMs: 2 });
    assert.equal(r1.bundle_digest, r2.bundle_digest);
    assert.notEqual(r1.emitted_at_ms, r2.emitted_at_ms);
  });
});
