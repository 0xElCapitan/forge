// lab/test/census-no-network.spec.js
//
// Cycle-004 S03 (FR-11e; AC-7; SDD Lane L5:537/606; Sprint Plan T3.7). STRUCTURAL lint:
// no module under lab/census/ contains an executable reference to any networking API or
// process-spawning API. This is the mechanical backstop for the zero-contact guarantee —
// metadata enters only via local JSON files. The lint targets executable IMPORT/CALL
// patterns, so inert provider names, prose, and fabricated URL literals do NOT trip it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CENSUS_DIR = fileURLToPath(new URL('../census/', import.meta.url));

function jsFiles(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...jsFiles(p));
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// Executable network / subprocess reference patterns (import specifiers + call sites).
const FORBIDDEN = [
  { name: 'network/subprocess module import', re: /\bfrom\s+['"](?:node:)?(?:https?|net|tls|dns|dgram|http2|child_process|inspector)['"]/ },
  { name: 'network/subprocess require', re: /\brequire\(\s*['"](?:node:)?(?:https?|net|tls|dns|dgram|http2|child_process)['"]\s*\)/ },
  { name: 'dynamic network/subprocess import', re: /\bimport\(\s*['"](?:node:)?(?:https?|net|tls|dns|child_process)['"]/ },
  { name: 'fetch() call', re: /\bfetch\s*\(/ },
  { name: 'WebSocket', re: /\bnew\s+WebSocket\b/ },
  { name: 'XMLHttpRequest', re: /\bXMLHttpRequest\b/ },
  { name: 'child_process reference', re: /\bchild_process\b/ },
  { name: 'shell net tool spawn', re: /\b(execSync|execFileSync|spawnSync|spawn|exec)\s*\(\s*['"]?(curl|wget|gh|Invoke-WebRequest|Invoke-RestMethod)\b/ },
];

test('AC-7: lab/census/** contains at least the four apparatus modules (fail-closed discovery)', () => {
  const files = jsFiles(CENSUS_DIR);
  const names = files.map(f => f.replace(/\\/g, '/').split('/').pop()).sort();
  assert.ok(names.includes('burned-list.js') && names.includes('eligibility.js') && names.includes('selection-rule.js') && names.includes('census.js'), `census modules discovered: ${names.join(', ')}`);
  assert.ok(files.length >= 4, 'at least four census .js modules scanned');
});

test('AC-7: no executable network or subprocess reference anywhere in lab/census/**', () => {
  for (const file of jsFiles(CENSUS_DIR)) {
    const src = readFileSync(file, 'utf8');
    for (const { name, re } of FORBIDDEN) {
      assert.doesNotMatch(src, re, `${file.replace(/\\/g, '/').split('/').slice(-2).join('/')} must not contain ${name}`);
    }
  }
});

test('AC-7: the lint would catch a planted network import (self-check)', () => {
  // Prove the regex set is not vacuous: a synthetic offending line matches.
  const planted = "import { request } from 'node:https';\nfetch('http://x');\n";
  const hits = FORBIDDEN.filter(({ re }) => re.test(planted));
  assert.ok(hits.length >= 2, 'planted network import + fetch are detected by the lint');
  // And an inert provider name / fabricated URL literal does NOT trip the lint.
  const inert = "const providers = ['NOAA', 'USGS'];\nconst doc = 'see https://example/fabricated';\n";
  assert.ok(FORBIDDEN.every(({ re }) => !re.test(inert)), 'inert names + fabricated URL literals are not flagged');
});
