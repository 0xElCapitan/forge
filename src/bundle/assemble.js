/**
 * src/bundle/assemble.js
 * ConstructAdmissionBundle producer — assembly skeleton + authoring seam (S03-B/S03-C).
 *
 * Assembles an in-memory, unsigned-but-receivable ConstructAdmissionBundle
 * skeleton from caller-supplied construct metadata, reusing the S03-A shape
 * constants (./index.js) and the existing zero-dependency receipt primitives
 * (sha256, canonicalize). Produces the five member strings plus the manifest and
 * receipt objects; performs NO disk I/O (that is emit.js's concern).
 *
 * SCOPE (FORGE cycle-002 / sprint-03 slices S03-B + S03-C): assembly skeleton + authoring seam.
 *   - emits the 9 REQUIRED manifest fields (SDD §6) + `calibration_ref: null`;
 *   - emits the four publisher-authenticity receipt fields PRESENT and `null`
 *     (OD-1) — produces and verifies NO signature; imports no signer/keyring;
 *   - delegates the bundle-receipt.json digest to ./receipt.js (S03-D): a
 *     whitelisted members[] (the four non-receipt files, REJECTED before digest if
 *     the set is not exact — D-1, carrying forward S03-B review LOW-1), per-member
 *     `sha256:` content_hash (D-2), and the `bundle_digest` over canonical-JSON of
 *     members[] sorted by path (D-3), reusing src/receipt/{hash,canonicalize}.js —
 *     no new hashing/canonicalization code;
 *   - DEFAULT assembly remains a labelled skeleton: `oracle_declarations[]` /
 *     `settlement_authority` are PLACEHOLDERS that fake NO trust-tier / settlement
 *     semantics (`*trust_tier: 'unknown'`). S03-C adds the authoring seam — callers
 *     pass authored values (see ./oracles.js + ./settlement.js) and set
 *     `final: true` to assemble a settlement-authority-conformant bundle; the
 *     `final` gate REJECTS the skeleton placeholders. The default skeleton is NOT
 *     final and NOT settlement-authority-conformant;
 *   - emits FULLY materialized SKILL.md / reality.md / handoff.md for the FINAL
 *     authored path (S03-E; see ./markdown-members.js); the default skeleton path
 *     keeps the MINIMAL schema-shaped skeleton-only placeholders;
 *   - builds NO validation / admission / parser logic — every "reject" remains
 *     Echelon's receiving-end machinery (SDD §1, §16);
 *   - is NOT imported by any live runtime path.
 *
 * NAMING: this is the SINGULAR producer module `src/bundle/` (one
 * ConstructAdmissionBundle). It is unrelated to the pre-existing PLURAL
 * `src/processor/bundles.js` (`buildBundle`, EvidenceBundle assembly) and never
 * imports it.
 *
 * @module bundle/assemble
 */

import { assertValidSlug } from './slug.js';
import { assertAuthoredOracleSettlement } from './settlement.js';
import { buildBundleReceipt } from './receipt.js';
import {
  materializeSkillMd,
  materializeRealityMd,
  materializeHandoffMd,
} from './markdown-members.js';
import {
  MANIFEST_MEMBER,
  SKILL_MEMBER,
  REALITY_MEMBER,
  HANDOFF_MEMBER,
  BUNDLE_RECEIPT_MEMBER,
  MANIFEST_REQUIRED_FIELDS,
} from './index.js';

// ── Skeleton emit defaults (local; later slices/callers override) ────────────

/**
 * `ir_version` the skeleton manifest targets. Mirrors the LIVE FORGE emitter
 * value `IR_VERSION = '0.2.0'` (src/ir/emit.js:28) — the version Echelon's
 * intake fixtures already run (SDD §15; Receiving_Contract §1). Distinct from
 * S03-A's `IR_VERSION_FLOOR = '0.1.0'`, which is the accept-FLOOR, not the
 * emit value. S03-B imports neither the envelope nor its constants.
 */
const DEFAULT_IR_VERSION = '0.2.0';

/**
 * FORGE producer version. Mirrors `FORGE_VERSION = '0.1.0'` (src/ir/emit.js:29)
 * for project consistency.
 */
const DEFAULT_FORGE_VERSION = '0.1.0';

/**
 * Initial bundle schema version. Versioned INDEPENDENTLY of `ir_version`
 * (AC-7; SDD §15) — bundle revisions do not couple to FORGE's IR cadence.
 */
const DEFAULT_BUNDLE_SCHEMA_VERSION = '0.1.0';

/**
 * PLACEHOLDER — `oracle_declarations[]` authoring is owned by S03-C (source_id
 * canonicalization to a TRUST_REGISTRY key per SDD §7.2; trust_tier resolution
 * via getTrustTier; construct_source_ref provenance per §7.3). This skeleton
 * value exists ONLY so the REQUIRED manifest field is PRESENT and schema-shaped.
 * It resolves NO trust tier: `trust_tier: 'unknown'` truthfully reflects that
 * S03-B performs no tier resolution. Do NOT treat this as a real, admissible
 * declaration; S03-C replaces it wholesale. assembleBundle({ final: true })
 * REJECTS this placeholder — its `trust_tier: 'unknown'` is skeleton-only and not
 * settlement-authority-conformant (see ./oracles.js for authored declarations).
 */
export const SKELETON_ORACLE_DECLARATIONS = Object.freeze([
  Object.freeze({
    source_id: '__S03C_PLACEHOLDER__', // S03-C: a real TRUST_REGISTRY key
    construct_source_ref: null,         // S03-C: construct-local provenance ref (§7.3)
    source_side: 'forge',
    trust_tier: 'unknown',              // NOT resolved — S03-C runs getTrustTier()
    authority_ref: null,
    role: 'primary',
  }),
]);

/**
 * PLACEHOLDER — `settlement_authority` authoring is owned by S03-C. Per SDD §8.1
 * the settling source is canonicalized from the construct's per-theatre
 * `params.settlement_source` to a TRUST_REGISTRY key, with `declared_trust_tier`
 * resolved via getTrustTier (forge settlement MUST be T0/T1 per canSettle()).
 * This skeleton value keeps the REQUIRED field PRESENT and schema-shaped only.
 * `declared_trust_tier: 'unknown'` truthfully reflects that S03-B resolves no
 * tier and asserts NO settlement eligibility (deliberately NOT T0/T1 — a
 * skeleton must not fake settlement semantics). S03-C replaces it wholesale.
 * assembleBundle({ final: true }) REJECTS this placeholder — its
 * `declared_trust_tier: 'unknown'` is not settlement-authority-conformant (see
 * ./settlement.js for authored settlement authority).
 */
export const SKELETON_SETTLEMENT_AUTHORITY = Object.freeze({
  settling_source_id: '__S03C_PLACEHOLDER__', // S03-C: must cross-ref an oracle_declarations[].source_id (AC-16)
  source_side: 'forge',
  declared_trust_tier: 'unknown',             // NOT T0/T1 — S03-B asserts no settlement eligibility
  authority_ref: null,
});

// ── Skeleton (non-final path) member content — final path materializes (S03-E) ─
//
// These emit the MINIMAL schema-shaped, skeleton-only placeholders for the
// default (non-final) path. The FINAL authored path uses the S03-E materializers
// in ./markdown-members.js instead (see the memberContent branch below). The
// returned strings are kept byte-stable so the skeleton path's receipt digest is
// unchanged by S03-E.

/**
 * Minimal SKILL.md skeleton (non-final path). The FINAL path's real frontmatter
 * (skillopt_config with `enabled: false`, slow_update_sections, bundle_member_hash)
 * + synthesis body + SLOW_UPDATE protected region is materialized by
 * materializeSkillMd in ./markdown-members.js (SDD §11).
 *
 * @param {string} slug
 * @returns {string}
 */
function skeletonSkillMd(slug) {
  return `---
skill_name: ${slug}
---

<!-- S03-B skeleton placeholder member. Full SKILL.md materialization
     (frontmatter completion, synthesis body, SLOW_UPDATE protected region,
     skillopt_config { enabled: false }, bundle_member_hash) is deferred to
     S03-E. FORGE never imports / vendors / runs SkillOpt. -->
`;
}

/**
 * Minimal reality.md skeleton (non-final path). The FINAL path's protected
 * parameter-provenance manifest (parameter_provenance[], oracle_thresholds[]) is
 * materialized by materializeRealityMd in ./markdown-members.js; both paths keep
 * `provenance_manifest_signed: false` always (R-4) and never sign here.
 *
 * @returns {string}
 */
function skeletonRealityMd() {
  return `---
provenance_manifest_signed: false
---

<!-- S03-B skeleton placeholder member. Protected parameter-provenance
     materialization (parameter_provenance[], oracle_thresholds[]) is deferred
     to S03-E. The file is fully protected; no CalibrationReceipt is produced. -->
`;
}

/**
 * Minimal handoff.md skeleton (non-final path). The FINAL path's bounded-editable
 * theatre_trigger_conditions[] (template enum; frozen brier_type /
 * settlement_source_id; bounded_edit_policy `$ref` to bounded_edit_budget) is
 * materialized by materializeHandoffMd in ./markdown-members.js. No payout terms
 * ever appear in the bundle (H-3).
 *
 * @returns {string}
 */
function skeletonHandoffMd() {
  return `---
theatre_trigger_conditions: []
---

<!-- S03-B skeleton placeholder member. Bounded-editable theatre trigger
     conditions are deferred to S03-E. No parametric-payout counterparty /
     currency / amount / enforceable terms appear in the bundle (H-3). -->
`;
}

// ── Assembly ─────────────────────────────────────────────────────────────────

/**
 * Assemble an in-memory ConstructAdmissionBundle skeleton (no disk I/O).
 *
 * @param {object}   input
 * @param {string}   input.constructSlug          - REQUIRED; guarded against L-1 before use.
 * @param {string}   input.constructVersion       - REQUIRED; construct-native SemVer.
 * @param {string[]} [input.capabilityFlags]      - subset of CAPABILITY_FLAGS; default `[]`.
 * @param {object[]} [input.oracleDeclarations]   - S03-C authors; default skeleton placeholder.
 * @param {object}   [input.settlementAuthority]  - S03-C authors; default skeleton placeholder.
 * @param {boolean}  [input.final=false]          - when true, REQUIRE authored oracle/settlement
 *                   inputs and assert settlement-authority conformance (§8/AC-16); the default
 *                   (false) assembles a labelled skeleton that is NOT settlement-authority-conformant.
 * @param {string}   [input.bundleSchemaVersion]  - default `0.1.0`.
 * @param {string}   [input.irVersion]            - default `0.2.0`.
 * @param {string}   [input.forgeVersion]         - default `0.1.0`.
 * @param {number}   [input.now=Date.now()]       - injectable Unix-ms `emitted_at`
 *                   (mirrors emitEnvelope's `now` hook, src/ir/emit.js:95). Pass
 *                   a fixed value for a byte-deterministic bundle.
 * @returns {{ slug: string, members: Record<string,string>, manifest: object, receipt: object }}
 */
export function assembleBundle({
  constructSlug,
  constructVersion,
  capabilityFlags = [],
  oracleDeclarations = SKELETON_ORACLE_DECLARATIONS,
  settlementAuthority = SKELETON_SETTLEMENT_AUTHORITY,
  final = false,
  bundleSchemaVersion = DEFAULT_BUNDLE_SCHEMA_VERSION,
  irVersion = DEFAULT_IR_VERSION,
  forgeVersion = DEFAULT_FORGE_VERSION,
  now = Date.now(),
} = {}) {
  // Path-safety guard BEFORE the slug reaches the manifest or any path (L-1).
  assertValidSlug(constructSlug);

  if (typeof constructVersion !== 'string' || constructVersion.length === 0) {
    throw new Error('bundle: constructVersion is REQUIRED (construct-native SemVer)');
  }

  // S03-C final gate: a "final" (settlement-authority-conformant) bundle MUST be
  // authored — the default skeleton placeholders are explicitly NOT final. Reject
  // missing/placeholder inputs, then assert producer authoring safety (§8/AC-16).
  // This is producer safety, NOT Echelon admission validation.
  if (final) {
    if (
      oracleDeclarations === SKELETON_ORACLE_DECLARATIONS ||
      settlementAuthority === SKELETON_SETTLEMENT_AUTHORITY
    ) {
      throw new Error(
        'bundle: a final bundle requires authored oracle_declarations + settlement_authority ' +
          '(S03-C; see ./oracles.js + ./settlement.js) — the skeleton placeholders are not ' +
          'settlement-authority-conformant',
      );
    }
    assertAuthoredOracleSettlement(oracleDeclarations, settlementAuthority);
  }

  const emitted_at = now;

  // manifest.json — 9 REQUIRED fields (SDD §6) + nullable calibration_ref.
  // `calibration_ref` is ALWAYS null in S03-B; S03-C/D copy an Echelon-supplied
  // pointer verbatim if one exists (OD-4) — FORGE never originates it.
  const manifest = {
    bundle_schema_version: bundleSchemaVersion,
    ir_version: irVersion,
    forge_version: forgeVersion,
    construct_slug: constructSlug,
    construct_version: constructVersion,
    capability_flags: capabilityFlags,
    oracle_declarations: oracleDeclarations,
    settlement_authority: settlementAuthority,
    calibration_ref: null,
    emitted_at,
  };

  // Internal emitter self-check (NOT Echelon admission validation): every
  // REQUIRED manifest field name from the S03-A shape constants is present.
  // Catches drift between the S03-A constants and this emitter, nothing more.
  for (const field of MANIFEST_REQUIRED_FIELDS) {
    if (!(field in manifest)) {
      throw new Error(`bundle: emitter omitted REQUIRED manifest field '${field}'`);
    }
  }

  // The four non-receipt members, keyed by their S03-A member-name constants.
  // A FINAL (settlement-authority-conformant) bundle gets the S03-E materialized
  // markdown (./markdown-members.js — the BREATH worked path). The default
  // skeleton path keeps the S03-B skeleton-only placeholders below (labelled
  // skeleton-only; S03-E does NOT reintroduce placeholders into the authored
  // path). The receipt (below) hashes whichever bytes are emitted here, so the
  // S03-D digest hardening covers the materialized markdown automatically.
  const memberContent = {
    [MANIFEST_MEMBER]: serializeJson(manifest),
    [SKILL_MEMBER]: final
      ? materializeSkillMd({ slug: constructSlug })
      : skeletonSkillMd(constructSlug),
    [REALITY_MEMBER]: final ? materializeRealityMd() : skeletonRealityMd(),
    [HANDOFF_MEMBER]: final
      ? materializeHandoffMd({ settlementSourceId: settlementAuthority.settling_source_id })
      : skeletonHandoffMd(),
  };

  // bundle-receipt.json — receipt digest hardening + nullable publisher-authenticity
  // delegated to ./receipt.js (S03-D). The receipt module whitelists the member set
  // against BUNDLE_MEMBERS and REJECTS a non-exact set BEFORE digesting (D-1; carries
  // forward S03-B review LOW-1), computes the `sha256:` per-member content_hash (D-2)
  // and the bundle_digest over canonical-JSON of members[] sorted by path (D-3) by
  // reusing src/receipt/{hash,canonicalize}.js, and emits the four publisher-
  // authenticity fields present-and-null (OD-1). No signature is produced and no
  // signer / keyring / revocation / verification code is imported or called.
  const receipt = buildBundleReceipt({
    memberContent,
    bundleSchemaVersion,
    constructSlug,
    constructVersion,
    emittedAt: emitted_at,
  });

  const memberFiles = {
    ...memberContent,
    [BUNDLE_RECEIPT_MEMBER]: serializeJson(receipt),
  };

  return { slug: constructSlug, members: memberFiles, manifest, receipt };
}

/**
 * Deterministic, human-readable JSON serialization for the two JSON members
 * (2-space indent + trailing newline). Each member's `content_hash` is taken
 * over these exact on-disk bytes; with a fixed `now` the whole bundle —
 * including `bundle_digest` — is byte-stable across runs.
 *
 * @param {unknown} value
 * @returns {string}
 */
function serializeJson(value) {
  return JSON.stringify(value, null, 2) + '\n';
}
