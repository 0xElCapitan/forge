# Canonicalization — JCS Subset (jcs-subset/v0)

## Overview

FORGE uses a JSON Canonicalization Scheme (JCS) subset for deterministic serialization of JSON data before hashing. This ensures that semantically identical JSON objects always produce the same hash, regardless of key ordering or whitespace.

## What It Covers

The `jcs-subset/v0` canonicalization handles all JSON types that appear in FORGE's data shapes:

- **Objects**: Keys sorted lexicographically (Unicode code point order)
- **Arrays**: Elements preserved in original order
- **Strings**: Serialized with `JSON.stringify()` (handles escaping)
- **Numbers**: Serialized with `JSON.stringify()` (finite numbers only)
- **Booleans**: `true` / `false`
- **null**: `null`
- **Nested structures**: Recursive application of the above rules

## What It Does NOT Cover

This is **not** a full RFC 8785 (JCS) implementation. The following are explicitly unsupported and will throw `TypeError`:

| Type | Behavior | Rationale |
|------|----------|-----------|
| `Infinity` / `-Infinity` | Throws TypeError | Not valid JSON per RFC 8259 |
| `NaN` | Throws TypeError | Not valid JSON per RFC 8259 |
| `undefined` | Throws TypeError | Not a JSON type |
| `BigInt` | Throws TypeError | No JSON representation |
| `Date` objects | Throws TypeError | Must be converted to ISO string before canonicalization |
| `Map` / `Set` | Throws TypeError | Must be converted to Object/Array first |

### RFC 8785 Differences

Full RFC 8785 specifies:
- ES6 number serialization rules (shortest representation)
- Specific Unicode escape handling
- Handling of `-0` vs `0`

The FORGE subset relies on V8's `JSON.stringify()` for number serialization, which is conformant for all finite numbers that appear in FORGE's data. The subset does not implement custom Unicode escape handling since FORGE data uses ASCII-range keys.

## Implementation

**File:** `src/receipt/canonicalize.js`

```javascript
import { canonicalize } from './src/receipt/canonicalize.js';

const canonical = canonicalize({ b: 2, a: 1 });
// Returns: '{"a":1,"b":2}'
```

## Upgrade Path

If FORGE's data shapes evolve to include types not covered by this subset:

1. Replace `src/receipt/canonicalize.js` with a full JCS library (e.g., `canonicalize` npm package)
2. Update the `input_canonicalization` field from `jcs-subset/v0` to `jcs/v1` (or equivalent)
3. All new receipts will use the new canonicalization
4. Old receipts remain verifiable since they record which canonicalization was used

## Determinism Guarantee

The canonicalization is deterministic: given the same input, it always produces the same output. This is verified by tests that call `canonicalize()` 100 times on the same input and assert identical results.

## Idempotence

`canonicalize(JSON.parse(canonicalize(x))) === canonicalize(x)` — canonicalizing an already-canonical string (after parse) produces the same result.
