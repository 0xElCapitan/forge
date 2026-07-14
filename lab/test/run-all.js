/**
 * lab/test/run-all.js
 *
 * Cycle-004 S02 (R-2 / PR-1; SDD Lane L7; Sprint Plan §7.2 T2.7). The
 * FAIL-CLOSED deterministic lab-test runner and single CI entry point
 * (`node --test lab/test/run-all.js`). It:
 *
 *   1. recursively discovers every `lab/test/**​/*.spec.js`;
 *   2. normalizes to repo-relative POSIX paths;
 *   3. sorts LEXICOGRAPHICALLY (the sole ordering authority — never trusts
 *      `readdir` order; deterministic on Windows + Ubuntu);
 *   4. compares the discovered set against the tracked required-file manifest
 *      `lab/test/inventory.json`;
 *   5. FAILS BEFORE importing any test when a discovered spec is unregistered, a
 *      registered spec is missing on disk, or a duplicate / path-colliding entry
 *      exists;
 *   6. imports every validated spec in lexicographic order.
 *
 * This is what lets S03 add census/freeze specs by editing this file /
 * `inventory.json` WITHOUT touching `.github/workflows/`.
 *
 * @module lab/test/run-all
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname } from 'node:path';

const HERE = fileURLToPath(import.meta.url);          // <repo>/lab/test/run-all.js
export const TEST_DIR = dirname(HERE);                // <repo>/lab/test
export const REPO_ROOT = dirname(dirname(TEST_DIR));  // <repo>
export const INVENTORY_PATH = `${TEST_DIR}/inventory.json`;

/** Convert an OS-native absolute path to a repo-relative POSIX path. */
export function toRepoRelativePosix(absPath, repoRoot = REPO_ROOT) {
  const rel = absPath.slice(repoRoot.length).replace(/\\/g, '/').replace(/^\//, '');
  return rel;
}

/**
 * Manual recursive walk collecting every `*.spec.js` under `dir` (no
 * version-divergent `readdirSync({recursive})` behavior). Returns OS-native
 * absolute paths in whatever order the filesystem yields — the caller sorts.
 */
export function walkSpecFiles(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${ent.name}`;
    if (ent.isDirectory()) out.push(...walkSpecFiles(full));
    else if (ent.isFile() && ent.name.endsWith('.spec.js')) out.push(full);
  }
  return out;
}

/** Normalize + lexicographically sort repo-relative POSIX spec paths. */
export function normalizeAndSort(paths) {
  return paths.slice()
    .map(p => p.replace(/\\/g, '/'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Discover lab spec files as sorted repo-relative POSIX paths. */
export function discoverSpecs(testDir = TEST_DIR, repoRoot = REPO_ROOT) {
  const abs = walkSpecFiles(testDir);
  return normalizeAndSort(abs.map(a => toRepoRelativePosix(a, repoRoot)));
}

/** Load the required-file manifest (array of repo-relative POSIX paths). */
export function loadInventory(inventoryPath = INVENTORY_PATH) {
  const doc = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  const list = Array.isArray(doc) ? doc : doc.specs;
  if (!Array.isArray(list)) throw new Error('inventory.json must be an array (or { specs: [...] })');
  return list;
}

/** Assert an array has no duplicate / colliding entries; return a Set. */
function assertNoDuplicates(paths, label) {
  const seen = new Set();
  for (const p of paths) {
    const norm = p.replace(/\\/g, '/');
    if (seen.has(norm)) throw new Error(`run-all: duplicate/colliding ${label} entry "${norm}"`);
    seen.add(norm);
  }
  return seen;
}

/**
 * FAIL-CLOSED validation. Throws (before any import) when the discovered set and
 * the registered set disagree, or either has duplicate/colliding entries.
 * Returns the validated, lexicographically-sorted execution list.
 *
 * @param {string[]} discovered - sorted repo-relative POSIX paths on disk
 * @param {string[]} registered - the inventory manifest
 * @param {(p:string)=>boolean} [onDisk] - existence probe for registered entries
 * @returns {string[]}
 */
export function validateInventory(discovered, registered, onDisk = null) {
  const disc = assertNoDuplicates(discovered, 'discovered');
  const reg = assertNoDuplicates(registered, 'registered');

  const unregistered = [...disc].filter(p => !reg.has(p));
  if (unregistered.length > 0) {
    throw new Error(`run-all: FAIL-CLOSED — discovered spec(s) not in inventory.json (added-but-unregistered): ${unregistered.join(', ')}`);
  }
  const missingFromDisk = [...reg].filter(p => !disc.has(p));
  if (missingFromDisk.length > 0) {
    throw new Error(`run-all: FAIL-CLOSED — inventory.json entr(y/ies) missing from disk (registered-but-deleted): ${missingFromDisk.join(', ')}`);
  }
  // Optional stronger probe: every registered path resolves on disk.
  if (typeof onDisk === 'function') {
    const absent = [...reg].filter(p => !onDisk(p));
    if (absent.length > 0) throw new Error(`run-all: FAIL-CLOSED — inventory entr(y/ies) not found on disk: ${absent.join(', ')}`);
  }
  return normalizeAndSort([...reg]);
}

/**
 * Discover → validate → import every validated spec in lexicographic order.
 * Any validation failure throws before a single spec is imported.
 */
export async function runAll({ testDir = TEST_DIR, repoRoot = REPO_ROOT, inventoryPath = INVENTORY_PATH } = {}) {
  const discovered = discoverSpecs(testDir, repoRoot);
  const registered = loadInventory(inventoryPath);
  const execList = validateInventory(discovered, registered, p => existsSync(`${repoRoot}/${p}`));
  for (const rel of execList) {
    await import(pathToFileURL(`${repoRoot}/${rel}`).href);
  }
  return execList;
}

// Executed by `node --test lab/test/run-all.js`: validation runs at module load
// (top-level await); a mismatch throws here and fails the CI check before any
// spec's tests are collected.
await runAll();
