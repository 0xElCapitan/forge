/**
 * src/bundle/oracles.js
 * ConstructAdmissionBundle producer — `oracle_declarations[]` authoring (S03-C).
 *
 * Replaces the S03-B `SKELETON_ORACLE_DECLARATIONS` placeholder with real
 * producer-side authoring of a single oracle declaration element, plus the one
 * narrow worked oracle topology this slice commits to (the BREATH air-quality
 * theatre). Grounded in SDD §7 (per-element shape), §7.1 (`trust_tier`
 * conditional nullability), §7.2 (forge-side `source_id` namespace), §7.3
 * (`construct_source_ref` provenance-only), §7.4 (`authority_ref` pass-through),
 * and the Cycle-113 Receiving_Contract `OracleDeclaration` model.
 *
 * SCOPE (FORGE cycle-002 / sprint-03 slice S03-C): oracle declaration AUTHORING
 * only. This module —
 *   - reads `src/trust/oracle-trust.js` `getTrustTier()` read-only to resolve the
 *     FORGE-owned `trust_tier` axis; it mutates nothing in trust/ or selector/;
 *   - canonicalizes a forge-side `source_id` to a `TRUST_REGISTRY` key (§7.2) and
 *     REFUSES to author a forge declaration whose `source_id` resolves to
 *     `'unknown'` — a producer authoring-safety check, NOT Echelon admission;
 *   - carries `construct_source_ref` as provenance/traceability ONLY (§7.3): it is
 *     NEVER consulted for tiering;
 *   - carries `authority_ref` opaquely for echelon|lattice sources and NEVER
 *     dereferences it (§7.4); FORGE never maps T0–T3 onto Echelon authority tiers;
 *   - builds NO validation / admission / parser logic and is NOT imported by any
 *     live runtime path.
 *
 * NAMING: sibling of the singular `src/bundle/` producer — unrelated to the
 * plural `src/processor/bundles.js`; never imports it.
 *
 * @module bundle/oracles
 */

import { getTrustTier } from '../trust/oracle-trust.js';
import { SOURCE_SIDE, ORACLE_ROLE } from './enums.js';

/** The FORGE boundary side — the only side whose `source_id` resolves a tier. */
const FORGE_SIDE = 'forge';

/**
 * Author a single `oracle_declarations[]` element from typed producer input.
 *
 * Conditional shape rules (SDD §7.1/§7.4), enforced as producer authoring safety:
 *   - `source_side: forge`  — `source_id` MUST be a `TRUST_REGISTRY` key (§7.2);
 *     `trust_tier` is RESOLVED here via `getTrustTier(source_id)` (never passed
 *     in, never hard-coded) and MUST NOT be `'unknown'`; `authority_ref` MUST be
 *     null.
 *   - `source_side: echelon|lattice` — `trust_tier` MUST be null; `authority_ref`
 *     is REQUIRED and carried opaquely (FORGE never dereferences it).
 *
 * `construct_source_ref` is carried verbatim as provenance only (§7.3) and is
 * never tier-resolving.
 *
 * @param {object}        input
 * @param {string}        input.sourceId             - forge: a TRUST_REGISTRY key; echelon|lattice: partner id.
 * @param {string|null}   [input.constructSourceRef] - construct-local provenance ref (§7.3); default null.
 * @param {'forge'|'echelon'|'lattice'} input.sourceSide
 * @param {string}        input.role                 - one of ORACLE_ROLE.
 * @param {string|null}   [input.authorityRef]       - REQUIRED iff echelon|lattice; MUST be null iff forge.
 * @returns {{ source_id: string, construct_source_ref: string|null, source_side: string, trust_tier: string|null, authority_ref: string|null, role: string }}
 */
export function authorOracleDeclaration({
  sourceId,
  constructSourceRef = null,
  sourceSide,
  role,
  authorityRef = null,
} = {}) {
  if (typeof sourceId !== 'string' || sourceId.length === 0) {
    throw new Error('oracles: source_id is REQUIRED (non-empty string)');
  }
  if (!SOURCE_SIDE.includes(sourceSide)) {
    throw new Error(
      `oracles: invalid source_side ${JSON.stringify(sourceSide)} — one of ${SOURCE_SIDE.join('|')}`,
    );
  }
  if (!ORACLE_ROLE.includes(role)) {
    throw new Error(
      `oracles: invalid role ${JSON.stringify(role)} — one of ${ORACLE_ROLE.join('|')}`,
    );
  }

  if (sourceSide === FORGE_SIDE) {
    // §7.2 / AC-5: forge-side source_id MUST be a TRUST_REGISTRY key, else its
    // declared trust_tier is unverifiable (getTrustTier → 'unknown'). The
    // skeleton's honest `trust_tier: 'unknown'` is exactly what this rejects.
    const trust_tier = getTrustTier(sourceId);
    if (trust_tier === 'unknown') {
      throw new Error(
        `oracles: forge-side source_id '${sourceId}' is not a TRUST_REGISTRY key ` +
          `(§7.2/AC-5) — trust_tier is unverifiable`,
      );
    }
    // §7.4: forge-side declarations never carry an Echelon authority_ref.
    if (authorityRef != null) {
      throw new Error('oracles: forge-side declaration MUST NOT carry authority_ref (§7.4)');
    }
    return {
      source_id: sourceId,
      construct_source_ref: constructSourceRef,
      source_side: FORGE_SIDE,
      trust_tier,
      authority_ref: null,
      role,
    };
  }

  // echelon | lattice: trust_tier MUST be null (§7.1); authority_ref REQUIRED and
  // carried opaquely — FORGE NEVER dereferences it and NEVER maps T0–T3 onto the
  // Echelon source-authority axis (§7.4).
  if (typeof authorityRef !== 'string' || authorityRef.length === 0) {
    throw new Error(
      `oracles: ${sourceSide}-side declaration requires an authority_ref pass-through (§7.4)`,
    );
  }
  return {
    source_id: sourceId,
    construct_source_ref: constructSourceRef,
    source_side: sourceSide,
    trust_tier: null,
    authority_ref: authorityRef,
    role,
  };
}

/**
 * The ONE worked oracle topology S03-C commits to: the two forge-side oracles of
 * the BREATH air-quality theatre. Each row pairs the construct-local provenance id
 * (`constructSourceRef`) with the canonical `TRUST_REGISTRY` key (`sourceId`). The
 * `construct.json data-source id → TRUST_REGISTRY key` relation is one-to-many by
 * feed variant (e.g. `epa_airnow → {epa_aqs T0 | airnow T1}`, SDD §7.3), so this
 * is a deliberate AUTHORING choice — not a mechanical rename, and not a claim of
 * broad namespace coverage. `trust_tier` is resolved by `authorOracleDeclaration`
 * via `getTrustTier(sourceId)`; it is never stated here.
 *
 * Grounding:
 *   - `airnow`  ← construct.json `data_sources` id `epa_airnow` (`semantic_role:
 *     trust_tier_settlement`, spec/construct.json:86-91); settles the theatre.
 *   - `purpleair` ← construct.json `data_sources` id `purpleair_sensor`
 *     (`semantic_role: trust_tier_signal`, spec/construct.json:78-84); signal only.
 *   - the `role: settlement` on `airnow` is an authoring lift (SDD §8.1 step 4):
 *     `construct.json` declares no native `role: settlement` oracle.
 *   - the T1-settles / T3-never-settles split is the construct's headline
 *     invariant (oracle-trust.js:5-6; selector rules.js:229; construct.json:243-250).
 */
export const BREATH_ORACLE_SOURCES = Object.freeze([
  Object.freeze({
    sourceId: 'airnow', // TRUST_REGISTRY T1 key — the settling source
    constructSourceRef: 'epa_airnow', // construct-local data_sources id (trust_tier_settlement)
    sourceSide: FORGE_SIDE,
    role: 'settlement', // authoring lift per SDD §8.1 step 4
  }),
  Object.freeze({
    sourceId: 'purpleair', // TRUST_REGISTRY T3 key — signal only, NEVER settles
    constructSourceRef: 'purpleair_sensor', // construct-local data_sources id (trust_tier_signal)
    sourceSide: FORGE_SIDE,
    role: 'signal',
  }),
]);

/**
 * Author the BREATH theatre's `oracle_declarations[]` (the two forge-side oracles
 * above). Returns a fresh array of authored declarations; `trust_tier` on each is
 * resolved at authoring time (`airnow → T1`, `purpleair → T3`).
 *
 * @returns {Array<object>} authored oracle declarations (length 2, min_length 1 satisfied)
 */
export function authorBreathOracleDeclarations() {
  return BREATH_ORACLE_SOURCES.map((source) => authorOracleDeclaration(source));
}
