/**
 * src/bundle/members.js
 * ConstructAdmissionBundle — member set + local artifact layout target (shape only).
 *
 * Shape/constants only (FORGE cycle-002 / sprint-03 slice S03-A). No bundle is
 * assembled or written to disk here; these constants are the stable target a
 * future emitter slice (S03-B+) builds against. Grounded in SDD §5 (Proposed
 * Artifact Layout) and the Cycle-113 receiving contract (invariants L-1..L-5).
 *
 * @module bundle/members
 */

/** manifest.json — ConstructCapabilityManifest (SDD §6). REQUIRED member. */
export const MANIFEST_MEMBER = 'manifest.json';

/** SKILL.md — frontmatter + synthesis body + SLOW_UPDATE region (SDD §11). REQUIRED member. */
export const SKILL_MEMBER = 'SKILL.md';

/** reality.md — protected parameter-provenance manifest (SDD §10). REQUIRED member. */
export const REALITY_MEMBER = 'reality.md';

/** handoff.md — theatre trigger conditions, bounded-editable (SDD §12). REQUIRED member. */
export const HANDOFF_MEMBER = 'handoff.md';

/** bundle-receipt.json — digest + optional publisher-authenticity fields (SDD §13). REQUIRED member. */
export const BUNDLE_RECEIPT_MEMBER = 'bundle-receipt.json';

/**
 * The exactly-five members of a ConstructAdmissionBundle directory (SDD §5; L-2:
 * all five REQUIRED). Order is the layout's documentation order; membership — not
 * order — is the closed set.
 *
 * Note (shape, not built here): bundle-receipt.json's own `members[]` digest
 * covers the four NON-receipt files per SDD §13.1 / D-1 — that is an emitter
 * concern (S03-D), not defined in this slice.
 */
export const BUNDLE_MEMBERS = Object.freeze([
  MANIFEST_MEMBER,
  SKILL_MEMBER,
  REALITY_MEMBER,
  HANDOFF_MEMBER,
  BUNDLE_RECEIPT_MEMBER,
]);

/**
 * Local artifact layout target: a content-addressed directory rooted at one
 * construct slug (SDD §5). `<construct_slug>` is a placeholder substituted at
 * emit time (S03-B+); it matches `^[a-z0-9][a-z0-9-]*$` and equals the directory
 * name (L-1/L-4). Documented shape target only — S03-A writes nothing to disk.
 */
export const LOCAL_LAYOUT_TARGET = 'construct-bundle/<construct_slug>/';

/**
 * Proposed LATER (S03-B+) local output namespace for emitted bundles. Documented
 * here as a shape target ONLY. S03-A MUST NOT write to this path, and a later
 * slice MUST verify whether `build/` is gitignored before writing (sprint plan
 * §1.1) — do not edit .gitignore without explicit operator approval.
 */
export const LATER_OUTPUT_NAMESPACE = 'build/construct-bundles/<construct_slug>/';
