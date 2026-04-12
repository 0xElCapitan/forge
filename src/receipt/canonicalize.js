/**
 * src/receipt/canonicalize.js
 * JCS-inspired canonical JSON serializer for FORGE shapes.
 *
 * This is a JCS-inspired subset, NOT full RFC 8785. It covers the JSON
 * value types that appear in FORGE's pipeline output (objects, arrays,
 * strings, numbers, booleans, null). It deliberately throws on types
 * that FORGE shapes should never contain (Infinity, NaN, undefined,
 * BigInt, Date objects).
 *
 * Supported:
 *   - Objects with recursive key sorting (Object.keys().sort())
 *   - Arrays with stable element order
 *   - Strings, finite numbers, booleans, null
 *   - No insignificant whitespace
 *   - UTF-8 output (standard JSON string escaping)
 *
 * NOT supported (throws TypeError):
 *   - Infinity, -Infinity, NaN
 *   - undefined
 *   - BigInt
 *   - Date objects (or any non-plain object)
 *   - Functions, Symbols
 *
 * Upgrade path: replace this module with a full RFC 8785 (JCS) library
 * if FORGE needs to canonicalize arbitrary JSON beyond its own shapes.
 *
 * @module receipt/canonicalize
 */

/**
 * Canonicalize a JSON-compatible value into a deterministic string.
 *
 * Objects are serialized with lexicographically sorted keys. Arrays
 * preserve insertion order. Output contains no insignificant whitespace.
 *
 * @param {any} value - JSON-compatible value to canonicalize
 * @returns {string} Canonical JSON string
 * @throws {TypeError} If value contains unsupported types
 */
export function canonicalize(value) {
  return serialize(value);
}

/**
 * Recursive serializer.
 * @param {any} val
 * @returns {string}
 */
function serialize(val) {
  // null
  if (val === null) return 'null';

  // Check type
  const type = typeof val;

  // Primitives
  if (type === 'boolean') return val ? 'true' : 'false';

  if (type === 'number') {
    if (!Number.isFinite(val)) {
      throw new TypeError(`canonicalize: unsupported value ${val} (Infinity/NaN not allowed)`);
    }
    return JSON.stringify(val);
  }

  if (type === 'string') return JSON.stringify(val);

  // Unsupported primitives
  if (type === 'undefined') {
    throw new TypeError('canonicalize: undefined is not allowed');
  }
  if (type === 'bigint') {
    throw new TypeError('canonicalize: BigInt is not allowed');
  }
  if (type === 'symbol' || type === 'function') {
    throw new TypeError(`canonicalize: ${type} is not allowed`);
  }

  // Arrays — preserve order
  if (Array.isArray(val)) {
    const items = val.map(item => serialize(item));
    return '[' + items.join(',') + ']';
  }

  // Date objects — reject
  if (val instanceof Date) {
    throw new TypeError('canonicalize: Date objects are not allowed (use ISO string)');
  }

  // Plain objects — sort keys lexicographically
  if (type === 'object') {
    const keys = Object.keys(val).sort();
    const pairs = [];
    for (const key of keys) {
      const v = val[key];
      // Skip undefined values (matches JSON.stringify behavior)
      if (v === undefined) continue;
      pairs.push(JSON.stringify(key) + ':' + serialize(v));
    }
    return '{' + pairs.join(',') + '}';
  }

  throw new TypeError(`canonicalize: unsupported type ${type}`);
}
