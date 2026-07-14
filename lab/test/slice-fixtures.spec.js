// lab/test/slice-fixtures.spec.js
//
// Cycle-004 S02 (F-4 slicer-consistency + slice-level leakage identity; SDD
// DR-2; Sprint Plan §7.2 T2.9). All fixtures are fabricated/local; zero network.
// Writes only to OS temp dirs — never a tracked path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ingest, ingestFile } from '../../src/index.js';
import {
  ingestFixture, readRawFixture, assertHarnessFixture, sliceRawByTimestamp,
  materializeSlice, materializeSliceFromLoaded,
} from '../harness/slice-fixtures.js';

const DAY = 86_400_000;
const TS_BASE = 0;

/** Flat harness fixture: daily ISO records with a finite numeric value. */
function daily(startUTC, n, valueFn) {
  const recs = [];
  for (let i = 0; i < n; i++) recs.push({ timestamp: new Date(startUTC + i * DAY).toISOString(), value: valueFn(i) });
  return recs;
}

function writeFixture(dir, name, recs) {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(recs));
  return p;
}

function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-slice-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('F-4: slicer per-record timestamps equal analyze()-path ingestion timestamps', () => {
  withTemp((dir) => {
    const recs = daily(Date.UTC(2021, 0, 1), 40, i => (i % 7) + 1);
    const p = writeFixture(dir, 'f.json', recs);
    // Slicer path: production ingestFile with the run timestampBase.
    const sliced = ingestFixture(p, TS_BASE).map(e => e.timestamp);
    // analyze() path when timestampBase != null: ingest(JSON.parse(readFile), {timestampBase}).
    const analyzePath = ingest(JSON.parse(readFileSync(p, 'utf8')), { timestampBase: TS_BASE }).map(e => e.timestamp);
    assert.deepStrictEqual(sliced, analyzePath, 'slicer and analyze() derive identical timestamps');
  });
});

test('F-4: a fixture with one fallback (non-parsed) timestamp is rejected BEFORE slicing (DR-5)', () => {
  withTemp((dir) => {
    const recs = daily(Date.UTC(2021, 0, 1), 10, i => i + 1);
    recs[4] = { timestamp: 'not-a-timestamp', value: 5 }; // unparseable → ts_source fallback
    const p = writeFixture(dir, 'bad.json', recs);
    const raw = readRawFixture(p);
    const events = ingestFixture(p, TS_BASE);
    assert.throws(() => assertHarnessFixture(raw, events), /fallback timestamp is invalid|ts_source/);
  });
});

test('F-4: truncation does not change value-field detection (canonical single value field)', () => {
  withTemp((dir) => {
    const recs = daily(Date.UTC(2021, 0, 1), 30, i => i * 2 + 1);
    const p = writeFixture(dir, 'f.json', recs);
    const full = ingestFixture(p, TS_BASE);
    // Every truncated prefix selects the same value field ⇒ event values match the prefix.
    for (const k of [5, 10, 20]) {
      const pfx = writeFixture(dir, `pfx-${k}.json`, recs.slice(0, k));
      const ev = ingestFixture(pfx, TS_BASE);
      assert.deepStrictEqual(ev.map(e => e.value), full.slice(0, k).map(e => e.value), `prefix ${k} value-field stable`);
    }
  });
});

test('F-4: repeated slicing is byte-identical (deterministic slice boundaries)', () => {
  withTemp((dir) => {
    const recs = daily(Date.UTC(2021, 0, 1), 50, i => (i * 3) % 11);
    const p = writeFixture(dir, 'f.json', recs);
    const cut = Date.UTC(2021, 0, 20);
    const a = materializeSlice({ fixturePath: p, timestampBase: TS_BASE, originMs: cut + DAY, trainingCutoffMs: cut, runId: 'r1', outRoot: join(dir, 'out') });
    const b = materializeSlice({ fixturePath: p, timestampBase: TS_BASE, originMs: cut + DAY, trainingCutoffMs: cut, runId: 'r2', outRoot: join(dir, 'out') });
    assert.equal(readFileSync(a.slicePath, 'utf8'), readFileSync(b.slicePath, 'utf8'), 're-slice byte identity');
  });
});

test('AC-10(i): purge-interval observations cannot alter the slice (byte-identical slice files)', () => {
  withTemp((dir) => {
    const origin = Date.UTC(2021, 4, 1);       // May 1
    const cut = origin - 2_592_000_000;        // training cutoff = Apr 1
    const base = daily(Date.UTC(2021, 0, 1), 80, i => (i % 13) + 1); // spans Jan..late Mar (< cut)
    // Twin A vs B: identical below cut, DIFFERENT inside the purge interval [cut, origin).
    const purgeA = daily(cut + DAY, 10, i => 100 + i);
    const purgeB = daily(cut + DAY, 10, i => 500 - i);
    const pa = writeFixture(dir, 'a.json', base.concat(purgeA));
    const pb = writeFixture(dir, 'b.json', base.concat(purgeB));
    const sa = materializeSlice({ fixturePath: pa, timestampBase: TS_BASE, originMs: origin, trainingCutoffMs: cut, runId: 'ra', outRoot: join(dir, 'out') });
    const sb = materializeSlice({ fixturePath: pb, timestampBase: TS_BASE, originMs: origin, trainingCutoffMs: cut, runId: 'rb', outRoot: join(dir, 'out') });
    assert.equal(readFileSync(sa.slicePath, 'utf8'), readFileSync(sb.slicePath, 'utf8'), 'purge-interval differences excluded from the slice');
    // And the slice contains ONLY records strictly < cut.
    for (const rec of JSON.parse(readFileSync(sa.slicePath, 'utf8'))) {
      assert.ok(Date.parse(rec.timestamp) < cut, 'every sliced record < training cutoff');
    }
  });
});

test('AC-10(ii): post-origin (future-poisoned) observations cannot alter the slice', () => {
  withTemp((dir) => {
    const origin = Date.UTC(2021, 4, 1);
    const cut = origin - 2_592_000_000;
    const base = daily(Date.UTC(2021, 0, 1), 80, i => (i % 13) + 1);
    const futureA = daily(origin + DAY, 20, i => 7);
    const futureB = daily(origin + DAY, 20, i => 999999 - i); // wildly divergent future
    const pa = writeFixture(dir, 'a.json', base.concat(futureA));
    const pb = writeFixture(dir, 'b.json', base.concat(futureB));
    const sa = materializeSlice({ fixturePath: pa, timestampBase: TS_BASE, originMs: origin, trainingCutoffMs: cut, runId: 'ra', outRoot: join(dir, 'out') });
    const sb = materializeSlice({ fixturePath: pb, timestampBase: TS_BASE, originMs: origin, trainingCutoffMs: cut, runId: 'rb', outRoot: join(dir, 'out') });
    assert.equal(readFileSync(sa.slicePath, 'utf8'), readFileSync(sb.slicePath, 'utf8'), 'future differences excluded from the slice');
  });
});

test('AC-10(iii): purge-only value changes leave the sliced training fixture bytes unchanged', () => {
  withTemp((dir) => {
    const origin = Date.UTC(2021, 4, 1);
    const cut = origin - 2_592_000_000;
    const base = daily(Date.UTC(2021, 0, 1), 80, i => (i % 13) + 1);
    // Change ONLY values inside the purge interval (same timestamps).
    const purge = daily(cut + DAY, 10, i => i);
    const purgeChanged = purge.map(r => ({ timestamp: r.timestamp, value: r.value + 1000 }));
    const pa = writeFixture(dir, 'a.json', base.concat(purge));
    const pb = writeFixture(dir, 'b.json', base.concat(purgeChanged));
    const ra = readRawFixture(pa), rb = readRawFixture(pb);
    const ea = ingestFixture(pa, TS_BASE), eb = ingestFixture(pb, TS_BASE);
    const slA = sliceRawByTimestamp(ra, ea, cut);
    const slB = sliceRawByTimestamp(rb, eb, cut);
    assert.deepStrictEqual(slA, slB, 'purge-only value changes do not reach the training slice (record level)');
  });
});

test('assertHarnessFixture rejects non-array, empty, and non-finite value fixtures', () => {
  withTemp((dir) => {
    const good = daily(Date.UTC(2021, 0, 1), 5, i => i + 1);
    const p = writeFixture(dir, 'g.json', good);
    const ev = ingestFixture(p, TS_BASE);
    assert.doesNotThrow(() => assertHarnessFixture(good, ev));
    assert.throws(() => assertHarnessFixture('nope', ev), /flat JSON array/);
    assert.throws(() => assertHarnessFixture([], []), /empty fixture/);
  });
});
