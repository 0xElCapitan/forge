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
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { assembleBundle } from '../../src/bundle/assemble.js';
import { buildBundleReceipt } from '../../src/bundle/receipt.js';
import { authorBreathManifestParts, assertAuthoredOracleSettlement } from '../../src/bundle/settlement.js';
import { assertFeedId, FEED_ID_GRAMMAR } from '../../src/bundle/markdown-members.js';
import { RECEIPT_AUTHENTICITY_FIELDS, CONSTRUCT_SOURCE_REF_FIELD } from '../../src/bundle/index.js';
import { TRUST_TIER } from '../../src/bundle/enums.js';
import { getTrustTier } from '../../src/trust/oracle-trust.js';
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

// ── T2.4: feed_id grammar (cycle-003 Sprint 02) ───────────────────────────────
//
// BREATH still emits the convention feed_id epa_airnow_aqi; the value is extracted
// from handoff.md and validated as a VALUE (not asserted by bare substring
// presence), and assertFeedId rejects a non-conforming id.

const extractFeedId = (handoffMd) => {
  const m = handoffMd.match(/feed_id: "([^"]+)"/);
  return m ? m[1] : null;
};

describe('S02 T2.4 — feed_id grammar', () => {
  it('BREATH handoff.md emits feed_id epa_airnow_aqi (value-extracted)', () => {
    const { members } = breathFinal();
    assert.equal(extractFeedId(members['handoff.md']), 'epa_airnow_aqi');
  });

  it('the emitted BREATH feed_id satisfies FEED_ID_GRAMMAR and passes assertFeedId', () => {
    const feedId = extractFeedId(breathFinal().members['handoff.md']);
    assert.ok(FEED_ID_GRAMMAR.test(feedId), 'matches ^[a-z0-9]+(_[a-z0-9]+)*$');
    assert.equal(assertFeedId(feedId), 'epa_airnow_aqi');
  });

  it('assertFeedId rejects non-conforming ids (uppercase, doubled/edge underscore, dash, empty, non-string)', () => {
    for (const bad of ['EPA_airnow', 'epa__airnow', '_epa', 'epa_', 'epa-airnow', 'epa airnow', 'epa.airnow', '']) {
      assert.throws(() => assertFeedId(bad), /invalid feed_id/, `should reject ${JSON.stringify(bad)}`);
    }
    assert.throws(() => assertFeedId(42), /invalid feed_id/);
    assert.throws(() => assertFeedId(null), /invalid feed_id/);
    assert.throws(() => assertFeedId(undefined), /invalid feed_id/);
  });
});

// ── T2.5: receiving-alignment no-change postures (cycle-003 Sprint 02) ─────────
//
// Assertion/record work only — NO new schema keys for calibration_ref or
// composed_trust are added; these confirm the Lane-4 postures still hold post-S01.

describe('S02 T2.5 — receiving-alignment no-change postures', () => {
  it('SKILL.md bundle_member_hash stays present-and-null (never a populated digest)', () => {
    const skill = breathFinal().members['SKILL.md'];
    assert.ok(skill.includes('bundle_member_hash: null'), 'present-and-null');
    assert.ok(!skill.includes('bundle_member_hash: "sha256:'), 'not populated (quoted)');
    assert.ok(!skill.includes('bundle_member_hash: sha256:'), 'not populated (bare)');
  });

  it('manifest.calibration_ref stays present-and-null (no §12 pointer emitted)', () => {
    const { manifest, members } = breathFinal();
    assert.ok('calibration_ref' in manifest, 'present in object');
    assert.equal(manifest.calibration_ref, null, 'null in object');
    const onDisk = JSON.parse(members['manifest.json']);
    assert.ok('calibration_ref' in onDisk, 'present on disk');
    assert.equal(onDisk.calibration_ref, null, 'null on disk');
  });

  it('construct_source_ref remains a distinct dual-axis field on each oracle declaration', () => {
    const decls = breathFinal().manifest.oracle_declarations;
    assert.ok(Array.isArray(decls) && decls.length >= 1);
    for (const d of decls) {
      // Two distinct identity axes: the tier-resolving TRUST_REGISTRY source_id and
      // the provenance-only construct-local construct_source_ref. They co-exist and differ.
      assert.ok(CONSTRUCT_SOURCE_REF_FIELD in d, 'construct_source_ref present');
      assert.equal(typeof d.source_id, 'string');
      assert.equal(typeof d.construct_source_ref, 'string');
      assert.notEqual(d.source_id, d.construct_source_ref, 'axes are not collapsed');
    }
    const byCanonical = Object.fromEntries(decls.map((d) => [d.source_id, d.construct_source_ref]));
    assert.equal(byCanonical.airnow, 'epa_airnow');
    assert.equal(byCanonical.purpleair, 'purpleair_sensor');
  });

  it('no signature is built: the four receipt authenticity fields are present-and-null', () => {
    // The ed25519:<base64> signature encoding is pinned in src/receipt/sign.js (format-only
    // checks live in sign.spec.js); the bundle PRODUCES no signature, so all four
    // publisher-authenticity fields stay present-and-null here.
    const { receipt, members } = breathFinal();
    const onDisk = JSON.parse(members['bundle-receipt.json']);
    for (const field of RECEIPT_AUTHENTICITY_FIELDS) {
      assert.ok(field in receipt, `${field} present in object`);
      assert.equal(receipt[field], null, `${field} null in object`);
      assert.ok(field in onDisk, `${field} present on disk`);
      assert.equal(onDisk[field], null, `${field} null on disk`);
    }
  });

  it('no cert / scoring / composed_trust advisory keys are emitted in the manifest or receipt', () => {
    // Light posture check (the comprehensive composed_trust do-not-emit suite is Sprint 05).
    const { manifest, receipt } = breathFinal();
    for (const obj of [manifest, receipt]) {
      const keys = Object.keys(obj);
      assert.ok(!keys.includes('composed_trust'), 'no composed_trust');
      assert.ok(!keys.includes('scoring'), 'no scoring');
      assert.ok(!keys.includes('cert'), 'no cert');
    }
  });
});

// ── T2.7: bundle_schema_version aligns to Echelon receiving-contract 1.0.0 ─────
//
// bundle_schema_version moves 0.1.0 → 1.0.0 (adopting the Echelon receiving-contract
// version). It is an INDEPENDENT version domain from ir_version: the bundle manifest
// ir_version stays 0.2.0, and there is deliberately NO equality assertion coupling the
// bundle manifest ir_version to the ProposalEnvelope ir_version (0.3.0, asserted in
// ir.spec.js) — the F1/#200 seam: encode independence, not equality.

describe('S02 T2.7 — bundle_schema_version aligns to receiving-contract 1.0.0', () => {
  it('emitted manifest carries bundle_schema_version "1.0.0" (object + on disk)', () => {
    const { manifest, members } = breathFinal();
    assert.equal(manifest.bundle_schema_version, '1.0.0');
    assert.equal(JSON.parse(members['manifest.json']).bundle_schema_version, '1.0.0');
  });

  it('emitted manifest ir_version remains "0.2.0" (unchanged by the schema-version bump)', () => {
    const { manifest, members } = breathFinal();
    assert.equal(manifest.ir_version, '0.2.0');
    assert.equal(JSON.parse(members['manifest.json']).ir_version, '0.2.0');
  });

  it('bundle_schema_version and ir_version are independent domains (different values, no equality lock)', () => {
    const { manifest } = breathFinal();
    // The two version fields carry different values and nothing couples them. This is
    // the (a)+(b)-not-(c) encoding: independence is asserted; equality is NOT.
    assert.notEqual(manifest.bundle_schema_version, manifest.ir_version);
    assert.equal(manifest.bundle_schema_version, '1.0.0');
    assert.equal(manifest.ir_version, '0.2.0');
  });

  it('the receipt mirrors bundle_schema_version 1.0.0', () => {
    assert.equal(breathFinal().receipt.bundle_schema_version, '1.0.0');
  });

  it('bundle_digest re-baselines deliberately: only manifest.json moves; markdown member hashes stay stable', () => {
    // The schema-version value lives inside the manifest.json member, so bumping it moves
    // the manifest member hash and therefore the aggregate bundle_digest. The three
    // markdown members carry no version field and stay byte-stable. (Absolute digest
    // values are recorded in the Sprint-02 implementation report, not pinned here.)
    const oldSchema = assembleBundle({
      constructSlug: 'breath',
      constructVersion: '0.1.0',
      capabilityFlags: ['binary_resolution'],
      oracleDeclarations,
      settlementAuthority,
      final: true,
      bundleSchemaVersion: '0.1.0',
      now: PINNED_NOW,
    });
    const newSchema = breathFinal(); // default is now 1.0.0
    assert.notEqual(
      memberHash(oldSchema.receipt, 'manifest.json'),
      memberHash(newSchema.receipt, 'manifest.json'),
      'manifest.json member hash moves with the schema version',
    );
    assert.notEqual(
      oldSchema.receipt.bundle_digest,
      newSchema.receipt.bundle_digest,
      'bundle_digest re-baselines',
    );
    for (const path of ['SKILL.md', 'reality.md', 'handoff.md']) {
      assert.equal(
        memberHash(oldSchema.receipt, path),
        memberHash(newSchema.receipt, path),
        `${path} hash stable across the schema bump`,
      );
    }
  });
});

// ── S03 CF-8: settlement trust-tier guard hardening (cycle-003 Sprint 03) ─────
//
// assertAuthoredOracleSettlement must fail closed on a non-string / non-enum
// trust_tier — including {trust_tier: Object.prototype} (AC-7) and prototype-key
// source_ids (__proto__ / constructor / prototype), which getTrustTier resolves to
// a non-string via its plain-object registry (oracle-trust.js:89-92). This mirrors
// the authoring-side guard in oracles.js:94-99. An Echelon-owned trust/admission
// token must never be smuggled in as accepted settlement trust. No runtime/CLI
// entrypoint is added (the gate returns void; it emits nothing).

describe('S03 CF-8 — assertAuthoredOracleSettlement non-string/non-enum trust_tier guard', () => {
  const forgeOracle = (overrides = {}) => ({
    source_id: 'airnow',
    construct_source_ref: 'epa_airnow',
    source_side: 'forge',
    trust_tier: 'T1',
    authority_ref: null,
    role: 'settlement',
    ...overrides,
  });
  const forgeSettlement = (overrides = {}) => ({
    settling_source_id: 'airnow',
    source_side: 'forge',
    declared_trust_tier: 'T1',
    authority_ref: null,
    ...overrides,
  });

  it('the valid BREATH worked path still passes the gate (no behavior change)', () => {
    const { oracleDeclarations: decls, settlementAuthority: sa } = authorBreathManifestParts();
    assert.doesNotThrow(() => assertAuthoredOracleSettlement(decls, sa));
  });

  it('rejects a forge oracle whose source_id is the prototype key "__proto__"', () => {
    // getTrustTier('__proto__') returns Object.prototype — a non-string.
    assert.notEqual(typeof getTrustTier('__proto__'), 'string');
    assert.throws(
      () =>
        assertAuthoredOracleSettlement(
          [forgeOracle({ source_id: '__proto__' })],
          forgeSettlement({ settling_source_id: '__proto__' }),
        ),
      /non-string \/ non-enum trust_tier|CF-8/,
    );
  });

  it('rejects a forge oracle whose source_id is "constructor"', () => {
    assert.notEqual(typeof getTrustTier('constructor'), 'string');
    assert.throws(
      () =>
        assertAuthoredOracleSettlement(
          [forgeOracle({ source_id: 'constructor' })],
          forgeSettlement({ settling_source_id: 'constructor' }),
        ),
      /non-string \/ non-enum trust_tier|CF-8/,
    );
  });

  it('rejects a forge oracle whose source_id is "prototype" (resolves to unknown → rejected)', () => {
    // 'prototype' is not a data property of the registry, so getTrustTier returns the
    // string 'unknown'; the existing unknown check rejects it — still fail-closed.
    assert.throws(
      () =>
        assertAuthoredOracleSettlement(
          [forgeOracle({ source_id: 'prototype' })],
          forgeSettlement({ settling_source_id: 'prototype' }),
        ),
      /not a TRUST_REGISTRY key|unknown|non-string \/ non-enum/,
    );
  });

  it('rejects a forge settlement whose declared_trust_tier is Object.prototype (non-string)', () => {
    assert.throws(
      () => assertAuthoredOracleSettlement([forgeOracle()], forgeSettlement({ declared_trust_tier: Object.prototype })),
      /non-string \/ non-enum|CF-8/,
    );
  });

  it('rejects a forge settlement carrying an Echelon-owned admission state as trust (non-enum string)', () => {
    // 'signal_initiated' is an Echelon provenance/admission token, NOT a FORGE
    // TRUST_TIER value; it must fail closed rather than be accepted as settlement trust.
    assert.ok(!TRUST_TIER.includes('signal_initiated'));
    assert.throws(
      () => assertAuthoredOracleSettlement([forgeOracle()], forgeSettlement({ declared_trust_tier: 'signal_initiated' })),
      /non-string \/ non-enum|CF-8/,
    );
  });

  it('still routes a valid-enum non-settling tier (T2) through the existing canSettle check', () => {
    // The new guard does NOT intercept valid enum members; T2 is a real tier that
    // simply cannot settle, so it falls through to the pre-existing canSettle rejection.
    assert.ok(TRUST_TIER.includes('T2'));
    assert.throws(
      () => assertAuthoredOracleSettlement([forgeOracle()], forgeSettlement({ declared_trust_tier: 'T2' })),
      /is not T0\/T1|canSettle/,
    );
  });

  it('the guard only throws / returns void — it emits no composed_trust / scoring / cert field', () => {
    const { oracleDeclarations: decls, settlementAuthority: sa } = authorBreathManifestParts();
    const result = assertAuthoredOracleSettlement(decls, sa);
    assert.equal(result, undefined, 'gate returns void — emits no advisory/scoring/cert object');
    for (const obj of [...decls, sa]) {
      const keys = Object.keys(obj);
      for (const forbidden of ['composed_trust', 'scoring', 'cert', 'can_settle', 'settlement_risk', 'risk_flags']) {
        assert.ok(!keys.includes(forbidden), `no ${forbidden} field emitted`);
      }
    }
  });
});

// ── S03 T3.4: no runtime / no CLI exposure added by CF-8/CF-9 (Sprint 03) ─────
//
// CF-8/CF-9 are preconditions only (PRD §5; operator instruction 8; NFR-BOUNDARY).
// Sprint 03 adds NO runtime/CLI surface. These checks are path-aware (walk
// src/bundle/, inspect the module export surface), not vague substring sweeps.

describe('S03 T3.4 — no runtime / no CLI exposure', () => {
  const bundleDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'bundle');
  const bundleJs = readdirSync(bundleDir).filter((f) => f.endsWith('.js'));

  it('found the src/bundle/ producer files', () => {
    assert.ok(bundleJs.length >= 12, `expected >=12 src/bundle .js files, found ${bundleJs.length}`);
  });

  it('no src/bundle/ file declares a CLI / runtime entrypoint surface', () => {
    // Each pattern is an exposure surface CF-8/CF-9 explicitly do NOT add.
    const ENTRYPOINT_PATTERNS = [
      { re: /^#!\s*\/\S*\b(?:node|env)\b/m, name: 'shebang' },
      { re: /\bprocess\.argv\b/, name: 'process.argv' },
      { re: /\bprocess\.exit\s*\(/, name: 'process.exit(' },
      { re: /\bimport\.meta\.main\b/, name: 'import.meta.main' },
      { re: /\brequire\.main\s*===\s*module\b/, name: 'require.main === module' },
    ];
    const offenders = [];
    for (const f of bundleJs) {
      const content = readFileSync(join(bundleDir, f), 'utf8');
      for (const { re, name } of ENTRYPOINT_PATTERNS) {
        if (re.test(content)) offenders.push(`${f}: ${name}`);
      }
    }
    assert.deepEqual(offenders, [], `src/bundle/ must expose no CLI/runtime entrypoint; found: ${offenders.join(', ')}`);
  });

  it('settlement.js exports exactly the producer-authoring surface (no runner / main / parser export)', async () => {
    const mod = await import('../../src/bundle/settlement.js');
    assert.deepEqual(Object.keys(mod).sort(), [
      'assertAuthoredOracleSettlement',
      'authorBreathManifestParts',
      'authorSettlementAuthority',
      'canonicalizeSettlementSource',
    ]);
    for (const name of Object.keys(mod)) assert.equal(typeof mod[name], 'function');
  });
});

// ── S03 T3.5: Sprint 01 / Sprint 02 invariant sentinel (cycle-003 Sprint 03) ──
//
// CF-8/CF-9 are pure hardening and must not move any already-landed invariant.
// This is a thin S03 anchor; the authoritative coverage lives in ir.spec.js,
// jcs-parity.spec.js, and the T8 / S02 blocks above.

describe('S03 T3.5 — Sprint 01/02 invariants survive CF-8/CF-9 hardening', () => {
  it('manifest ir_version stays 0.2.0 and bundle_schema_version stays 1.0.0', () => {
    const { manifest } = breathFinal();
    assert.equal(manifest.ir_version, '0.2.0');
    assert.equal(manifest.bundle_schema_version, '1.0.0');
  });

  it('emitted_at_ms remains the timestamp key (no bare emitted_at) in manifest and receipt', () => {
    const { manifest, receipt } = breathFinal(PINNED_NOW);
    assert.ok(Object.keys(manifest).includes('emitted_at_ms'));
    assert.ok(!Object.keys(manifest).includes('emitted_at'));
    assert.equal(receipt.emitted_at_ms, PINNED_NOW);
  });

  it('BREATH feed_id remains epa_airnow_aqi and passes the grammar', () => {
    const feedId = extractFeedId(breathFinal().members['handoff.md']);
    assert.equal(feedId, 'epa_airnow_aqi');
    assert.ok(FEED_ID_GRAMMAR.test(feedId));
  });
});
