// test/unit/derive-boundaries.spec.js
//
// NFR-BOUNDARY (SDD §8.5): src/derive/** imports only node: builtins,
// src/receipt/{hash,canonicalize}.js, and other src/derive modules — no
// dependency, no classifier/selector/bundle/IR/runtime/CLI coupling; nothing
// under src/** imports lab/**; and no kernel/fallback output ever carries a
// forbidden certification/scoring key (live behavioral guard, NFR-CEIL).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve, relative, isAbsolute, sep } from 'node:path';

import { deriveThresholdParameter } from '../../src/derive/kernel.js';
import { buildFallbackProposal, STATISTICAL_THRESHOLD_RULE } from '../../src/derive/fallback-rule.js';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const DERIVE = join(SRC, 'derive');
const RECEIPT_ALLOW = new Set([join(SRC, 'receipt', 'hash.js'), join(SRC, 'receipt', 'canonicalize.js')]);

function walkJs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkJs(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

function importSpecifiers(content) {
  const specs = [];
  const reStatic = /(?:^|;|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm;
  const reDynamic = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = reStatic.exec(content))) specs.push(m[1]);
  while ((m = reDynamic.exec(content))) specs.push(m[1]);
  return specs;
}

const isInside = (child, parent) => {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

test('src/derive/** import surface ⊆ {node: builtins, receipt/{hash,canonicalize}, intra-derive}', () => {
  for (const file of walkJs(DERIVE)) {
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('node:')) continue;                       // builtin
      if (!spec.startsWith('.') && !spec.startsWith('/')) {
        assert.fail(`${relative(SRC, file)}: bare/dependency import "${spec}" is forbidden`);
      }
      const resolved = resolve(dirname(file), spec);
      const ok = isInside(resolved, DERIVE) || RECEIPT_ALLOW.has(resolved);
      assert.ok(ok, `${relative(SRC, file)}: import "${spec}" resolves outside the allowed surface (${relative(SRC, resolved)})`);
    }
  }
});

test('nothing under src/** imports from lab/**', () => {
  for (const file of walkJs(SRC)) {
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('node:') || (!spec.startsWith('.') && !spec.startsWith('/'))) continue;
      const resolved = resolve(dirname(file), spec);
      const relFromSrcParent = relative(join(SRC, '..'), resolved).split(sep).join('/');
      assert.ok(!relFromSrcParent.startsWith('lab/'), `${relative(SRC, file)}: imports into lab/ (${relFromSrcParent})`);
    }
  }
});

test('src/derive/** has no classifier / selector / bundle / IR / runtime / CLI coupling', () => {
  const forbiddenDirs = ['classifier', 'selector', 'bundle', 'ir', 'runtime', 'theatres', 'adapter', 'baseline', 'composer', 'processor', 'trust', 'rlmf', 'filter', 'replay'];
  for (const file of walkJs(DERIVE)) {
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('node:') || (!spec.startsWith('.') && !spec.startsWith('/'))) continue;
      const resolved = resolve(dirname(file), spec);
      const relFromSrc = relative(SRC, resolved).split(sep).join('/');
      for (const d of forbiddenDirs) {
        assert.ok(!relFromSrc.startsWith(`${d}/`), `${relative(SRC, file)}: forbidden coupling to src/${d}/`);
      }
    }
  }
});

// ── live forbidden-key guard over kernel + fallback outputs ──────────────────
const FORBIDDEN_KEYS = new Set(['scoring', 'certified', 'admitted', 'calibrated', 'calibration', 'certificate']);
function collectKeys(node, acc = []) {
  if (Array.isArray(node)) for (const it of node) collectKeys(it, acc);
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) { acc.push(k); collectKeys(v, acc); }
  return acc;
}

test('no kernel / fallback output emits a forbidden certification/scoring key', () => {
  const ev = (t, v) => ({ timestamp: t, value: v, metadata: { ts_source: 'parsed' } });
  const derive = deriveThresholdParameter(
    Array.from({ length: 7 }, (_, i) => ev(30_000_000 + i * 10_000_000, 10 + i * 10)),
    { p: '0.5', now: 90_000_000, window: { min_days: 1, n_min: 6 } });
  const reject = deriveThresholdParameter([ev(1000, 1), ev(2000, 2)], { p: '0.5', now: 90_000_000, window: { min_days: 1, n_min: 6 } });
  const degenerate = deriveThresholdParameter(
    Array.from({ length: 6 }, (_, i) => ev(30_000_000 + i * 10_000_000, 5)),
    { p: '0.5', now: 90_000_000, window: { min_days: 1, n_min: 6 } });
  const proposal = buildFallbackProposal(derive.record);

  const hits = collectKeys([derive, reject, degenerate, proposal, STATISTICAL_THRESHOLD_RULE]).filter(k => FORBIDDEN_KEYS.has(k));
  assert.deepEqual(hits, [], `forbidden key(s) in derive output: ${hits.join(', ')}`);
});
