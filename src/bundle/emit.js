/**
 * src/bundle/emit.js
 * ConstructAdmissionBundle producer — local disk emitter (S03-B).
 *
 * Writes an assembled 5-member bundle to a LOCAL output directory
 * `<outputRoot>/<construct_slug>/`. The default output root is the confirmed-
 * gitignored `build/construct-bundles/` namespace (S03-A LATER_OUTPUT_NAMESPACE;
 * .gitignore `build/`), so generated output is never tracked. S03-B does NOT
 * edit .gitignore and writes nothing into a tracked path.
 *
 * SCOPE (S03-B): local producer disk-write ONLY. No Echelon/backend writes, no
 * `backend/skills/` writes, no signature production, and no runtime import of
 * this module into any live FORGE path.
 *
 * NAMING: singular `src/bundle/` producer — unrelated to the pre-existing plural
 * `src/processor/bundles.js` (`buildBundle`); this module never imports it.
 *
 * @module bundle/emit
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleBundle } from './assemble.js';
import { assertValidSlug } from './slug.js';
import { BUNDLE_MEMBERS } from './index.js';

/**
 * Default LOCAL output root for emitted bundles — the confirmed-gitignored
 * `build/construct-bundles/` namespace (S03-A `LATER_OUTPUT_NAMESPACE`). Callers
 * may pass an absolute `outputRoot`; the slug is path-guarded either way.
 */
export const DEFAULT_BUILD_OUTPUT_ROOT = join('build', 'construct-bundles');

/**
 * Closed whitelist of writable member filenames — the S03-A BUNDLE_MEMBERS set.
 * A member name outside this set is refused before any path is joined (S03-D;
 * S03-B review LOW-1).
 */
const ALLOWED_MEMBER_FILES = new Set(BUNDLE_MEMBERS);

/**
 * Write the five members of an already-assembled bundle to
 * `<outputRoot>/<slug>/`, returning the bundle directory path.
 *
 * The slug is re-asserted against L-1 (defense in depth) BEFORE it is joined
 * into a path, so a hostile slug cannot escape `outputRoot` via `../`, a path
 * separator, or an absolute path. Each member filename is ALSO whitelisted against
 * the closed BUNDLE_MEMBERS set before it reaches `join` (S03-D; carries forward
 * S03-B review LOW-1), so a directly-constructed `assembled` carrying a hostile
 * member key cannot escape `<outputRoot>/<slug>/` either.
 *
 * @param {{ slug: string, members: Record<string,string> }} assembled
 * @param {object} [opts]
 * @param {string} [opts.outputRoot=DEFAULT_BUILD_OUTPUT_ROOT]
 * @returns {string} the bundle directory path written
 */
export function writeAssembledBundle(
  assembled,
  { outputRoot = DEFAULT_BUILD_OUTPUT_ROOT } = {},
) {
  assertValidSlug(assembled.slug); // guard BEFORE path construction
  // Whitelist every member filename against the closed S03-A BUNDLE_MEMBERS set
  // BEFORE any path is joined or directory created (S03-D; S03-B review LOW-1). A
  // directly-constructed `assembled` could carry a hostile key (e.g. '../evil');
  // refusing up front keeps a non-whitelisted member from escaping the bundle dir.
  for (const name of Object.keys(assembled.members)) {
    if (!ALLOWED_MEMBER_FILES.has(name)) {
      throw new Error(
        `bundle/emit: refusing to write unknown member '${name}' — not in BUNDLE_MEMBERS`,
      );
    }
  }
  const dir = join(outputRoot, assembled.slug);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(assembled.members)) {
    writeFileSync(join(dir, name), content, 'utf8');
  }
  return dir;
}

/**
 * Convenience: assemble a skeleton bundle from `input` and write it to disk.
 *
 * @param {object} input - forwarded to {@link assembleBundle}
 * @param {object} [opts]
 * @param {string} [opts.outputRoot=DEFAULT_BUILD_OUTPUT_ROOT]
 * @returns {{ dir: string, assembled: { slug: string, members: Record<string,string>, manifest: object, receipt: object } }}
 */
export function emitBundle(input, { outputRoot = DEFAULT_BUILD_OUTPUT_ROOT } = {}) {
  const assembled = assembleBundle(input);
  const dir = writeAssembledBundle(assembled, { outputRoot });
  return { dir, assembled };
}
