/**
 * src/bundle/fields.js
 * ConstructAdmissionBundle — field-name shape constants (shape only).
 *
 * Shape/constants only (S03-A): the names of the manifest's required/optional
 * fields, the receipt's nullable publisher-authenticity fields, the construct-
 * local reference field, and the downstream budget ceiling. These are field-name
 * sets and one numeric ceiling — NOT object schemas, NOT validators, NOT an
 * emitter. Element/sub-shapes (oracle_declarations[], settlement_authority,
 * calibration_ref pointer) are authored in later slices (S03-C/D). Grounded in
 * SDD §6, §7.3, §11 (D-7), §13.2.
 *
 * @module bundle/fields
 */

/**
 * manifest.json REQUIRED field set (SDD §6 table). Order follows the SDD table.
 * `capability_flags` / `oracle_declarations` are arrays and `settlement_authority`
 * is a structured object at emit time; their internal shapes are not defined here.
 */
export const MANIFEST_REQUIRED_FIELDS = Object.freeze([
  'bundle_schema_version',
  'ir_version',
  'forge_version',
  'construct_slug',
  'construct_version',
  'capability_flags',
  'oracle_declarations',
  'settlement_authority',
  'emitted_at_ms',
]);

/**
 * manifest.json OPTIONAL / nullable field set (SDD §6). `calibration_ref` is a
 * pointer-only object or null — null until Echelon issues a forecast-quality cert
 * (SDD §9). Its pointer sub-fields are a later-slice concern, not defined here.
 */
export const MANIFEST_OPTIONAL_FIELDS = Object.freeze(['calibration_ref']);

/**
 * oracle_declarations[] construct-local reference field name (OD-3, SDD §7.3).
 * `construct_source_ref` carries the original construct-local id for provenance /
 * traceability ONLY — it is NEVER tier-resolving. (For `source_side: forge`, the
 * tier-resolving field is `source_id`, which MUST be a TRUST_REGISTRY key.)
 */
export const CONSTRUCT_SOURCE_REF_FIELD = 'construct_source_ref';

/**
 * bundle-receipt.json publisher-authenticity field names (OD-1, SDD §13.2). All
 * four are optional/nullable; S03-A defines only their NAMES. No signature is
 * produced or verified, and no key / trust-policy / revocation is resolved, in
 * this slice (signature verification is never a FORGE responsibility).
 */
export const RECEIPT_AUTHENTICITY_FIELDS = Object.freeze([
  'publisher_signature',
  'signing_key_id',
  'trust_policy_ref',
  'revocation_ref',
]);

/**
 * Absolute ceiling for `skillopt_config.bounded_edit_budget` (SDD §11, D-7).
 * A bundle declaring a budget above this is rejected at Echelon's receiving end
 * regardless of internal agreement. Referenced here as a downstream-emission /
 * conformance constant only — S03-A enforces nothing.
 */
export const MAX_ALLOWED_BUDGET = 10;
