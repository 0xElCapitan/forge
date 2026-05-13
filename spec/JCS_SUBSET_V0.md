# `jcs-subset/v0` — Canonical JSON Spec for FORGE Receipts

**Version:** v0
**Status:** Stable — used by all `forge-receipt/v0` signed payloads
**Reference implementation:** `src/receipt/canonicalize.js`
**Test vectors:** `test/unit/canonicalize.spec.js` + §6 of this document
**Audience:** anyone porting `jcs-subset/v0` to another language (Python, Rust, Go, etc.) for cross-system replay compatibility

---

## 1. Purpose

`jcs-subset/v0` is the canonicalization FORGE applies to JSON inputs before hashing them into `materials.digest` and to envelopes before hashing them into `subject.digest`. For cross-system replay — where another implementation (e.g., Echelon's Python OSINT substrate) must produce byte-identical canonical output for the same JSON value — both sides MUST implement the algorithm in this spec, not RFC 8785, not their language's default JSON serializer.

The subset is narrower than full RFC 8785. It is sufficient for FORGE's data shapes (no `Date`, no `BigInt`, no `Infinity`/`NaN`, no non-plain objects) and rejects anything it doesn't cover. Porters do not need to handle the rejected types.

## 2. Scope

### Supported JSON value types

| Type | Behavior |
|------|----------|
| `null` | Emit literal `null` |
| Boolean | Emit literal `true` or `false` |
| Number (finite only) | ECMA-262 §6.1.6.1.13 ToString(Number) — see §3.4 |
| String | ECMA-262 Quote algorithm — see §3.5 |
| Array | Recursive serialization preserving insertion order — see §3.2 |
| Object (plain) | Keys sorted by UTF-16 code unit order, recursive value serialization — see §3.3 |

### Unsupported — implementations MUST reject (throw / error)

| Type | Reason |
|------|--------|
| `Infinity` / `-Infinity` | Not valid JSON per RFC 8259 |
| `NaN` | Not valid JSON per RFC 8259 |
| `undefined` (as a top-level value, or as array element) | Not a JSON type |
| `BigInt` | No standardized JSON representation |
| `Date` objects (or other non-plain objects) | Source must convert to ISO 8601 string before canonicalization |
| Functions, Symbols | Not JSON values |
| Lone Unicode surrogates | Source must produce well-formed UTF-16 strings before canonicalization |

### Special case: `undefined` as an **object property value**

- JavaScript reference behavior (V8 `JSON.stringify`): the property is **skipped** silently. `{a:1, b:undefined, c:3}` canonicalizes to `{"a":1,"c":3}`.
- Python and other languages without a native `undefined` cannot produce this case. Port implementations need not handle it explicitly — if the input value system has no `undefined` concept, this case cannot arise.

## 3. Algorithm

### 3.1 Top-level

`canonicalize(value)` produces a byte string. The byte string is the canonical JSON serialization. It is the input to `sha256()` for receipt digest computation.

Output is always:
- Pure UTF-8
- No insignificant whitespace (no spaces between tokens, no line breaks, no tabs, no padding)
- A valid JSON document (re-parseable with any conformant JSON parser)

### 3.2 Arrays

`[v1, v2, ..., vn]` →
```
"[" + canonicalize(v1) + "," + canonicalize(v2) + "," + ... + canonicalize(vn) + "]"
```

Element order is **preserved as given**. No sorting. No deduplication. Empty array → `[]`.

### 3.3 Objects

For each plain object `{k1: v1, k2: v2, ..., kn: vn}`:

1. Collect keys.
2. Sort keys by **UTF-16 code unit order** (equivalent to JavaScript `String.prototype.localeCompare` with `'co-unicode'` collation, or simply `Array.prototype.sort` on strings with no comparator). This matches RFC 8785 §3.2.3 key-sorting requirement.
3. For each sorted key `k`, if `v[k]` is the JavaScript `undefined`, **skip the entry** (see §2 special case). Otherwise emit `canonicalize(k) + ":" + canonicalize(v[k])`.
4. Join emitted entries with `,` and wrap with `{` `}`.

Empty object → `{}`.

**Critical for porting**: UTF-16 code unit order is **not** the same as code-point order for non-BMP characters. For all-BMP keys (which covers FORGE's current data shapes) the two orders coincide. Porters operating on language types that natively use UTF-8 (e.g., Python `str`) must re-encode keys to UTF-16 and sort by code unit value to match.

### 3.4 Numbers

Emit per **ECMA-262 §6.1.6.1.13** `Number::toString(m)` (the ES6 NumberToString algorithm). This is what V8's `JSON.stringify` produces for any finite Number.

Concretely:

| Input | Output |
|-------|--------|
| `0` or `-0` | `0` (negative zero is normalized to `0`) |
| Positive integer `m`, `m < 10^21` | Decimal integer literal, no leading zeros, no decimal point |
| Negative integer | `-` followed by absolute-value rule |
| Finite float | Shortest decimal that roundtrips, with scientific notation if `n > 21` or `n <= -6` (see ES6 spec for the exact threshold) |

Examples (these are the load-bearing edge cases for cross-language porting):

| Input | Output | Note |
|-------|--------|------|
| `0` | `0` | |
| `-0` | `0` | **Diverges from Python `json.dumps(-0.0)` which emits `"-0.0"`** |
| `42` | `42` | |
| `-7` | `-7` | |
| `3.14` | `3.14` | |
| `1.5` | `1.5` | |
| `1e20` | `100000000000000000000` | `n = 21`, threshold-included → integer literal |
| `1e21` | `1e+21` | `n = 22 > 21` → scientific notation |
| `1e-6` | `0.000001` | `n = -5`, `-6 < -5 <= 0` → fixed notation |
| `1e-7` | `1e-7` | `n = -6`, threshold-excluded → scientific notation |

`Infinity`, `-Infinity`, and `NaN` MUST throw — they have no valid emission.

**Porting note for Python**: `json.dumps(n)` does **not** match ES6 NumberToString in all cases. Specifically, it differs on `-0.0`, on large integers near the `10^21` boundary, and on very small numbers near the `10^-6` boundary. A correct port must either (a) reimplement the ECMA-262 algorithm, or (b) use a library that implements it (e.g., `dtoa` for the shortest-roundtrip choice), then apply the threshold logic for fixed vs scientific format.

### 3.5 Strings

Emit per **ECMA-262 §24.5.2.2** `Quote(value)` (which is the algorithm V8's `JSON.stringify` uses for strings, and which RFC 8785 also references).

Rules:

1. Output begins and ends with `"` (U+0022).
2. Inside the quotes, characters are emitted as follows:

| Input character | Output |
|-----------------|--------|
| `"` (U+0022) | `\"` |
| `\` (U+005C) | `\\` |
| U+0008 (backspace) | `\b` |
| U+0009 (tab) | `\t` |
| U+000A (line feed) | `\n` |
| U+000C (form feed) | `\f` |
| U+000D (carriage return) | `\r` |
| Other U+0000 to U+001F | `\u00XX` (4-hex-digit lowercase escape; e.g., U+0001 → ``) |
| U+0020 to U+007E except `"` and `\` | Emitted as-is (single ASCII byte) |
| U+007F and above (non-ASCII) | Emitted as **raw UTF-8 bytes** (NOT escaped) |

Note: V8's `JSON.stringify` uses lowercase hex digits in `\u` escapes. Implementations MUST emit lowercase. (`€`, not `€`.)

**Porting note for Python**: `json.dumps(s)` defaults to `ensure_ascii=True` which escapes all non-ASCII characters as `\uXXXX`. This produces different bytes than `jcs-subset/v0`. The Python port MUST use `ensure_ascii=False`:

```python
import json
json.dumps(s, ensure_ascii=False, separators=(',', ':'))
```

Even then, Python's `json.dumps` emits forward-slash `/` unescaped (matching V8 and `jcs-subset/v0`), so no extra handling is needed there.

## 4. Behavioral differences from RFC 8785

`jcs-subset/v0` differs from full RFC 8785 in the following ways:

| Aspect | RFC 8785 | `jcs-subset/v0` |
|--------|----------|-----------------|
| Number serialization | ES6 NumberToString | ES6 NumberToString (via V8 `JSON.stringify`) — **same** |
| Key sorting | UTF-16 code unit order | UTF-16 code unit order — **same** |
| String escaping | ECMA-262 Quote algorithm | ECMA-262 Quote algorithm — **same** |
| `Infinity`, `NaN` | Not specified (input must not contain) | Rejects with error |
| `BigInt`, `Date`, `Map`, `Set` | Not specified | Rejects with error |
| Lone surrogates | Replace with U+FFFD | Rejects (or passes through as-is depending on input; FORGE data should never contain) |

The intent is: for any input that **both** specs accept, `jcs-subset/v0` and RFC 8785 produce **byte-identical output**. The subset's narrower domain (rejecting non-finite numbers, exotic types) is the only true divergence. A correct RFC 8785 implementation that happens to reject FORGE-unsupported types upstream is effectively `jcs-subset/v0`-compatible.

This means: **drop-in libraries that fully implement RFC 8785 are likely fine** as long as the input has been pre-validated to FORGE shapes (no `Infinity`, no `NaN`, etc.). The subset's rejection behavior is the safety net, not the canonicalization itself.

## 5. Implementation pitfalls for porters

Porter checklist:

1. **Number serialization**: Verify your language's default JSON serializer against the §3.4 examples. Most don't match. Implement ES6 NumberToString explicitly or use a vetted library.
2. **String escaping (`ensure_ascii`)**: For Python, use `ensure_ascii=False`. For other languages, check whether the default escapes non-ASCII; override if so.
3. **Key sorting (UTF-16)**: Sort by UTF-16 code unit, not code point or byte. For ASCII-only keys it doesn't matter; for any non-ASCII keys it does.
4. **No whitespace separators**: For Python, use `separators=(',', ':')`. Default `json.dumps` adds spaces.
5. **Negative zero**: Test that `-0.0` canonicalizes to `0`, not `-0` or `-0.0`.
6. **Lowercase hex in `\u` escapes**: `€`, not `€`.
7. **Recursion**: The algorithm is naturally recursive over arrays and objects. Iteration-with-stack works too; key sort is the only place ordering changes.
8. **Validation, not transformation**: The algorithm does not coerce types. Pre-validate inputs against §2.

## 6. Test vectors

Implementations of `jcs-subset/v0` MUST produce byte-identical output for the following test cases. Inputs are presented as their natural JS literal form; outputs are the exact UTF-8 byte sequences (shown as text, but no implicit normalization or transformation should be performed).

### 6.1 Primitives

| Input | Expected output |
|-------|-----------------|
| `null` | `null` |
| `true` | `true` |
| `false` | `false` |
| `0` | `0` |
| `-0` | `0` |
| `42` | `42` |
| `-7` | `-7` |
| `3.14` | `3.14` |
| `1.5` | `1.5` |
| `1e20` | `100000000000000000000` |
| `1e21` | `1e+21` |
| `1e-6` | `0.000001` |
| `1e-7` | `1e-7` |
| `""` | `""` |
| `"hello"` | `"hello"` |
| `"hello\nworld"` | `"hello\nworld"` (with literal `\n` two characters, not newline) |
| `'say "hi"'` | `"say \"hi\""` |
| `"€"` (U+20AC) | `"€"` (raw UTF-8: bytes `E2 82 AC` inside quotes) |
| `""` (U+0001) | `""` |

### 6.2 Arrays

| Input | Expected output |
|-------|-----------------|
| `[]` | `[]` |
| `[3, 1, 2]` | `[3,1,2]` |
| `[42, "hello", null, true, false, {b:1, a:2}]` | `[42,"hello",null,true,false,{"a":2,"b":1}]` |
| `[[1, 2], [3, 4]]` | `[[1,2],[3,4]]` |

### 6.3 Objects

| Input | Expected output |
|-------|-----------------|
| `{}` | `{}` |
| `{b: 1, a: 2}` | `{"a":2,"b":1}` |
| `{z: {b: {d:1, c:2}, a:3}, y:4}` | `{"y":4,"z":{"a":3,"b":{"c":2,"d":1}}}` |
| `{"€": "Euro Sign", "\r": "Carriage Return", "alpha": "Alpha"}` | `{"\r":"Carriage Return","alpha":"Alpha","€":"Euro Sign"}` |

Note the carriage-return key sorts first (U+000D < U+0061 < U+20AC under UTF-16 code unit order).

### 6.4 FORGE-shaped composite

This vector matches a representative FORGE envelope fragment:

```js
{
  feed_id: 'usgs_m4.5_hour',
  proposals: [
    { template: 'threshold_gate', params: { threshold: 5.0, window_hours: 24 } },
    { template: 'cascade', params: { trigger_threshold: 6.0, bucket_count: 5 } }
  ],
  feed_profile: {
    cadence: { classification: 'event_driven', median_ms: 4500000 },
    distribution: { type: 'unbounded_numeric', min: 4.5, max: 7.1 }
  }
}
```

Expected output (single line, no whitespace):

```
{"feed_id":"usgs_m4.5_hour","feed_profile":{"cadence":{"classification":"event_driven","median_ms":4500000},"distribution":{"max":7.1,"min":4.5,"type":"unbounded_numeric"}},"proposals":[{"params":{"threshold":5,"window_hours":24},"template":"threshold_gate"},{"params":{"bucket_count":5,"trigger_threshold":6},"template":"cascade"}]}
```

Notes on this vector:
- `5.0` and `6.0` serialize as `5` and `6` (ES6 NumberToString drops trailing zero for whole-number floats).
- Object keys at every level are sorted (`cadence` before `distribution`; `max` before `min` before `type` inside `distribution`; etc.).
- Array element order is preserved (`threshold_gate` before `cascade`).

### 6.5 Cross-implementation handshake

For the bilateral fixture-fingerprint handshake referenced in Tobias's cycle-107.1 plan: implementations on both sides compute `sha256(canonicalize(vector))` for each test vector above and compare the resulting digests. Byte-identical canonical output produces identical digests. Any divergence is a porting bug.

A reference digest table can be generated by the FORGE reference implementation and shared as `forge-shared-canonical-vectors.json` (the file Tobias's plan re-baselines).

## 7. Versioning

`jcs-subset/v0` is identified in receipt material by the `canonicalization` field on the `materials` block:

```json
"materials": {
  "digest": "sha256:...",
  "canonicalization": "jcs-subset/v0",
  "uri": null
}
```

If FORGE migrates to full RFC 8785 or another canonicalization scheme in the future, the next version becomes `jcs/v1` (or equivalent) and is set on new receipts. Old receipts retain `jcs-subset/v0` and remain verifiable against this spec indefinitely.

Breaking changes to `jcs-subset/v0` would require a new version identifier per the receipt schema's stability commitments.

## 8. References

- **ECMA-262** (ECMAScript Language Specification) — particularly §6.1.6.1.13 (Number::toString) and §24.5.2.2 (Quote algorithm)
- **RFC 8785** — JSON Canonicalization Scheme (JCS), full specification (most behaviors of `jcs-subset/v0` are equivalent)
- **RFC 8259** — The JavaScript Object Notation (JSON) Data Interchange Format
- `src/receipt/canonicalize.js` — reference implementation
- `test/unit/canonicalize.spec.js` — reference test suite
- `docs/canonicalization.md` — user-facing introduction (defers to this spec for porting details)
- `spec/receipt-v0.json` — receipt schema (consumer of canonical output)
