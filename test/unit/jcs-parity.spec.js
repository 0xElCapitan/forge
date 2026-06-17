/**
 * test/unit/jcs-parity.spec.js
 * FORGE Cycle-003 Sprint 02 (T2.2) — jcs-subset/v0 canonicalization parity.
 *
 * Loads the jointly-owned vectors at spec/jcs-test-vectors.json and checks the
 * existing in-repo canonicalizer (src/receipt/canonicalize.js) against them:
 *   - every `canonical` vector: exact byte/string equality with canonicalize();
 *   - every `reject` vector: canonicalize() throws (fail-closed).
 *
 * The vectors are authoritative for BOTH the FORGE bundle_digest canonicalization
 * and the Echelon cert_hash parity basis (Echelon recomputes cert_hash over the
 * envelope minus forge_seam.calibration_ref using the same jcs-subset/v0). This
 * test asserts the FORGE side of that parity basis only.
 *
 * It exercises ONLY existing in-repo code (canonicalize) and changes NO
 * canonicalization behavior — canonicalize.js is byte-unchanged this sprint
 * (COMPAT-5: the subset is kept, no full-RFC swap). The BUILDERS map below is
 * test scaffolding that constructs the values JSON cannot literally hold
 * (Infinity/NaN/undefined/BigInt/Date/function/symbol and -0); see
 * `builder_tokens` in the vectors file.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { canonicalize } from '../../src/receipt/canonicalize.js';

const VECTORS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'spec',
  'jcs-test-vectors.json',
);
const vectors = JSON.parse(readFileSync(VECTORS_PATH, 'utf8'));

/**
 * Construct the values JSON cannot literally hold. Keyed by the `build` token a
 * vector carries in place of `input` (documented under `builder_tokens` in the
 * vectors file). These are JS reference values only — they do not touch the
 * canonicalizer.
 */
const BUILDERS = {
  negative_zero: () => -0,
  object_with_undefined_value: () => ({ a: 1, b: undefined, c: 3 }),
  infinity: () => Infinity,
  negative_infinity: () => -Infinity,
  nan: () => NaN,
  undefined: () => undefined,
  bigint: () => BigInt(42),
  date: () => new Date(0),
  function: () => () => {},
  symbol: () => Symbol('x'),
  object_with_infinity: () => ({ value: Infinity }),
  array_with_nan: () => [NaN],
};

/** Resolve a vector to its concrete input value (literal `input` or a builder). */
function materialize(vec) {
  if ('build' in vec) {
    const build = BUILDERS[vec.build];
    if (!build) throw new Error(`jcs-parity: unknown build token '${vec.build}' for vector '${vec.name}'`);
    return build();
  }
  return vec.input;
}

// ── Metadata / parity-basis assertions ────────────────────────────────────────

describe('jcs-parity — vector metadata', () => {
  it('names the jcs-subset/v0 canonicalization', () => {
    assert.equal(vectors.canonicalization, 'jcs-subset/v0');
    assert.equal(vectors.reference_implementation, 'src/receipt/canonicalize.js');
  });

  it('documents the bundle_digest + cert_hash parity basis', () => {
    assert.ok(vectors.parity_basis, 'parity_basis present');
    assert.equal(typeof vectors.parity_basis.bundle_digest, 'string');
    assert.ok(vectors.parity_basis.bundle_digest.includes('bundle_digest'), 'bundle_digest basis names bundle_digest');
    assert.equal(typeof vectors.parity_basis.cert_hash, 'string');
    // The cert_hash basis must name the same canonicalization AND the calibration_ref
    // exclusion that defines Echelon's recompute surface.
    assert.ok(vectors.parity_basis.cert_hash.includes('cert_hash'), 'cert_hash basis names cert_hash');
    assert.ok(vectors.parity_basis.cert_hash.includes('calibration_ref'), 'cert_hash basis names the calibration_ref exclusion');
    assert.ok(vectors.parity_basis.cert_hash.includes('jcs-subset/v0'), 'cert_hash basis names jcs-subset/v0');
  });

  it('documents the subset-vs-RFC 8785 deltas', () => {
    assert.ok(Array.isArray(vectors.subset_vs_rfc8785_deltas));
    assert.ok(vectors.subset_vs_rfc8785_deltas.length >= 1);
  });

  it('carries non-empty canonical and reject vector sets', () => {
    assert.ok(Array.isArray(vectors.canonical_vectors) && vectors.canonical_vectors.length > 0);
    assert.ok(Array.isArray(vectors.reject_vectors) && vectors.reject_vectors.length > 0);
  });
});

// ── Canonical vectors: exact byte/string equality vs in-repo canonicalize ─────

describe('jcs-parity — canonical vectors (byte-equality vs canonicalize.js)', () => {
  for (const vec of vectors.canonical_vectors) {
    it(`canonical: ${vec.name}`, () => {
      assert.equal(canonicalize(materialize(vec)), vec.canonical);
    });
  }
});

// ── Reject vectors: fail-closed throw ─────────────────────────────────────────

describe('jcs-parity — reject vectors (fail-closed throw)', () => {
  for (const vec of vectors.reject_vectors) {
    it(`reject: ${vec.name}`, () => {
      assert.throws(() => canonicalize(materialize(vec)), TypeError);
    });
  }
});
