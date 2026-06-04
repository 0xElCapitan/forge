/**
 * test/unit/bundle-boundaries.spec.js
 * S03-F forbidden-path / no-runtime-leak conformance (target 9).
 *
 * Statically enforces the producer-only boundary by walking src/ and resolving
 * every import specifier (no brittle shell assumptions):
 *
 *   1. NO file outside src/bundle/ imports the singular src/bundle/ producer
 *      (it is not wired into any live FORGE runtime path).
 *   2. Every cross-module import FROM src/bundle/ resolves to a small allowlist
 *      {receipt/hash.js, receipt/canonicalize.js, trust/oracle-trust.js} (plus
 *      node: builtins and bundle-internal siblings). This transitively proves
 *      src/bundle/ imports NO signer / keyring / revocation / key-policy /
 *      verification code, NOT src/ir (ProposalEnvelope), NOT src/processor/bundles.js
 *      (the unrelated plural EvidenceBundle module), and NO third-party dependency.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const BUNDLE_DIR = join(SRC, 'bundle');

// External modules src/bundle/ is permitted to reach (relative to SRC, forward-slashed).
const EXTERNAL_IMPORT_ALLOWLIST = new Set([
  'receipt/hash.js',
  'receipt/canonicalize.js',
  'trust/oracle-trust.js',
]);

function walkJs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJs(full));
    else if (entry.isFile() && full.endsWith('.js')) out.push(full);
  }
  return out;
}

function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function importSpecifiers(content) {
  const specs = [];
  // static `import ... from '...'` / `export ... from '...'` (line-anchored: ignores prose).
  const reStatic = /^\s*(?:import|export)\b[^\n]*?\bfrom\s*['"]([^'"]+)['"]/gm;
  // dynamic `import('...')`.
  const reDynamic = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = reStatic.exec(content))) specs.push(m[1]);
  while ((m = reDynamic.exec(content))) specs.push(m[1]);
  return specs;
}

const allSrc = walkJs(SRC);
const bundleFiles = allSrc.filter((f) => isInside(f, BUNDLE_DIR));
const nonBundleFiles = allSrc.filter((f) => !isInside(f, BUNDLE_DIR));
const toSrcRel = (p) => relative(SRC, p).split(sep).join('/');

describe('bundle boundaries — walk sanity', () => {
  it('found the bundle producer files and the wider src tree', () => {
    assert.ok(bundleFiles.length >= 12, `expected >=12 src/bundle files, found ${bundleFiles.length}`);
    assert.ok(nonBundleFiles.length > bundleFiles.length, 'walk must cover src/ beyond the bundle dir');
  });
});

describe('bundle boundaries — no runtime path imports src/bundle/ (no inbound leak)', () => {
  it('no file outside src/bundle/ imports the singular producer', () => {
    const offenders = [];
    for (const file of nonBundleFiles) {
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (!spec.startsWith('.')) continue; // bare/builtin: cannot point into src/bundle
        const target = resolve(dirname(file), spec);
        if (isInside(target, BUNDLE_DIR)) {
          offenders.push(`${toSrcRel(file)} -> ${spec}`);
        }
      }
    }
    assert.deepEqual(offenders, [], `src/bundle/ must have zero runtime importers; found: ${offenders.join(', ')}`);
  });
});

describe('bundle boundaries — src/bundle/ external imports are allowlisted (producer-only)', () => {
  it('every escaping import is a builtin, a sibling, or in the allowlist', () => {
    const violations = [];
    for (const file of bundleFiles) {
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (spec.startsWith('node:')) continue; // builtin
        if (!spec.startsWith('.')) {
          violations.push(`${toSrcRel(file)} -> bare import '${spec}' (no third-party dependency allowed)`);
          continue;
        }
        const target = resolve(dirname(file), spec);
        if (isInside(target, BUNDLE_DIR)) continue; // bundle-internal sibling
        const rel = toSrcRel(target);
        if (!EXTERNAL_IMPORT_ALLOWLIST.has(rel)) {
          violations.push(`${toSrcRel(file)} -> '${spec}' (resolves to ${rel}, not in allowlist)`);
        }
      }
    }
    assert.deepEqual(violations, [], `src/bundle/ external imports must stay within the allowlist; found: ${violations.join(', ')}`);
  });

  it('the allowlist explicitly excludes signer / keyring / verification / ir / processor', () => {
    for (const forbidden of [
      'receipt/sign.js',
      'receipt/keyring.js',
      'ir/emit.js',
      'processor/bundles.js',
    ]) {
      assert.ok(!EXTERNAL_IMPORT_ALLOWLIST.has(forbidden), `${forbidden} must never be allowlisted`);
    }
  });
});
