/**
 * src/bundle/settlement.js
 * ConstructAdmissionBundle producer — `settlement_authority` authoring (S03-C).
 *
 * Replaces the S03-B `SKELETON_SETTLEMENT_AUTHORITY` placeholder with real
 * producer-side authoring of the REQUIRED `settlement_authority` structured object
 * (OD-2), plus the central producer authoring-safety gate
 * `assertAuthoredOracleSettlement`. Grounded in SDD §8 (settlement_authority
 * shape), §8.1 (the `params.settlement_source` → `settling_source_id` authoring
 * map), and the Cycle-113 Receiving_Contract `SettlementAuthority` model.
 *
 * SCOPE (FORGE cycle-002 / sprint-03 slice S03-C): settlement AUTHORING + the
 * forge-side conformance gate ONLY. This module —
 *   - reads `src/trust/oracle-trust.js` `getTrustTier()` / `canSettle()` read-only
 *     to resolve and bound the settling tier; it mutates nothing in trust/ or
 *     selector/, and reads no construct metadata at runtime (the worked path is
 *     authored from the values grounded below);
 *   - implements the §8.1 map for ONE worked path only: the selector rule
 *     `aqi_threshold_gate` binds `params.settlement_source: 'airnow'`
 *     (src/selector/rules.js:246), already a `TRUST_REGISTRY` T1 key, so the
 *     canonicalization for this source is identity-after-verification. Any other
 *     settlement source is OUT of slice scope and THROWS — S03-C claims no broad
 *     multi-theatre / multi-settlement generality;
 *   - enforces the settlement invariant (forge ⇒ T0/T1, mirroring `canSettle`) and
 *     the cross-reference invariant (AC-16: `settling_source_id` MUST appear among
 *     `oracle_declarations[].source_id`) as PRODUCER authoring safety — it builds
 *     NO Echelon receiving-end validation / admission / parser, and is NOT imported
 *     by any live runtime path.
 *
 * @module bundle/settlement
 */

import { getTrustTier, canSettle } from '../trust/oracle-trust.js';
import { SOURCE_SIDE } from './enums.js';
import { authorBreathOracleDeclarations } from './oracles.js';

/** The FORGE boundary side — the only side whose settling source resolves a tier. */
const FORGE_SIDE = 'forge';

/**
 * Narrow S03-C settlement-source canonicalization map (§8.1) — the single worked
 * entry. `params.settlement_source: 'airnow'` (src/selector/rules.js:246) is
 * already the `TRUST_REGISTRY` T1 key, so the §7.2 canonicalization for this
 * source is identity; the map records that S03-C has VERIFIED exactly this one
 * source. Construct-local settlement ids (e.g. `epa_airnow`) are deliberately NOT
 * auto-mapped: the `epa_airnow → {epa_aqs T0 | airnow T1}` relation is one-to-many
 * (§7.3) and the T0-vs-T1 choice is an authoring decision this slice does not
 * generalize.
 *
 * @type {Readonly<Record<string, string>>}
 */
const S03C_SETTLEMENT_SOURCE_CANONICAL = Object.freeze({
  airnow: 'airnow',
});

/**
 * Canonicalize a per-theatre settlement source string to a `TRUST_REGISTRY` key
 * eligible to settle (§8.1 → §7.2). Returns the canonical key on success.
 *
 * Throws when the source is unmapped by this slice, or when the canonical key is
 * not T0/T1 (a T2/T3/unknown settlement source is a producer authoring error here,
 * mirroring the structural reject Echelon performs at parse time — SDD §8).
 *
 * @param {string} settlementSource - e.g. a selector `params.settlement_source`.
 * @returns {string} canonical `TRUST_REGISTRY` key (T0/T1)
 */
export function canonicalizeSettlementSource(settlementSource) {
  if (typeof settlementSource !== 'string' || settlementSource.length === 0) {
    throw new Error('settlement: settlement source must be a non-empty string');
  }
  const key = S03C_SETTLEMENT_SOURCE_CANONICAL[settlementSource.toLowerCase()];
  if (!key) {
    throw new Error(
      `settlement: source '${settlementSource}' is not canonicalized by S03-C — ` +
        `only the BREATH 'airnow' worked path is mapped (no broad multi-settlement generality)`,
    );
  }
  const tier = getTrustTier(key);
  if (!canSettle(tier)) {
    throw new Error(
      `settlement: canonical source '${key}' has tier ${tier} — only T0/T1 may settle (canSettle)`,
    );
  }
  return key;
}

/**
 * Author the REQUIRED `settlement_authority` structured object (OD-2) for a
 * forge-side worked path, per the SDD §8.1 map:
 *
 *   params.settlement_source  →  canonical TRUST_REGISTRY key  →  settling_source_id
 *
 * The resolved `declared_trust_tier` comes from `getTrustTier()` and is guaranteed
 * T0/T1 by {@link canonicalizeSettlementSource}. The `settling_source_id` is
 * cross-checked against the supplied `oracleDeclarations` (AC-16) so a settlement
 * source that names no declared oracle fails at authoring time.
 *
 * S03-C authors forge-side settlement only; echelon|lattice settlement authoring
 * is out of slice scope and throws.
 *
 * @param {object}   input
 * @param {string}   input.settlementSource         - per-theatre settlement source (e.g. 'airnow').
 * @param {'forge'}  [input.sourceSide='forge']     - forge-side only in this slice.
 * @param {Array<object>} oracleDeclarations         - already-authored oracle declarations (for AC-16 cross-ref).
 * @returns {{ settling_source_id: string, source_side: string, declared_trust_tier: string, authority_ref: null }}
 */
export function authorSettlementAuthority(
  { settlementSource, sourceSide = FORGE_SIDE } = {},
  oracleDeclarations = [],
) {
  if (!SOURCE_SIDE.includes(sourceSide)) {
    throw new Error(
      `settlement: invalid source_side ${JSON.stringify(sourceSide)} — one of ${SOURCE_SIDE.join('|')}`,
    );
  }
  if (sourceSide !== FORGE_SIDE) {
    throw new Error(
      `settlement: S03-C authors forge-side settlement only (got source_side '${sourceSide}')`,
    );
  }
  if (!Array.isArray(oracleDeclarations) || oracleDeclarations.length === 0) {
    throw new Error('settlement: oracleDeclarations[] is REQUIRED for the AC-16 cross-reference');
  }

  const settling_source_id = canonicalizeSettlementSource(settlementSource);

  // AC-16: the settling source MUST cross-reference an authored oracle source_id.
  const declaredIds = oracleDeclarations.map((d) => d && d.source_id);
  if (!declaredIds.includes(settling_source_id)) {
    throw new Error(
      `settlement: settling_source_id '${settling_source_id}' does not cross-reference any ` +
        `oracle_declarations[].source_id (AC-16)`,
    );
  }

  return {
    settling_source_id,
    source_side: FORGE_SIDE,
    declared_trust_tier: getTrustTier(settling_source_id), // T0/T1, verified above
    authority_ref: null, // forge-side: no Echelon authority_ref
  };
}

/**
 * Central producer authoring-safety gate for a FINAL (settlement-authority-
 * conformant) bundle. Re-validates oracle declarations + settlement authority
 * regardless of how they were produced (defense in depth — a caller may hand-build
 * the inputs). Throws on the first violation; returns nothing on success.
 *
 * This is PRODUCER safety, NOT Echelon admission validation — the same invariants
 * Echelon enforces at parse time are asserted here so FORGE never emits a bundle
 * it knows to be non-conformant. It rejects the S03-B skeleton placeholders, whose
 * honest `trust_tier: 'unknown'` is not settlement-authority-conformant.
 *
 * Checks:
 *   - oracle_declarations[] non-empty (Receiving_Contract min_length 1);
 *   - each forge oracle: source_id is a TRUST_REGISTRY key, trust_tier ===
 *     getTrustTier(source_id) and not 'unknown', authority_ref === null (§7.1/§7.2/§7.4);
 *   - each echelon|lattice oracle: trust_tier === null, authority_ref present (§7.1/§7.4);
 *   - settlement_authority.settling_source_id present and cross-referenced (AC-16);
 *   - forge settlement: declared_trust_tier is T0/T1 and === getTrustTier(settling_source_id) (§8);
 *   - echelon|lattice settlement: authority_ref present (§8).
 *
 * @param {Array<object>} oracleDeclarations
 * @param {object} settlementAuthority
 * @returns {void}
 */
export function assertAuthoredOracleSettlement(oracleDeclarations, settlementAuthority) {
  if (!Array.isArray(oracleDeclarations) || oracleDeclarations.length === 0) {
    throw new Error('bundle: a final bundle requires a non-empty oracle_declarations[] (min_length 1)');
  }

  for (const d of oracleDeclarations) {
    if (!d || typeof d.source_id !== 'string' || d.source_id.length === 0) {
      throw new Error('bundle: each oracle declaration requires a non-empty source_id');
    }
    if (d.source_side === FORGE_SIDE) {
      const tier = getTrustTier(d.source_id);
      if (tier === 'unknown') {
        throw new Error(
          `bundle: forge-side oracle '${d.source_id}' is not a TRUST_REGISTRY key — ` +
            `trust_tier 'unknown' is skeleton-only, not settlement-authority-conformant (§7.2/AC-5)`,
        );
      }
      if (d.trust_tier !== tier) {
        throw new Error(
          `bundle: forge-side oracle '${d.source_id}' trust_tier '${d.trust_tier}' != getTrustTier '${tier}' (§7.1)`,
        );
      }
      if (d.authority_ref != null) {
        throw new Error(`bundle: forge-side oracle '${d.source_id}' MUST NOT carry authority_ref (§7.4)`);
      }
    } else if (d.source_side === 'echelon' || d.source_side === 'lattice') {
      if (d.trust_tier !== null) {
        throw new Error(`bundle: ${d.source_side}-side oracle '${d.source_id}' MUST have null trust_tier (§7.1)`);
      }
      if (typeof d.authority_ref !== 'string' || d.authority_ref.length === 0) {
        throw new Error(`bundle: ${d.source_side}-side oracle '${d.source_id}' requires authority_ref pass-through (§7.4)`);
      }
    } else {
      throw new Error(`bundle: oracle '${d.source_id}' has invalid source_side '${d.source_side}'`);
    }
  }

  const s = settlementAuthority;
  if (!s || typeof s.settling_source_id !== 'string' || s.settling_source_id.length === 0) {
    throw new Error('bundle: settlement_authority.settling_source_id is REQUIRED');
  }
  const declaredIds = oracleDeclarations.map((d) => d.source_id);
  if (!declaredIds.includes(s.settling_source_id)) {
    throw new Error(
      `bundle: settlement_authority.settling_source_id '${s.settling_source_id}' is not ` +
        `cross-referenced by any oracle_declarations[].source_id (AC-16)`,
    );
  }
  if (s.source_side === FORGE_SIDE) {
    if (!canSettle(s.declared_trust_tier)) {
      throw new Error(
        `bundle: forge-side settlement '${s.settling_source_id}' declared_trust_tier ` +
          `'${s.declared_trust_tier}' is not T0/T1 (settlement invariant; canSettle)`,
      );
    }
    const tier = getTrustTier(s.settling_source_id);
    if (s.declared_trust_tier !== tier) {
      throw new Error(
        `bundle: forge-side settlement '${s.settling_source_id}' declared_trust_tier ` +
          `'${s.declared_trust_tier}' != getTrustTier '${tier}' (§8)`,
      );
    }
  } else if (s.source_side === 'echelon' || s.source_side === 'lattice') {
    if (typeof s.authority_ref !== 'string' || s.authority_ref.length === 0) {
      throw new Error(`bundle: ${s.source_side}-side settlement requires authority_ref (§7.4/§8)`);
    }
  } else {
    throw new Error(`bundle: settlement_authority has invalid source_side '${s.source_side}'`);
  }
}

/**
 * Compose the authored oracle/settlement manifest parts for the single BREATH
 * worked path: two forge-side oracle declarations (`airnow` settlement T1,
 * `purpleair` signal T3) and a forge-side `settlement_authority` settling on
 * `airnow`. The result passes {@link assertAuthoredOracleSettlement} and is the
 * intended input to `assembleBundle({ ..., final: true })`.
 *
 * @returns {{ oracleDeclarations: Array<object>, settlementAuthority: object }}
 */
export function authorBreathManifestParts() {
  const oracleDeclarations = authorBreathOracleDeclarations();
  const settlementAuthority = authorSettlementAuthority(
    // params.settlement_source for rule aqi_threshold_gate (src/selector/rules.js:246)
    { settlementSource: 'airnow', sourceSide: FORGE_SIDE },
    oracleDeclarations,
  );
  // Defense in depth: assert the same gate assembleBundle runs for a final bundle.
  assertAuthoredOracleSettlement(oracleDeclarations, settlementAuthority);
  return { oracleDeclarations, settlementAuthority };
}
