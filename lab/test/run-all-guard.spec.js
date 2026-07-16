// lab/test/run-all-guard.spec.js
//
// Cycle-004 S02 (R-2 / PR-1 fail-closed runner guard; Sprint Plan §7.2 T2.9).
// Proves the runner (a) FAILS on an added-but-unregistered spec, (b) FAILS on a
// registered-but-deleted spec, and (c) yields the same execution inventory
// regardless of filesystem enumeration order (sort-before-import). Also asserts
// the REAL discovered set equals the REAL inventory (self-consistency).
//
// NOTE: run-all.js is imported DYNAMICALLY inside each test callback (never at
// module top level). run-all.js validates + imports the whole suite in its own
// top-level await; a top-level `import` here would deadlock that TLA (circular
// import → Node exit 13). By the time these callbacks run, run-all.js's TLA has
// completed, so the dynamic import resolves instantly from the module cache.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const runner = () => import('./run-all.js');

test('(a) FAIL-CLOSED: a discovered spec absent from the inventory is rejected before import', async () => {
  const { validateInventory } = await runner();
  const discovered = ['lab/test/a.spec.js', 'lab/test/b.spec.js']; // b added but not registered
  const registered = ['lab/test/a.spec.js'];
  assert.throws(() => validateInventory(discovered, registered), /added-but-unregistered.*b\.spec\.js/);
});

test('(b) FAIL-CLOSED: an inventory entry missing from disk is rejected before import', async () => {
  const { validateInventory } = await runner();
  const discovered = ['lab/test/a.spec.js']; // b registered but deleted
  const registered = ['lab/test/a.spec.js', 'lab/test/b.spec.js'];
  assert.throws(() => validateInventory(discovered, registered), /registered-but-deleted.*b\.spec\.js/);
});

test('(b) FAIL-CLOSED: an inventory entry absent on disk (onDisk probe) is rejected', async () => {
  const { validateInventory } = await runner();
  const list = ['lab/test/a.spec.js', 'lab/test/ghost.spec.js'];
  assert.throws(() => validateInventory(list, list, p => p !== 'lab/test/ghost.spec.js'), /not found on disk.*ghost/);
});

test('duplicate / path-colliding entries are rejected in both sets', async () => {
  const { validateInventory } = await runner();
  assert.throws(() => validateInventory(['lab/test/a.spec.js', 'lab\\test\\a.spec.js'], ['lab/test/a.spec.js']), /duplicate\/colliding discovered/);
  assert.throws(() => validateInventory(['lab/test/a.spec.js'], ['lab/test/a.spec.js', 'lab/test/a.spec.js']), /duplicate\/colliding registered/);
});

test('(c) enumeration order cannot change the execution inventory (sort-before-import)', async () => {
  const { validateInventory, normalizeAndSort } = await runner();
  const shuffled = ['lab/test/scoring.spec.js', 'lab/test/baselines.spec.js', 'lab/test/manifests.spec.js', 'lab/test/ledgers.spec.js'];
  const sorted = normalizeAndSort(shuffled);
  assert.deepStrictEqual(sorted, ['lab/test/baselines.spec.js', 'lab/test/ledgers.spec.js', 'lab/test/manifests.spec.js', 'lab/test/scoring.spec.js']);
  const forward = validateInventory(sorted, shuffled);
  const reverse = validateInventory(sorted.slice().reverse(), shuffled.slice().reverse());
  assert.deepStrictEqual(forward, reverse, 'execution inventory is order-independent');
});

test('self-consistency: the REAL discovered lab specs equal the REAL inventory exactly', async () => {
  const { discoverSpecs, loadInventory, normalizeAndSort } = await runner();
  const discovered = discoverSpecs();
  const registered = normalizeAndSort(loadInventory());
  assert.deepStrictEqual(discovered, registered, 'on-disk specs and inventory.json agree (the real runner would pass)');
  assert.ok(registered.includes('lab/test/run-all-guard.spec.js'), 'the guard spec itself is registered');
  assert.equal(registered.length, 26, 'twenty-six lab specs (fourteen S02/S03 census/freeze + eleven Cycle-005 S01 acquisition/resolution + one F1 review-remediation spec)');
});
