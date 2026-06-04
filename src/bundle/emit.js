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

/**
 * Default LOCAL output root for emitted bundles — the confirmed-gitignored
 * `build/construct-bundles/` namespace (S03-A `LATER_OUTPUT_NAMESPACE`). Callers
 * may pass an absolute `outputRoot`; the slug is path-guarded either way.
 */
export const DEFAULT_BUILD_OUTPUT_ROOT = join('build', 'construct-bundles');

/**
 * Write the five members of an already-assembled bundle to
 * `<outputRoot>/<slug>/`, returning the bundle directory path.
 *
 * The slug is re-asserted against L-1 (defense in depth) BEFORE it is joined
 * into a path, so a hostile slug cannot escape `outputRoot` via `../`, a path
 * separator, or an absolute path. Member filenames come from the fixed S03-A
 * member-name constants (not caller input), so only the slug needs guarding.
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
