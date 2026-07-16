// lab/test/acquisition-boundaries.spec.js
//
// Cycle-005 S01 (PRD FR-B3, FR-C2, FR-D5, FR-E4; SDD DR-3 G9; Sprint Plan T1.1/T1.8).
// The G9 import-fence + forbidden-token STRUCTURAL lint for the two new namespaces.
// Mirrors the census-no-network.spec.js house pattern (executable-reference regexes +
// planted-violation self-checks so the lint is provably non-vacuous).
//
//   - networking APIs appear ONLY in lab/acquisition/contact.js;
//   - child_process appears ONLY in lab/resolution/census-exec.js;
//   - lab/acquisition/** never imports lab/census/* or lab/resolution/*;
//   - lab/resolution/** never imports lab/acquisition/*;
//   - the ledger-write tokens {appendTrial, buildBurnEntry, trials-ledger, burn-ledger}
//     are forbidden across BOTH namespaces (nothing writes a scientific ledger);
//   - non-GET HTTP methods are forbidden (G5);
//   - direct fs-WRITE APIs are absent from lab/acquisition/** (G3 zero-raw-persistence:
//     the only writers are the imported canonical/append helpers).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ACQ_DIR = fileURLToPath(new URL('../acquisition/', import.meta.url));
const RES_DIR = fileURLToPath(new URL('../resolution/', import.meta.url));

function jsFiles(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...jsFiles(p));
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const base = (f) => f.replace(/\\/g, '/').split('/').pop();
const rel2 = (f) => f.replace(/\\/g, '/').split('/').slice(-2).join('/');

// Executable network / subprocess reference patterns (the census lint's FORBIDDEN set).
const NETWORK = [
  { name: 'network module import', re: /\bfrom\s+['"](?:node:)?(?:https?|net|tls|dns|dgram|http2|inspector)['"]/ },
  { name: 'network require', re: /\brequire\(\s*['"](?:node:)?(?:https?|net|tls|dns|dgram|http2)['"]\s*\)/ },
  { name: 'dynamic network import', re: /\bimport\(\s*['"](?:node:)?(?:https?|net|tls|dns)['"]/ },
  { name: 'fetch() call', re: /\bfetch\s*\(/ },
  { name: 'WebSocket', re: /\bnew\s+WebSocket\b/ },
  { name: 'XMLHttpRequest', re: /\bXMLHttpRequest\b/ },
];
const SUBPROCESS = [
  { name: 'child_process import', re: /\bfrom\s+['"](?:node:)?child_process['"]/ },
  { name: 'child_process require', re: /\brequire\(\s*['"](?:node:)?child_process['"]\s*\)/ },
  { name: 'child_process reference', re: /\bchild_process\b/ },
  { name: 'spawn/exec net tool', re: /\b(execSync|execFileSync|spawnSync|spawn|exec)\s*\(\s*['"]?(curl|wget|gh|Invoke-WebRequest|Invoke-RestMethod)\b/ },
];
// Ledger-write tokens forbidden in BOTH namespaces (mechanizes FR-D5/FR-E4).
const LEDGER_TOKENS = [
  { name: 'appendTrial', re: /\bappendTrial\b/ },
  { name: 'buildBurnEntry', re: /\bbuildBurnEntry\b/ },
  { name: 'trials-ledger literal', re: /trials-ledger/ },
  { name: 'burn-ledger literal', re: /burn-ledger/ },
];
// Direct fs-WRITE API tokens (G3): forbidden in lab/acquisition/** (writers are imported helpers).
const FS_WRITE = [
  { name: 'writeFileSync', re: /\bwriteFileSync\b/ },
  { name: 'appendFileSync', re: /\bappendFileSync\b/ },
  { name: 'writeSync', re: /\bwriteSync\b/ },
  { name: 'openSync', re: /\bopenSync\b/ },
  { name: 'renameSync', re: /\brenameSync\b/ },
  { name: 'rmSync|unlinkSync', re: /\b(rmSync|unlinkSync|rmdirSync)\b/ },
];
// Non-GET HTTP methods (G5).
const NON_GET = { name: 'non-GET method', re: /\bmethod\s*:\s*['"](?:POST|PUT|DELETE|PATCH|HEAD|OPTIONS)['"]/i };

test('G9: networking APIs appear ONLY in lab/acquisition/contact.js', () => {
  for (const file of [...jsFiles(ACQ_DIR), ...jsFiles(RES_DIR)]) {
    if (base(file) === 'contact.js') continue; // the sole networking module
    const src = readFileSync(file, 'utf8');
    for (const { name, re } of NETWORK) assert.doesNotMatch(src, re, `${rel2(file)} must not contain ${name}`);
  }
});

test('G9: child_process appears ONLY in lab/resolution/census-exec.js', () => {
  for (const file of [...jsFiles(ACQ_DIR), ...jsFiles(RES_DIR)]) {
    if (base(file) === 'census-exec.js') continue; // the sole subprocess module
    const src = readFileSync(file, 'utf8');
    for (const { name, re } of SUBPROCESS) assert.doesNotMatch(src, re, `${rel2(file)} must not contain ${name}`);
  }
});

test('G9: import fences — acquisition never imports census/resolution; resolution never imports acquisition', () => {
  const acqImportForbidden = /\bfrom\s+['"][^'"]*\/(census|resolution)\/[^'"]*['"]/;
  for (const file of jsFiles(ACQ_DIR)) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, acqImportForbidden, `${rel2(file)} (acquisition) must not import from lab/census/* or lab/resolution/*`);
  }
  const resImportForbidden = /\bfrom\s+['"][^'"]*\/acquisition\/[^'"]*['"]/;
  for (const file of jsFiles(RES_DIR)) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, resImportForbidden, `${rel2(file)} (resolution) must not import from lab/acquisition/*`);
  }
});

test('G9: ledger-write tokens forbidden across BOTH namespaces (FR-D5/FR-E4)', () => {
  for (const file of [...jsFiles(ACQ_DIR), ...jsFiles(RES_DIR)]) {
    const src = readFileSync(file, 'utf8');
    for (const { name, re } of LEDGER_TOKENS) assert.doesNotMatch(src, re, `${rel2(file)} must not contain ledger-write token ${name}`);
  }
});

test('G5: non-GET HTTP methods forbidden across both namespaces', () => {
  for (const file of [...jsFiles(ACQ_DIR), ...jsFiles(RES_DIR)]) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, NON_GET.re, `${rel2(file)} must not contain a ${NON_GET.name}`);
  }
});

test('G3: direct fs-WRITE APIs absent from lab/acquisition/** (writers are imported helpers)', () => {
  for (const file of jsFiles(ACQ_DIR)) {
    const src = readFileSync(file, 'utf8');
    for (const { name, re } of FS_WRITE) assert.doesNotMatch(src, re, `${rel2(file)} (acquisition) must not call fs-write API ${name} directly (G3)`);
  }
});

test('discovery: both namespaces carry their expected apparatus modules (fail-closed)', () => {
  const acq = jsFiles(ACQ_DIR).map(base).sort();
  for (const m of ['routes.js', 'contact.js', 'guards.js', 'extract.js', 'assemble.js', 'classify.js', 'acquire.js']) {
    assert.ok(acq.includes(m), `lab/acquisition/${m} present (found: ${acq.join(', ')})`);
  }
  const res = jsFiles(RES_DIR).map(base).sort();
  for (const m of ['identity.js', 'verify-pins.js', 'census-exec.js', 'select.js', 'invariance.js', 'pstar.js', 'evidence.js', 'seal.js']) {
    assert.ok(res.includes(m), `lab/resolution/${m} present (found: ${res.join(', ')})`);
  }
});

test('self-check: the lint catches planted violations (non-vacuous)', () => {
  const plantedNet = "const r = fetch('https://x');\nimport { request } from 'node:https';\n";
  assert.ok(NETWORK.some(({ re }) => re.test(plantedNet)), 'planted fetch + network import detected');
  const plantedSub = "import { spawnSync } from 'node:child_process';\n";
  assert.ok(SUBPROCESS.some(({ re }) => re.test(plantedSub)), 'planted child_process import detected');
  const plantedImport = "import { x } from '../census/eligibility.js';";
  assert.match(plantedImport, /\bfrom\s+['"][^'"]*\/(census|resolution)\/[^'"]*['"]/, 'planted cross-namespace import detected');
  const plantedLedger = "appendTrial(path, e); // burn-ledger\n";
  assert.ok(LEDGER_TOKENS.some(({ re }) => re.test(plantedLedger)), 'planted ledger token detected');
  const plantedPost = "await fetch(u, { method: 'POST' });";
  assert.match(plantedPost, NON_GET.re, 'planted non-GET method detected');
  const plantedFsWrite = "writeFileSync(p, raw);";
  assert.ok(FS_WRITE.some(({ re }) => re.test(plantedFsWrite)), 'planted fs-write detected');
  // And an inert provider name / fabricated URL literal does NOT trip the network lint.
  const inert = "const providers = ['NOAA', 'USGS'];\nconst doc = 'see https://example/fabricated';\n";
  assert.ok(NETWORK.every(({ re }) => !re.test(inert)), 'inert names + fabricated URL literals not flagged');
});
