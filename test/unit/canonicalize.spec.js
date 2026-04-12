/**
 * test/unit/canonicalize.spec.js
 * Comprehensive tests for the JCS-inspired canonical JSON serializer.
 *
 * ## Scope and Limitations
 *
 * This canonicalizer is a JCS-inspired SUBSET, NOT full RFC 8785.
 *
 * Supported (FORGE's JSON shapes):
 *   - Plain objects (recursive key sorting)
 *   - Arrays (order preserved)
 *   - Strings (standard JSON escaping)
 *   - Finite numbers (integers, floats, negative, zero)
 *   - Booleans (true, false)
 *   - null
 *
 * NOT supported (throws TypeError):
 *   - Infinity, -Infinity, NaN
 *   - undefined (as a value; skipped as object property)
 *   - BigInt
 *   - Date objects
 *   - Functions, Symbols
 *
 * Upgrade path: replace src/receipt/canonicalize.js with a full JCS
 * library (e.g., canonicalize-json) if FORGE needs RFC 8785 compliance.
 *
 * FR-3 (Canonicalization)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../src/receipt/canonicalize.js';

// ─── Key Sorting ────────────────────────────────────────────────────────────

describe('canonicalize — key sorting', () => {
  it('sorts top-level keys lexicographically', () => {
    assert.equal(
      canonicalize({ b: 1, a: 2 }),
      canonicalize({ a: 2, b: 1 }),
    );
    assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
  });

  it('sorts deeply nested object keys', () => {
    const input = { z: { b: { d: 1, c: 2 }, a: 3 }, y: 4 };
    const expected = '{"y":4,"z":{"a":3,"b":{"c":2,"d":1}}}';
    assert.equal(canonicalize(input), expected);
  });

  it('handles empty objects', () => {
    assert.equal(canonicalize({}), '{}');
  });
});

// ─── Array Handling ─────────────────────────────────────────────────────────

describe('canonicalize — arrays', () => {
  it('preserves array element order', () => {
    assert.equal(canonicalize([3, 1, 2]), '[3,1,2]');
  });

  it('handles arrays of mixed types', () => {
    const input = [42, 'hello', null, true, false, { b: 1, a: 2 }];
    const expected = '[42,"hello",null,true,false,{"a":2,"b":1}]';
    assert.equal(canonicalize(input), expected);
  });

  it('handles nested arrays', () => {
    assert.equal(canonicalize([[1, 2], [3, 4]]), '[[1,2],[3,4]]');
  });

  it('handles empty arrays', () => {
    assert.equal(canonicalize([]), '[]');
  });
});

// ─── Primitives ─────────────────────────────────────────────────────────────

describe('canonicalize — primitives', () => {
  it('null', () => assert.equal(canonicalize(null), 'null'));
  it('true', () => assert.equal(canonicalize(true), 'true'));
  it('false', () => assert.equal(canonicalize(false), 'false'));
  it('zero', () => assert.equal(canonicalize(0), '0'));
  it('negative zero becomes 0', () => assert.equal(canonicalize(-0), '0'));
  it('integer', () => assert.equal(canonicalize(42), '42'));
  it('negative integer', () => assert.equal(canonicalize(-7), '-7'));
  it('float', () => assert.equal(canonicalize(3.14), '3.14'));
  it('empty string', () => assert.equal(canonicalize(''), '""'));
  it('string with special chars', () => {
    assert.equal(canonicalize('hello\nworld'), '"hello\\nworld"');
  });
  it('string with quotes', () => {
    assert.equal(canonicalize('say "hi"'), '"say \\"hi\\""');
  });
});

// ─── JCS Test Vectors (applicable subset from RFC 8785) ─────────────────────

describe('canonicalize — JCS test vectors', () => {
  it('RFC 8785 §3.2.3 example: object key ordering', () => {
    // Simplified from RFC 8785 — tests lexicographic sort by code point
    const input = { '\u20ac': 'Euro Sign', '\r': 'Carriage Return', 'alpha': 'Alpha' };
    const result = canonicalize(input);
    // Keys sorted by JS string comparison: '\r' (U+000D) < 'alpha' < '\u20ac' (U+20AC)
    assert.equal(result, '{"\\r":"Carriage Return","alpha":"Alpha","\u20ac":"Euro Sign"}');
  });

  it('numbers serialize correctly', () => {
    // JCS requires specific number serialization
    assert.equal(canonicalize(1), '1');
    assert.equal(canonicalize(1.5), '1.5');
    assert.equal(canonicalize(1e20), '100000000000000000000');
  });
});

// ─── Unsupported Types (throws) ─────────────────────────────────────────────

describe('canonicalize — unsupported types throw', () => {
  it('Infinity throws TypeError', () => {
    assert.throws(() => canonicalize(Infinity), TypeError);
  });

  it('-Infinity throws TypeError', () => {
    assert.throws(() => canonicalize(-Infinity), TypeError);
  });

  it('NaN throws TypeError', () => {
    assert.throws(() => canonicalize(NaN), TypeError);
  });

  it('undefined throws TypeError', () => {
    assert.throws(() => canonicalize(undefined), TypeError);
  });

  it('BigInt throws TypeError', () => {
    assert.throws(() => canonicalize(BigInt(42)), TypeError);
  });

  it('Date object throws TypeError', () => {
    assert.throws(() => canonicalize(new Date()), TypeError);
  });

  it('undefined as object value is skipped (matches JSON.stringify)', () => {
    assert.equal(canonicalize({ a: 1, b: undefined, c: 3 }), '{"a":1,"c":3}');
  });
});

// ─── Idempotence ────────────────────────────────────────────────────────────

describe('canonicalize — idempotence', () => {
  it('canonicalize(JSON.parse(canonicalize(x))) === canonicalize(x)', () => {
    const inputs = [
      { z: [1, 'two', null], a: { c: true, b: false } },
      [1, 2, { b: 3, a: 4 }],
      'hello',
      42,
      null,
      true,
    ];

    for (const input of inputs) {
      const first = canonicalize(input);
      const roundtrip = canonicalize(JSON.parse(first));
      assert.equal(roundtrip, first, `Idempotence failed for: ${JSON.stringify(input)}`);
    }
  });
});

// ─── Stability ──────────────────────────────────────────────────────────────

describe('canonicalize — stability', () => {
  it('same input produces same output across 100 calls', () => {
    const input = {
      feed_id: 'usgs_m4.5_hour',
      proposals: [
        { template: 'threshold_gate', params: { threshold: 5.0, window_hours: 24 } },
        { template: 'cascade', params: { trigger_threshold: 6.0, bucket_count: 5 } },
      ],
      feed_profile: {
        cadence: { classification: 'event_driven', median_ms: 4500000 },
        distribution: { type: 'unbounded_numeric', min: 4.5, max: 7.1 },
      },
    };

    const reference = canonicalize(input);
    for (let i = 0; i < 100; i++) {
      assert.equal(canonicalize(input), reference, `Stability failed at iteration ${i}`);
    }
  });
});

// ─── Output Format ──────────────────────────────────────────────────────────

describe('canonicalize — output format', () => {
  it('output is valid JSON', () => {
    const input = { nested: { z: 1, a: [true, null, 'str'] } };
    const result = canonicalize(input);
    assert.doesNotThrow(() => JSON.parse(result));
  });

  it('output has no extra whitespace', () => {
    const result = canonicalize({ a: 1, b: [2, 3] });
    assert.ok(!result.includes(' '), 'Output should have no spaces');
    assert.ok(!result.includes('\n'), 'Output should have no newlines');
    assert.ok(!result.includes('\t'), 'Output should have no tabs');
  });
});
