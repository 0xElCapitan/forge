/**
 * src/bundle/versioning.js
 * ConstructAdmissionBundle — version-field semantics (shape / documented constant).
 *
 * Shape/constants only (S03-A). This documents the version fields' meaning and
 * the IR consumer rule as EMIT METADATA — not a gate. S03-A contains no version
 * acceptance/rejection logic; unknown MAJOR versions are rejected by the
 * receiving side / future conformance, never by S03-A runtime. Grounded in
 * SDD §6, §15.
 *
 * @module bundle/versioning
 */

/**
 * `ir_version` floor — `0.1.0` is the FLOOR, not a hard pin (SDD §15).
 *
 * FORGE Proposal-IR SemVer consumer rule (STABILITY.md), documented here as emit
 * metadata only — NOT implemented as acceptance logic in this slice:
 *   - accept any `0.x` MINOR as additive (e.g. `0.2.0` MUST be accepted; the live
 *     emitter already emits `0.2.0` at src/ir/emit.js:28);
 *   - reject unrecognized MAJOR — at the RECEIVING side / future conformance, not
 *     in S03-A code;
 *   - ignore unknown fields.
 *
 * Field-semantics summary (no values pinned here — those are emit-time authoring
 * decisions in S03-B+):
 *   - `bundle_schema_version` — REQUIRED SemVer; versioned INDEPENDENTLY of
 *     `ir_version` (AC-7), so bundle revisions do not couple to FORGE's IR cadence.
 *   - `ir_version`            — FORGE Proposal-IR target; consumer rule above.
 *   - `construct_version`     — construct-specific SemVer; distinct from `forge_version`.
 *   - `forge_version`         — FORGE producer version.
 *
 * Decoupling rule: do NOT couple bundle version bumps to the ProposalEnvelope IR
 * version; `bundle_schema_version` and `ir_version` change independently (AC-7).
 * S03-A neither imports the envelope nor implements any of this logic.
 */
export const IR_VERSION_FLOOR = '0.1.0';
