/**
 * src/bundle/slug.js
 * ConstructAdmissionBundle producer — construct_slug path-safety guard (S03-B).
 *
 * Producer-side path-traversal prevention: every construct_slug is validated
 * against the locked layout invariant L-1 pattern BEFORE it is substituted into
 * any filesystem path (`build/construct-bundles/<construct_slug>/`). This is the
 * single chokepoint that the assembly (assemble.js) and disk-emit (emit.js)
 * modules call before constructing a path.
 *
 * SCOPE NOTE: this is PRODUCER-side path safety, NOT Echelon admission
 * validation. FORGE builds no receiving-end parser/validator/admission gate
 * (SDD §1, §16). The guard exists solely so a malformed or hostile slug cannot
 * escape the output namespace via `../`, path separators, or an absolute path.
 *
 * @module bundle/slug
 */

/**
 * Locked layout invariant L-1 (Receiving_Contract §1, SDD §5): a construct slug
 * is filesystem-safe and equals the bundle directory name.
 *
 * Anchored `^...$` with NO `m` flag — in JavaScript `$` matches only the true
 * end of input (it does NOT match before a trailing newline as Python's `$`
 * would), so a `"good\n../evil"`-style payload cannot satisfy the pattern.
 */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Assert that `slug` is a path-safe construct slug, returning it unchanged on
 * success. Throws BEFORE the caller constructs any path, so an invalid slug
 * never reaches `path.join` / the filesystem.
 *
 * Rejects (non-exhaustive): non-strings, the empty string, `..`, `.`, a leading
 * `/`, `\`, or drive-absolute path, any path separator, uppercase, and any
 * character outside `[a-z0-9-]` (or a leading `-`).
 *
 * @param {unknown} slug
 * @returns {string} the validated slug
 * @throws {Error} if `slug` is not a string matching {@link SLUG_PATTERN}
 */
export function assertValidSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
    throw new Error(
      `bundle: invalid construct_slug ${JSON.stringify(slug)} — must match ` +
        `${SLUG_PATTERN} (producer path-safety guard, L-1)`,
    );
  }
  return slug;
}
