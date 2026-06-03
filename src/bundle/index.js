/**
 * src/bundle/index.js
 * ConstructAdmissionBundle producer — shape/constants surface (S03-A).
 *
 * Minimal re-export surface for the bundle SHAPE: the five-member layout target,
 * closed enums, manifest/receipt field-name sets, the construct-local reference
 * field, the downstream budget ceiling, and version-field semantics.
 *
 * SCOPE (FORGE cycle-002 / sprint-03 slice S03-A): shape/constants ONLY. This
 * module —
 *   - assembles no bundle and writes nothing to disk;
 *   - contains no emitter, assembly, validation, admission, or parser logic;
 *   - produces and verifies no signatures (authenticity fields are NAMES only);
 *   - imports neither ProposalEnvelope (src/ir) nor the trust / selector / receipt
 *     runtimes — it imports only its own sibling shape modules;
 *   - is NOT imported by any live runtime path.
 *
 * Future slices (S03-B+) build the emitter against these constants. All
 * parse/validate/reject/admit semantics are Echelon's receiving-end machinery,
 * which FORGE neither builds nor invokes (SDD §1, §4.3).
 *
 * @module bundle
 */

export {
  MANIFEST_MEMBER,
  SKILL_MEMBER,
  REALITY_MEMBER,
  HANDOFF_MEMBER,
  BUNDLE_RECEIPT_MEMBER,
  BUNDLE_MEMBERS,
  LOCAL_LAYOUT_TARGET,
  LATER_OUTPUT_NAMESPACE,
} from './members.js';

export {
  CAPABILITY_FLAGS,
  SOURCE_SIDE,
  ORACLE_ROLE,
  TRUST_TIER,
  HANDOFF_TEMPLATE,
} from './enums.js';

export {
  MANIFEST_REQUIRED_FIELDS,
  MANIFEST_OPTIONAL_FIELDS,
  CONSTRUCT_SOURCE_REF_FIELD,
  RECEIPT_AUTHENTICITY_FIELDS,
  MAX_ALLOWED_BUDGET,
} from './fields.js';

export { IR_VERSION_FLOOR } from './versioning.js';
