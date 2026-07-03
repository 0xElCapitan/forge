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
  // static `import ... from '...'` / `export ... from '...'`.
  // CF-9 (cycle-003 S03 boundary hardening): the span between the import/export
  // keyword and `from` uses `[^;]*?` (a statement-bounded class that DOES cross
  // newlines) instead of the prior line-anchored `[^\n]*?`, so a multi-line braced
  // import —
  //     import {
  //       foo,
  //     } from 'some-external';
  // — is detected, not silently evaded. The leading `(?:^|;|\n)` anchors the match
  // at a statement start and `[^;]` cannot leap a `;`, so the dotall span stays
  // bounded to a single statement and does not over-match prose or a from-less
  // side-effect import followed by a later `from` (SDD §5 Lane 5 strategy (b)).
  const reStatic = /(?:^|;|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm;
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

// ── CF-9 (cycle-003 S03): multi-line import detection regression ──────────────
//
// The pre-CF-9 line-anchored regex matched only single-line `import ... from`.
// A forbidden external dependency hidden behind a multi-line braced import would
// evade the allowlist walk. These regressions pin the strengthened detector:
// multi-line braced imports ARE surfaced, single-line coverage is intact, prose is
// not over-matched, and a from-less side-effect import does not smear across
// statements. This hardens the TEST that guards the boundary — it adds no
// producer / runtime / CLI surface (precondition only; PRD §5, NFR-BOUNDARY).

describe('bundle boundaries — CF-9 multi-line import detection (cycle-003 S03)', () => {
  it('detects a single-line import specifier (baseline, unchanged)', () => {
    assert.deepEqual(importSpecifiers(`import { foo } from './sibling.js';`), ['./sibling.js']);
  });

  it('detects a single-line export-from re-export (baseline, unchanged)', () => {
    assert.deepEqual(importSpecifiers(`export { x } from './y.js';`), ['./y.js']);
  });

  it('detects a multi-line braced import — the pre-CF-9 evasion (forbidden external surfaced)', () => {
    const multiline = ['import {', '  createHash,', '  randomBytes,', "} from 'crypto-js';"].join('\n');
    const specs = importSpecifiers(multiline);
    assert.ok(
      specs.includes('crypto-js'),
      `multi-line braced import must be detected; got ${JSON.stringify(specs)}`,
    );
  });

  it('a synthetic multi-line forbidden external import trips the allowlist class (bare specifier)', () => {
    // Mirrors how the allowlist walk classifies a specifier: a bare (non-relative)
    // specifier is a third-party dependency and is rejected. Pre-CF-9 it was never
    // even surfaced because the line-anchored regex skipped the multi-line form.
    const sneaky = ['import {', '  evil,', "} from 'exfiltrate-secrets';"].join('\n');
    const specs = importSpecifiers(sneaky);
    assert.ok(specs.includes('exfiltrate-secrets'), 'multi-line third-party import surfaced');
    assert.ok(!'exfiltrate-secrets'.startsWith('.'), 'bare specifier → allowlist walk pushes a violation');
  });

  it('detects a multi-line import even when a preceding side-effect import has no `from`', () => {
    const content = [
      "import './register-side-effect.js';",
      'import {',
      '  realThing,',
      "} from './sibling.js';",
    ].join('\n');
    // The from-less side-effect import yields no specifier; the multi-line `from`
    // import is collected exactly once, not smeared across the two statements.
    assert.deepEqual(importSpecifiers(content), ['./sibling.js']);
  });

  it('does not over-match prose that merely contains the word "from"', () => {
    const prose = [
      '// This module derives values from the construct manifest.',
      'const note = "imported from upstream";',
    ].join('\n');
    assert.deepEqual(importSpecifiers(prose), []);
  });
});
