// test/unit/derive-vectors.spec.js
//
// Cycle-004 S01 kernel conformance (§8.2, F-5). Loads the ACCEPTED, frozen
// product vector oracle `spec/derive-vectors.json`, validates its integrity
// digests, and recomputes every consumer:"product" vector in-memory against
// the product primitives, asserting exact deep equality AND exact canonical
// digest equality. The kernel conforms to the vectors; the test NEVER modifies
// or regenerates the file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { canonicalize } from '../../src/receipt/canonicalize.js';
import { sha256 } from '../../src/receipt/hash.js';
import {
  parseDecimalRational, hf1Rank, hf1Quantile, existenceBound, existenceMinN, orderStatCIRanks,
} from '../../src/derive/quantile.js';
import { qualifyingObservations, effectiveInformation, log2SpanDaysFloor } from '../../src/derive/effective-information.js';
import { trailingWindow } from '../../src/derive/window.js';
import { deriveThresholdParameter } from '../../src/derive/kernel.js';
import { parseExperimentalOptions } from '../../src/derive/experimental-path.js';

const ACCEPTED_ROOT_DIGEST = 'sha256:59a14ea4a8142828fe8b8b192de2524cf31b174e97728648f19d3a1a25c6a317';

const specPath = fileURLToPath(new URL('../../spec/derive-vectors.json', import.meta.url));
const doc = JSON.parse(readFileSync(specPath, 'utf8'));
const vectors = doc.vectors.filter(v => v.consumer === 'product'); // load only product vectors

const alphaFloat = (s) => { const a = parseDecimalRational(s); return a.num / a.den; };

// op → product-primitive dispatcher (value ops). Each returns the computed value.
const DISPATCH = {
  hf1Rank:              (i) => hf1Rank(i.n, parseDecimalRational(i.p)),
  hf1Quantile:          (i) => hf1Quantile(i.sortedValues, parseDecimalRational(i.p)),
  existenceBound:       (i) => { const bv = existenceBound(i.n, parseDecimalRational(i.p)); return { bound_value: bv, passes: bv <= alphaFloat(i.alpha) }; },
  existenceMinN:        (i) => existenceMinN(parseDecimalRational(i.p), parseDecimalRational(i.alpha)),
  orderStatCIRanks:     (i) => orderStatCIRanks(i.n, parseDecimalRational(i.p), parseDecimalRational(i.alpha)),
  log2SpanDaysFloor:    (i) => log2SpanDaysFloor(i.span_ms),
  effectiveInformation: (i) => effectiveInformation(i.qualifying),
  qualifyingObservations: (i) => qualifyingObservations(i.events),
  trailingWindow:       (i) => trailingWindow(i.qualifying, i.endMs, i.window),
  deriveThresholdParameter: (i) => deriveThresholdParameter(i.events, i.config),
  parseExperimentalOptions: (i) => parseExperimentalOptions(i.options),
};

// the exhaustive set of product categories this suite knows how to dispatch
const KNOWN_CATEGORIES = new Set([
  'hf1-interior-rank', 'hf1-boundary-rank', 'hf1-float-ceil-trap',
  'existence-bound-edge', 'existence-bound-underflow', 'existence-minn', 'ci-ranks',
  'ei-log2-span', 'ei-triple', 'qualifying-order', 'window-nmin',
  'kernel-derive-reject', 'option-validation',
]);

const isThrowVector = (v) => v.expected && typeof v.expected === 'object' && v.expected.throws === true;

test('vector-set integrity: unique ids, per-vector digests, and the accepted root digest', () => {
  const ids = vectors.map(v => v.id);
  assert.equal(new Set(ids).size, ids.length, 'vector ids must be unique');

  for (const v of vectors) {
    // expected_digest = sha256(canonicalize(expected))
    assert.equal(sha256(canonicalize(v.expected)), v.expected_digest, `${v.id}: expected_digest`);
    // entry_digest = sha256(canonicalize(vector without entry_digest)); no self-reference
    const { entry_digest, ...rest } = v;
    assert.ok(!('entry_digest' in rest), `${v.id}: entry_digest self-reference`);
    assert.equal(sha256(canonicalize(rest)), v.entry_digest, `${v.id}: entry_digest`);
  }

  // product_subset_digest = sha256(canonicalize(id-sorted [{id, entry_digest}]))
  const subset = vectors
    .map(v => ({ id: v.id, entry_digest: v.entry_digest }))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const root = sha256(canonicalize(subset));
  assert.equal(root, doc.product_subset_digest, 'recomputed product_subset_digest matches file');
  assert.equal(root, ACCEPTED_ROOT_DIGEST, 'product_subset_digest matches the accepted value exactly');
});

test('every product category has a dispatcher and no unknown category appears', () => {
  for (const v of vectors) {
    assert.ok(KNOWN_CATEGORIES.has(v.category), `${v.id}: unknown product category "${v.category}"`);
    assert.ok(typeof DISPATCH[v.op] === 'function', `${v.id}: no dispatcher for op "${v.op}"`);
  }
});

test('every consumer:"product" vector recomputes to exact deep + digest equality', () => {
  for (const v of vectors) {
    if (isThrowVector(v)) {
      assert.throws(() => DISPATCH[v.op](v.input), `${v.id}: expected the primitive to throw`);
      continue;
    }
    const computed = DISPATCH[v.op](v.input);
    assert.deepStrictEqual(computed, v.expected, `${v.id}: computed !== expected (exact, no tolerance)`);
    assert.equal(sha256(canonicalize(computed)), v.expected_digest, `${v.id}: sha256(canonicalize(computed)) !== expected_digest`);
  }
});
