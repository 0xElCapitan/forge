// lab/test/acquisition-boundaries.spec.js
//
// Cycle-005 S01 (PRD FR-B3, FR-C2, FR-D5, FR-E4; SDD DR-3 G9; Sprint Plan T1.1/T1.8);
// S02 composition-root extension (review 27 §5, operator Design A).
// The G9 import-fence + forbidden-token STRUCTURAL lint for the three apparatus
// namespaces. Mirrors the census-no-network.spec.js house pattern (executable-reference
// regexes + planted-violation self-checks so the lint is provably non-vacuous).
//
//   - networking APIs appear ONLY in lab/acquisition/contact.js;
//   - child_process appears ONLY in lab/resolution/census-exec.js;
//   - lab/acquisition/** never imports lab/census/* or lab/resolution/*;
//   - lab/resolution/** never imports lab/acquisition/*;
//   - lab/driver/** is the COMPOSITION ROOT: it may import the narrow public execution
//     interfaces of both lanes and nothing else, and NEITHER lane may import it;
//   - the ledger-write tokens {appendTrial, buildBurnEntry, trials-ledger, burn-ledger}
//     are forbidden across ALL THREE namespaces (nothing writes a scientific ledger);
//   - non-GET HTTP methods are forbidden (G5);
//   - direct fs-WRITE APIs are absent from lab/acquisition/** and lab/driver/**
//     (G3 zero-raw-persistence: the only writers are the imported canonical/append
//     helpers, and the composition root writes nothing at all).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ACQ_DIR = fileURLToPath(new URL('../acquisition/', import.meta.url));
const RES_DIR = fileURLToPath(new URL('../resolution/', import.meta.url));
const DRV_DIR = fileURLToPath(new URL('../driver/', import.meta.url));

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

/** Every apparatus source file: the two fenced lanes plus the composition root. */
const apparatusFiles = () => [...jsFiles(ACQ_DIR), ...jsFiles(RES_DIR), ...jsFiles(DRV_DIR)];

/** Every `from '<specifier>'` in a source file. */
function importSpecifiers(src) {
  return [...src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
}

/**
 * The ONLY non-builtin modules the composition root may name. Enumerated as exact
 * specifiers rather than as a namespace glob so the dependency surface stays the two
 * narrow public execution interfaces the driver actually composes — a namespace-wide
 * exemption would let a future edit reach `contact.js`, `routes.js` or `seal.js`
 * directly and quietly become the contact controller the driver must never be.
 */
const DRIVER_ALLOWED_IMPORTS = Object.freeze([
  '../acquisition/acquire.js',
  '../resolution/pin-invariance.js',
]);

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
  for (const file of apparatusFiles()) {
    if (base(file) === 'contact.js') continue; // the sole networking module
    const src = readFileSync(file, 'utf8');
    for (const { name, re } of NETWORK) assert.doesNotMatch(src, re, `${rel2(file)} must not contain ${name}`);
  }
});

test('G9: child_process appears ONLY in lab/resolution/census-exec.js', () => {
  for (const file of apparatusFiles()) {
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

// ─── The composition root (review 27 §5, operator Design A) ────────────────────
//
// The fence above is BIDIRECTIONAL, so neither lane can host the code that hands Lane
// B's pin-invariance preparer to Lane A's entry point. `lab/driver/**` is the third
// apparatus namespace that may name both — and the dependency permission runs ONE WAY:
// the driver may depend on the lanes, the lanes may never depend on the driver. That
// asymmetry is what keeps the fence's meaning intact: an acquisition module still
// cannot reach a resolution module, not even by routing through the driver.

test('G9: the driver is the composition root — its dependency surface is exactly the two lane entry points', () => {
  const files = jsFiles(DRV_DIR);
  assert.ok(files.length > 0, 'lab/driver/** carries at least one module');
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const spec of importSpecifiers(src)) {
      if (spec.startsWith('node:')) continue; // node builtins are always permitted
      assert.ok(
        DRIVER_ALLOWED_IMPORTS.includes(spec),
        `${rel2(file)} (driver) may only import [${DRIVER_ALLOWED_IMPORTS.join(', ')}] or node builtins — found "${spec}"`,
      );
    }
  }
});

test('G9: NEITHER lane imports the driver — the composition dependency is one-way', () => {
  const driverImportForbidden = /\bfrom\s+['"][^'"]*\/driver\/[^'"]*['"]/;
  for (const file of [...jsFiles(ACQ_DIR), ...jsFiles(RES_DIR)]) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, driverImportForbidden, `${rel2(file)} must not import from lab/driver/* (the composition root depends on the lanes, never the reverse)`);
  }
});

test('G9: ledger-write tokens forbidden across ALL THREE namespaces (FR-D5/FR-E4)', () => {
  for (const file of apparatusFiles()) {
    const src = readFileSync(file, 'utf8');
    for (const { name, re } of LEDGER_TOKENS) assert.doesNotMatch(src, re, `${rel2(file)} must not contain ledger-write token ${name}`);
  }
});

test('G5: non-GET HTTP methods forbidden across all three namespaces', () => {
  for (const file of apparatusFiles()) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, NON_GET.re, `${rel2(file)} must not contain a ${NON_GET.name}`);
  }
});

test('G3: direct fs-WRITE APIs absent from lab/acquisition/** and lab/driver/** (writers are imported helpers)', () => {
  for (const file of [...jsFiles(ACQ_DIR), ...jsFiles(DRV_DIR)]) {
    const src = readFileSync(file, 'utf8');
    for (const { name, re } of FS_WRITE) assert.doesNotMatch(src, re, `${rel2(file)} must not call fs-write API ${name} directly (G3)`);
  }
});

test('discovery: all three namespaces carry their expected apparatus modules (fail-closed)', () => {
  const acq = jsFiles(ACQ_DIR).map(base).sort();
  for (const m of ['routes.js', 'contact.js', 'guards.js', 'extract.js', 'assemble.js', 'classify.js', 'acquire.js']) {
    assert.ok(acq.includes(m), `lab/acquisition/${m} present (found: ${acq.join(', ')})`);
  }
  const res = jsFiles(RES_DIR).map(base).sort();
  for (const m of ['identity.js', 'verify-pins.js', 'pin-invariance.js', 'census-exec.js', 'select.js', 'invariance.js', 'pstar.js', 'evidence.js', 'seal.js']) {
    assert.ok(res.includes(m), `lab/resolution/${m} present (found: ${res.join(', ')})`);
  }
  const drv = jsFiles(DRV_DIR).map(base).sort();
  assert.deepStrictEqual(drv, ['acquire-run.js'], 'lab/driver carries exactly the one composition root');
});

test('self-check: the lint catches planted violations (non-vacuous)', () => {
  const plantedNet = "const r = fetch('https://x');\nimport { request } from 'node:https';\n";
  assert.ok(NETWORK.some(({ re }) => re.test(plantedNet)), 'planted fetch + network import detected');
  const plantedSub = "import { spawnSync } from 'node:child_process';\n";
  assert.ok(SUBPROCESS.some(({ re }) => re.test(plantedSub)), 'planted child_process import detected');
  const plantedImport = "import { x } from '../census/eligibility.js';";
  assert.match(plantedImport, /\bfrom\s+['"][^'"]*\/(census|resolution)\/[^'"]*['"]/, 'planted cross-namespace import detected');
  const plantedDriverImport = "import { runAcquisition } from '../driver/acquire-run.js';";
  assert.match(plantedDriverImport, /\bfrom\s+['"][^'"]*\/driver\/[^'"]*['"]/, 'planted lane→driver import detected');
  // A driver reaching past the two lane entry points is caught by the allowlist.
  const plantedWideDriverImport = importSpecifiers("import { contactRoute } from '../acquisition/contact.js';");
  assert.deepStrictEqual(plantedWideDriverImport, ['../acquisition/contact.js'], 'specifiers extracted');
  assert.ok(!DRIVER_ALLOWED_IMPORTS.includes(plantedWideDriverImport[0]), 'planted wide driver import rejected by the allowlist');
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
