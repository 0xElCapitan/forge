/**
 * src/bundle/receipt.js
 * ConstructAdmissionBundle producer — bundle-receipt.json digest hardening (S03-D).
 *
 * Hardens the `bundle-receipt.json` digest layer that S03-B first assembled inline:
 * a strict member-set WHITELIST that REJECTS a non-exact member set BEFORE any
 * digest is computed (D-1; carries forward the S03-B review LOW-1 hardening note),
 * the per-member `sha256:` `content_hash` (D-2), and the `bundle_digest` over the
 * canonical JSON of `members[]` sorted by `path` (D-3). Hashing and canonicalization
 * REUSE the existing zero-dependency receipt primitives
 * src/receipt/{hash,canonicalize}.js — no new hashing/canonicalization code and no
 * new dependency.
 *
 * SCOPE (FORGE cycle-002 / sprint-03 slice S03-D): receipt digest + nullable
 * publisher-authenticity fields ONLY. This module —
 *   - whitelists receipt `members[]` against the S03-A BUNDLE_MEMBERS closed set
 *     (EXACTLY the four NON-receipt members; bundle-receipt.json itself is excluded,
 *     D-1) and rejects missing / extra / duplicate / path-traversal member names
 *     BEFORE digesting (fail-closed; Receiving_Contract D-1). This is PRODUCER
 *     authoring safety, NOT Echelon receiving-end validation;
 *   - emits the four publisher-authenticity fields PRESENT and `null` (OD-1) — it
 *     produces NO signature and imports/calls NO signer, keyring, revocation,
 *     trust-policy, or verification code. Signature PRODUCTION is the deferred,
 *     optional S03-D′; signature VERIFICATION is never a FORGE responsibility
 *     (Echelon 113.x/115). The §13.3 reuse seam is DOCUMENTED below, NOT wired;
 *   - carries `emitted_at` verbatim from the caller (the assembler's injectable
 *     `now`); it does NOT decide timestamp format (see the emitted_at note below).
 *
 * NAMING: sibling of the singular `src/bundle/` producer — unrelated to the plural
 * `src/processor/bundles.js`; never imports it.
 *
 * @module bundle/receipt
 */

import { sha256 } from '../receipt/hash.js';
import { canonicalize } from '../receipt/canonicalize.js';
import {
  BUNDLE_MEMBERS,
  BUNDLE_RECEIPT_MEMBER,
  RECEIPT_AUTHENTICITY_FIELDS,
} from './index.js';

/**
 * The exact set of members the receipt digests: the four NON-receipt bundle members,
 * derived from the S03-A closed BUNDLE_MEMBERS set minus the receipt itself (D-1).
 * Deriving from BUNDLE_MEMBERS (rather than re-listing the four names) keeps this
 * whitelist in lockstep with the S03-A shape constant — a future member-set change
 * propagates here automatically.
 *
 * @type {readonly string[]}  ['manifest.json','SKILL.md','reality.md','handoff.md']
 */
export const RECEIPT_DIGEST_MEMBERS = Object.freeze(
  BUNDLE_MEMBERS.filter((member) => member !== BUNDLE_RECEIPT_MEMBER),
);

/** Membership lookup for the whitelist (built once). */
const RECEIPT_DIGEST_MEMBER_SET = new Set(RECEIPT_DIGEST_MEMBERS);

/**
 * Assert that `paths` is EXACTLY the four non-receipt members — no missing, extra,
 * duplicate, or unsafe member names — BEFORE any content is hashed or digested
 * (D-1, fail-closed). This is the S03-D hardening that carries forward the S03-B
 * review LOW-1 finding (member-name keys were previously trusted). It is PRODUCER
 * authoring safety, NOT Echelon receiving-end validation.
 *
 * Rejects, in order of most-specific diagnostic:
 *   - a non-array, or a non-string / empty member name;
 *   - a member name that is not a bare basename (contains '/', '\\', or '..') —
 *     path-traversal / nesting defense (L-1 family);
 *   - the receipt's own name (bundle-receipt.json) appearing inside members[]
 *     (D-1: the receipt digests the four NON-receipt files, never itself);
 *   - any name outside the BUNDLE_MEMBERS non-receipt whitelist (extra member);
 *   - a duplicate member name;
 *   - (after the scan) any whitelisted member that is missing.
 *
 * @param {string[]} paths - candidate member names (e.g. Object.keys(memberContent)).
 * @returns {void}
 * @throws {Error} on the first violation (BEFORE any digest is computed).
 */
export function assertReceiptMemberSet(paths) {
  if (!Array.isArray(paths)) {
    throw new Error('bundle/receipt: members must be provided as an array of member names');
  }

  const seen = new Set();
  for (const name of paths) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('bundle/receipt: each member name must be a non-empty string');
    }
    if (name.includes('/') || name.includes('\\') || name.includes('..')) {
      throw new Error(
        `bundle/receipt: unsafe member name ${JSON.stringify(name)} — member names must be ` +
          "bare basenames from BUNDLE_MEMBERS (no '/', '\\', or '..')",
      );
    }
    if (name === BUNDLE_RECEIPT_MEMBER) {
      throw new Error(
        `bundle/receipt: '${BUNDLE_RECEIPT_MEMBER}' MUST NOT appear in members[] — the receipt ` +
          'digests the four NON-receipt members, never itself (D-1)',
      );
    }
    if (!RECEIPT_DIGEST_MEMBER_SET.has(name)) {
      throw new Error(
        `bundle/receipt: unexpected member ${JSON.stringify(name)} — not in the BUNDLE_MEMBERS ` +
          `non-receipt set {${RECEIPT_DIGEST_MEMBERS.join(', ')}} (D-1)`,
      );
    }
    if (seen.has(name)) {
      throw new Error(`bundle/receipt: duplicate member ${JSON.stringify(name)} (D-1)`);
    }
    seen.add(name);
  }

  for (const required of RECEIPT_DIGEST_MEMBERS) {
    if (!seen.has(required)) {
      throw new Error(
        `bundle/receipt: missing member '${required}' — members[] must be EXACTLY the four ` +
          'non-receipt members (D-1)',
      );
    }
  }
}

/**
 * Build the receipt `members[]` digest manifest from the four non-receipt member
 * contents: whitelist the member set (assertReceiptMemberSet — fail-closed BEFORE
 * digesting), then map each to `{ path, size_bytes, content_hash }` with a
 * `sha256:`-prefixed content_hash (D-2; reuse src/receipt/hash.js), sorted by path
 * (D-3). No hashing code is reimplemented here.
 *
 * @param {Record<string,string>} memberContent - non-receipt member name → emitted bytes.
 * @returns {Array<{ path: string, size_bytes: number, content_hash: string }>} sorted by path.
 */
function buildReceiptMembers(memberContent) {
  const paths = Object.keys(memberContent);
  assertReceiptMemberSet(paths); // fail-closed BEFORE any content is hashed/digested (D-1)

  return paths
    .map((path) => {
      const content = memberContent[path];
      return {
        path,
        size_bytes: Buffer.byteLength(content, 'utf8'),
        content_hash: sha256(content), // 'sha256:'-prefixed (D-2; src/receipt/hash.js)
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)); // D-3: sort by path
}

/**
 * Assemble the in-memory `bundle-receipt.json` object: the whitelisted members[]
 * digest manifest, the bundle_digest over canonical-JSON of members[] sorted by
 * path (D-3; reuse src/receipt/canonicalize.js + hash.js), the four publisher-
 * authenticity fields PRESENT and `null` (OD-1), and the carried emitted_at.
 *
 * Determinism: over identical inputs (including a fixed `emittedAt`) this returns a
 * byte-identical receipt — the per-member content_hash, the canonical-JSON sort, and
 * the sha256 digest are all deterministic. (The default non-fixed timestamp is the
 * assembler's concern; see the emitted_at note.)
 *
 * publisher-authenticity (OD-1): all four fields are emitted PRESENT and `null`.
 * S03-D produces NO signature and resolves NO key / policy / revocation. The fields
 * are SPEC-ONLY here so an unsigned bundle still parses (it simply cannot reach a
 * future ACCEPTED/PROMOTED once Echelon's gate exists — fail-closed by absence,
 * NFR-7).
 *
 * §13.3 signing seam (DESCRIBED, NOT wired — deferred to optional S03-D′): a later,
 * operator-gated slice could populate `publisher_signature` by reusing the existing
 * zero-dependency signer at src/receipt/sign.js (`signReceipt(bundle_digest, …)` →
 * `ed25519:<base64>`) and `signing_key_id` from src/receipt/keyring.js, mirroring how
 * ProposalReceipt is already signed (the emitEnvelope `sign`-hook precedent). This
 * module imports NONE of that machinery — those paths are named for the seam only.
 * Signature VERIFICATION is never a FORGE responsibility (AC-13; Echelon 113.x/115).
 *
 * emitted_at (LOW-2, carried forward — DOC only): `emittedAt` is carried verbatim
 * from the assembler's injectable `now`, a project-consistent Unix-ms integer
 * (mirrors src/ir/emit.js). The Receiving_Contract types this field as a Pydantic
 * datetime, which reads a bare integer as Unix *seconds*; the final int-vs-datetime
 * parser alignment is a deliberate S03-F / Echelon follow-up. S03-D changes NO
 * timestamp behavior — it preserves Unix-ms and only documents the open pin.
 *
 * @param {object} input
 * @param {Record<string,string>} input.memberContent      - non-receipt member name → emitted bytes.
 * @param {string}                input.bundleSchemaVersion - mirrors the manifest.
 * @param {string}                input.constructSlug       - mirrors the manifest.
 * @param {string}                input.constructVersion    - mirrors the manifest.
 * @param {number}                input.emittedAt           - carried verbatim (Unix-ms; see note).
 * @returns {object} bundle-receipt.json (members[] + bundle_digest + 4 null authenticity fields + emitted_at).
 */
export function buildBundleReceipt({
  memberContent,
  bundleSchemaVersion,
  constructSlug,
  constructVersion,
  emittedAt,
}) {
  const members = buildReceiptMembers(memberContent);

  // bundle_digest — sha256 over the canonical JSON of members[] sorted by path
  // (D-3). Reuses src/receipt/canonicalize.js + hash.js (no reimplementation).
  const bundle_digest = sha256(canonicalize(members));

  // The four publisher-authenticity fields PRESENT and null (OD-1). NO signature is
  // produced and NO signer / keyring / revocation / verification code is imported.
  const authenticity = Object.fromEntries(
    RECEIPT_AUTHENTICITY_FIELDS.map((field) => [field, null]),
  );

  return {
    bundle_schema_version: bundleSchemaVersion,
    construct_slug: constructSlug,
    construct_version: constructVersion,
    members,
    bundle_digest,
    ...authenticity,
    emitted_at: emittedAt,
  };
}
