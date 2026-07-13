// test/unit/derive-lint.spec.js
//
// Transcendental lint (SDD §6 L7, §8.1): NO prohibited deterministic math may
// touch any hashed field in src/derive/**. Comments and string/template
// literals are stripped first so identifiers like `log2_span_days_floor` and
// prose like `DAY_MS·2^k` never false-positive — but an ACTUAL prohibited
// invocation is never permitted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DERIVE_DIR = fileURLToPath(new URL('../../src/derive', import.meta.url));
const files = readdirSync(DERIVE_DIR).filter(f => f.endsWith('.js')).sort();

// Strip // line comments, /* block comments */, and '…'/"…"/`…` string literals.
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++; out += ' '; continue;
    }
    out += c; i++;
  }
  return out;
}

const PROHIBITED_MATH = [
  'log', 'log2', 'log10', 'exp', 'expm1', 'log1p', 'pow',
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'sinh', 'cosh', 'tanh', 'cbrt',
];

test('src/derive/** contains at least the seven kernel modules', () => {
  for (const m of ['reason-codes.js', 'quantile.js', 'effective-information.js', 'window.js', 'kernel.js', 'fallback-rule.js', 'experimental-path.js']) {
    assert.ok(files.includes(m), `missing module ${m}`);
  }
});

test('no prohibited transcendental Math.* invocation in src/derive/**', () => {
  for (const f of files) {
    const code = stripCommentsAndStrings(readFileSync(join(DERIVE_DIR, f), 'utf8'));
    for (const name of PROHIBITED_MATH) {
      const re = new RegExp('\\bMath\\.' + name + '\\s*\\(');
      assert.ok(!re.test(code), `${f}: prohibited Math.${name}( invocation`);
    }
  }
});

test('no exponentiation operator (**) in src/derive/**', () => {
  for (const f of files) {
    const code = stripCommentsAndStrings(readFileSync(join(DERIVE_DIR, f), 'utf8'));
    assert.ok(!/\*\*/.test(code), `${f}: prohibited exponentiation operator **`);
  }
});
