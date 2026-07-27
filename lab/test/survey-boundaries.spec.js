// lab/test/survey-boundaries.spec.js
//
// Cycle-006 S01 LU-1 (PRD C6-FR-N1/N2, C6-FR-A9/E4, NFR-C6-LEDGER; SDD DR-4.7; Sprint
// Plan T1.4). STRUCTURAL lint over `lab/survey/**` — the fourth lab lane's fences,
// established from the namespace's FIRST executable file so the survey tooling cannot
// grow acquisition capability later.
//
// `lab/survey/` is deliberately NOT an apparatus namespace (`APPARATUS_NAMESPACES` stays
// {lab/acquisition, lab/driver, lab/resolution}) — it must be complete and freeze-pinned
// BEFORE Gate A exists, so its integrity authority is the successor freeze, not the
// acquisition manifest (DR-1 rule (c)). That makes these lints the only mechanical thing
// standing between the survey lane and a provider request, so they are fail-closed:
// discovery refuses on an empty namespace, and every rule carries a planted-violation
// self-check proving it is not vacuous.
//
// The survey is a DOCUMENTATION-READING act performed by the operator/Loa in session
// (DR-4.1); the tooling validates, derives, and emits — it never fetches.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SURVEY_DIR = join(REPO_ROOT, 'lab/survey');

function jsFiles(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...jsFiles(p));
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const surveyModules = () => jsFiles(SURVEY_DIR).map(abs => ({
  rel: abs.slice(REPO_ROOT.length).replace(/\\/g, '/'),
  src: readFileSync(abs, 'utf8'),
}));

/** Executable lines only — comments may legitimately NAME a forbidden thing. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Resolve a relative import specifier to a repo-relative POSIX path. */
function resolveSpecifier(fileRel, spec) {
  if (!spec.startsWith('.')) return spec;                    // node: builtin or bare package
  const out = fileRel.split('/').slice(0, -1);
  for (const part of spec.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function importSpecifiers(src) {
  const out = [];
  const re = /(?:^|\n)\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// ── The fences ────────────────────────────────────────────────────────────────

// (1) The census no-network FORBIDDEN set, applied verbatim to the new namespace.
const FORBIDDEN_NETWORK = [
  { name: 'network/subprocess module import', re: /\bfrom\s+['"](?:node:)?(?:https?|net|tls|dns|dgram|http2|child_process|inspector)['"]/ },
  { name: 'network/subprocess require', re: /\brequire\(\s*['"](?:node:)?(?:https?|net|tls|dns|dgram|http2|child_process)['"]\s*\)/ },
  { name: 'dynamic network/subprocess import', re: /\bimport\(\s*['"](?:node:)?(?:https?|net|tls|dns|child_process)['"]/ },
  { name: 'fetch() call', re: /\bfetch\s*\(/ },
  { name: 'WebSocket', re: /\bnew\s+WebSocket\b/ },
  { name: 'XMLHttpRequest', re: /\bXMLHttpRequest\b/ },
  { name: 'child_process reference', re: /\bchild_process\b/ },
  { name: 'shell net tool spawn', re: /\b(execSync|execFileSync|spawnSync|spawn|exec)\s*\(\s*['"]?(curl|wget|gh|Invoke-WebRequest|Invoke-RestMethod)\b/ },
];

// (2) Hard fence: the survey lane may never import an apparatus namespace.
const FORBIDDEN_IMPORT_PREFIXES = ['lab/acquisition/', 'lab/driver/', 'lab/resolution/'];

// (3) Import allowlist (DR-4.7 base + the DR-3.2 frozen read-only measurement imports
// the derivation harness is explicitly permitted). Exact files, not directories: adding
// one is a deliberate one-line edit with reviewer visibility.
const ALLOWED_IMPORTS = new Set([
  'lab/census/selection-rule.js',     // the N8 selection-relevance probe (DR-4.5)
  'lab/harness/manifests.js',         // digests + canonical helpers
  'lab/harness/slice-fixtures.js',    // the frozen atomic writers
  'lab/harness/ledgers.js',           // JSONL append for the contamination ledger (DR-4.8)
  'lab/harness/walk-forward.js',      // DR-3.2b max-slice measurement
  'src/classifier/feed-grammar.js',   // DR-3.2a classifier-ceiling measurement
  'src/derive/quantile.js',           // DR-3.2d existence-bound cost measurement
]);

// (4) No direct filesystem mutation: a survey write must go through the frozen atomic
// writers, and the derivation harness makes no write at all.
const FS_WRITE_CALLS = [
  /\bwriteFileSync\s*\(/, /\bappendFileSync\s*\(/, /\bwriteFile\s*\(/, /\bappendFile\s*\(/,
  /\bcreateWriteStream\s*\(/, /\bmkdirSync\s*\(/, /\brmSync\s*\(/, /\brmdirSync\s*\(/,
  /\bunlinkSync\s*\(/, /\brenameSync\s*\(/, /\bcpSync\s*\(/, /\bcopyFileSync\s*\(/, /\btruncateSync\s*\(/,
];

// (5) The only repository path the survey lane may name is its own write root.
const PERMITTED_WRITE_ROOT = 'lab/preregistration/cycle-006/';
const REPO_PATH_LITERAL = /(['"])((?:lab|src|spec|scripts|grimoires|\.beads|\.github)\/[^'"]*)\1/g;

// (6) Zero scientific-ledger writes anywhere in the namespace (I-12, NFR-C6-LEDGER).
const FORBIDDEN_LEDGER_TOKENS = [
  /\bappendTrial\b/, /\bbuildBurnEntry\b/, /\bTRIALS_LEDGER_PATH\b/, /\bBURN_LEDGER_PATH\b/,
  /trials-ledger\.jsonl/, /burn-ledger\.jsonl/,
];

test('DR-4.7: the survey namespace is discovered fail-closed and covers derive-constants.js', () => {
  const mods = surveyModules();
  assert.ok(mods.length >= 1, 'lab/survey/** is non-empty — an empty scan must never pass silently');
  assert.ok(mods.some(m => m.rel === 'lab/survey/derive-constants.js'), 'the first executable file in the lane is covered from its first commit');
});

test('C6-FR-N1: no executable network or subprocess reference anywhere in lab/survey/**', () => {
  for (const { rel, src } of surveyModules()) {
    for (const { name, re } of FORBIDDEN_NETWORK) {
      assert.doesNotMatch(src, re, `${rel} must not contain ${name}`);
    }
  }
});

test('DR-4.7: zero imports from lab/acquisition, lab/driver, or lab/resolution', () => {
  for (const { rel, src } of surveyModules()) {
    for (const spec of importSpecifiers(stripComments(src))) {
      const resolved = resolveSpecifier(rel, spec);
      for (const prefix of FORBIDDEN_IMPORT_PREFIXES) {
        assert.ok(!resolved.startsWith(prefix), `${rel} imports the apparatus namespace ${prefix} via "${spec}"`);
      }
    }
  }
});

test('DR-4.7: every import is on the allowlist (stdlib or a permitted frozen module)', () => {
  for (const { rel, src } of surveyModules()) {
    for (const spec of importSpecifiers(stripComments(src))) {
      const resolved = resolveSpecifier(rel, spec);
      if (resolved.startsWith('node:')) continue;                       // stdlib (rule 1 bars the network ones)
      if (resolved.startsWith('lab/survey/')) continue;                 // intra-lane
      assert.ok(ALLOWED_IMPORTS.has(resolved), `${rel} imports "${spec}" → ${resolved}, which is not on the survey allowlist`);
    }
  }
});

test('DR-4.7: no direct filesystem mutation — writes go through the frozen atomic writers only', () => {
  for (const { rel, src } of surveyModules()) {
    const code = stripComments(src);
    for (const re of FS_WRITE_CALLS) {
      assert.doesNotMatch(code, re, `${rel} performs a direct filesystem mutation (${re})`);
    }
  }
});

test('DR-3.1: the derivation harness imports no filesystem module at all (writes no repo file by construction)', () => {
  const harness = surveyModules().find(m => m.rel === 'lab/survey/derive-constants.js');
  const specs = importSpecifiers(stripComments(harness.src));
  assert.ok(!specs.some(s => /^(node:)?fs(\/promises)?$/.test(s)), 'derive-constants.js imports no fs module');
  assert.match(harness.src, /process\.stdout\.write/, 'it reports on stdout; the workflow redirects into the job workspace');
});

test('DR-4.7: the only repository path the survey lane may name is its own write root', () => {
  for (const { rel, src } of surveyModules()) {
    const code = stripComments(src);
    for (const [, , literal] of code.matchAll(REPO_PATH_LITERAL)) {
      assert.ok(literal.startsWith(PERMITTED_WRITE_ROOT), `${rel} names repository path "${literal}" outside ${PERMITTED_WRITE_ROOT}`);
    }
  }
});

test('I-12 / NFR-C6-LEDGER: no scientific-ledger token appears anywhere in lab/survey/**', () => {
  for (const { rel, src } of surveyModules()) {
    for (const re of FORBIDDEN_LEDGER_TOKENS) {
      assert.doesNotMatch(src, re, `${rel} names a forbidden scientific-ledger token (${re})`);
    }
  }
});

// ── Planted-violation self-checks (the house lint pattern) ────────────────────

test('DR-4.7 self-check: every fence FIRES on a planted violation and stays quiet on inert text', () => {
  // (1) network
  const plantedNet = "import { request } from 'node:https';\nfetch('http://x');\n";
  assert.ok(FORBIDDEN_NETWORK.filter(({ re }) => re.test(plantedNet)).length >= 2, 'the no-network lint catches a planted import + fetch');
  const inert = "const providers = ['NOAA', 'USGS'];\nconst doc = 'see https://example/fabricated';\n";
  assert.ok(FORBIDDEN_NETWORK.every(({ re }) => !re.test(inert)), 'inert provider names and fabricated URL literals are not flagged');

  // (2)/(3) imports
  const plantedImport = "import { acquirePool } from '../acquisition/acquire.js';\n";
  const resolvedBad = resolveSpecifier('lab/survey/x.js', importSpecifiers(plantedImport)[0]);
  assert.equal(resolvedBad, 'lab/acquisition/acquire.js');
  assert.ok(FORBIDDEN_IMPORT_PREFIXES.some(p => resolvedBad.startsWith(p)), 'the apparatus-import fence catches it');
  assert.equal(ALLOWED_IMPORTS.has(resolvedBad), false, 'and the allowlist rejects it');
  assert.equal(resolveSpecifier('lab/survey/x.js', '../census/selection-rule.js'), 'lab/census/selection-rule.js');
  assert.equal(resolveSpecifier('lab/survey/x.js', '../../src/derive/quantile.js'), 'src/derive/quantile.js');
  assert.equal(ALLOWED_IMPORTS.has('lab/census/eligibility.js'), false, 'G9: the frozen evaluator is reachable only through selection-rule.js');

  // (4) filesystem mutation
  assert.ok(FS_WRITE_CALLS.some(re => re.test("writeFileSync(p, 'x')")), 'the write fence catches a direct write');
  assert.ok(FS_WRITE_CALLS.every(re => !re.test('writeCanonicalJsonAtomic(p, obj)')), 'the frozen atomic writer is not flagged');

  // (5) path literals
  const plantedPath = "const out = 'lab/evidence/cycle-006/gate-p-acceptance.json';";
  const hits = [...stripComments(plantedPath).matchAll(REPO_PATH_LITERAL)].map(m => m[2]);
  assert.deepEqual(hits, ['lab/evidence/cycle-006/gate-p-acceptance.json']);
  assert.equal(hits[0].startsWith(PERMITTED_WRITE_ROOT), false, 'a write outside the permitted root is caught');
  const permitted = [...stripComments("const out = 'lab/preregistration/cycle-006/survey-record.json';").matchAll(REPO_PATH_LITERAL)].map(m => m[2]);
  assert.equal(permitted[0].startsWith(PERMITTED_WRITE_ROOT), true, 'the lane may name its own write root');

  // (6) ledger tokens
  assert.ok(FORBIDDEN_LEDGER_TOKENS.some(re => re.test("appendTrial(TRIALS_LEDGER_PATH, e)")), 'the ledger fence catches a planted trials write');
  assert.ok(FORBIDDEN_LEDGER_TOKENS.every(re => !re.test('appendLedgerLine(contaminationPath, event)')), 'the permitted JSONL appender is not flagged');

  // the comment stripper does not blind the lints to real code
  assert.match(stripComments("// fetch('x')\nfetch('y');"), /fetch\('y'\)/);
  assert.doesNotMatch(stripComments("// fetch('x')\nconst a = 1;"), /fetch\('x'\)/);
});
