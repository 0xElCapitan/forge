// lab/test/walk-forward.spec.js
//
// Cycle-004 S02 (FR-6 engine + AC-10 battery; SDD Lane L3/DR-2; Sprint Plan
// §7.2 T2.9). Origin-schedule vectors + record-level leakage insensitivity +
// evaluation non-overlap + locked-tail + `--final` refusal + engine run.
// Fabricated/local only; zero network; temp/`lab/out`-scoped writes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalize } from '../../src/receipt/canonicalize.js';
import { sha256 } from '../../src/receipt/hash.js';
import { ForgeConstruct } from '../../src/index.js';
import {
  computeSchedule, evaluateOrigins, assertFinalAllowed, H_MS, PURGE_GAP_MS,
} from '../harness/walk-forward.js';
import { materializeSlice } from '../harness/slice-fixtures.js';

const DAY = 86_400_000;
const SPEC = JSON.parse(readFileSync(fileURLToPath(new URL('../../spec/derive-vectors.json', import.meta.url)), 'utf8'));
const scheduleVectors = SPEC.vectors.filter(v => v.consumer === 'lab' && v.category === 'origin-schedule');

function daily(startUTC, n, valueFn) {
  const recs = [];
  for (let i = 0; i < n; i++) recs.push({ timestamp: new Date(startUTC + i * DAY).toISOString(), value: valueFn(i) });
  return recs;
}
function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-wf-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('origin-schedule vectors recompute to exact deep + digest equality (F-5)', () => {
  assert.ok(scheduleVectors.length >= 2, 'at least two schedule vectors');
  for (const v of scheduleVectors) {
    const computed = computeSchedule(v.input);
    assert.deepStrictEqual(computed, v.expected, `${v.id}: computeSchedule deep equality`);
    assert.equal(sha256(canonicalize(computed)), v.expected_digest, `${v.id}: expected_digest`);
    const { entry_digest, ...rest } = v;
    assert.equal(sha256(canonicalize(rest)), v.entry_digest, `${v.id}: entry_digest`);
  }
});

test('AC-10(iv): kept evaluation windows never overlap (pairwise gaps ≥ H; Feb-adjacency skip)', () => {
  const s = computeSchedule({ tMin: Date.UTC(2021, 0, 1), tMax: Date.UTC(2021, 7, 31), minDays: 1 });
  // Mar is dropped by the keep-rule (28-day gap < 30) — proven via the eligible/kept diff.
  assert.ok(s.eligible.includes(Date.UTC(2021, 2, 1)), 'Mar1 is eligible');
  assert.ok(!s.kept.some(b => b.origin_ms === Date.UTC(2021, 2, 1)), 'Mar1 is NOT kept (Feb-adjacency overlap control)');
  for (let i = 1; i < s.kept.length; i++) {
    assert.ok(s.kept[i].origin_ms - s.kept[i - 1].origin_ms >= H_MS, 'consecutive kept origins ≥ H apart');
  }
});

test('AC-10(v): no normal-mode evaluation window ends past the locked tail', () => {
  const s = computeSchedule({ tMin: Date.UTC(2021, 0, 1), tMax: Date.UTC(2021, 7, 31), minDays: 1 });
  for (const b of s.kept) assert.ok(b.evaluation_end_ms <= s.tailStartMs, 'evaluation_end ≤ tail_start (normal mode cannot touch the tail)');
  // Jul/Aug candidates excluded because their eval windows exceed the tail.
  assert.ok(!s.eligible.includes(Date.UTC(2021, 6, 1)), 'Jul1 excluded by the locked tail');
});

test('AC-10(v): --final refuses without a valid freeze-manifest reference (refusal path only this cycle)', () => {
  assert.doesNotThrow(() => assertFinalAllowed({ final: false }), 'normal mode never refuses');
  assert.throws(() => assertFinalAllowed({ final: true }), /freeze-manifest reference/, 'final without a ref refuses (DR-5)');
  assert.throws(() => assertFinalAllowed({ final: true, freezeManifestRef: { manifest_path: '' } }), /freeze-manifest reference/, 'malformed ref refuses');
  // A shape-valid ref would proceed in C-005 (no freeze manifest exists this cycle).
  assert.doesNotThrow(() => assertFinalAllowed({ final: true, freezeManifestRef: { manifest_path: 'lab/freeze/x.json', manifest_sha256: 'sha256:deadbeef' } }));
});

test('AC-10(i/ii record level): purge + future twins produce byte-identical analyze() derivation', async () => {
  await withTempAsync(async (dir) => {
    const origin = Date.UTC(2021, 4, 1);
    const cut = origin - PURGE_GAP_MS;
    const base = daily(Date.UTC(2021, 0, 1), 80, i => (i % 13) + 1);
    const a = base.concat(daily(cut + DAY, 10, i => 100 + i)).concat(daily(origin + DAY, 10, () => 7));
    const b = base.concat(daily(cut + DAY, 10, i => 500 - i)).concat(daily(origin + DAY, 10, i => 999999 - i));
    const pa = join(dir, 'a.json'); writeFileSync(pa, JSON.stringify(a));
    const pb = join(dir, 'b.json'); writeFileSync(pb, JSON.stringify(b));
    const sa = materializeSlice({ fixturePath: pa, timestampBase: 0, originMs: origin, trainingCutoffMs: cut, runId: 'ra', outRoot: join(dir, 'out') });
    const sb = materializeSlice({ fixturePath: pb, timestampBase: 0, originMs: origin, trainingCutoffMs: cut, runId: 'rb', outRoot: join(dir, 'out') });
    assert.equal(readFileSync(sa.slicePath, 'utf8'), readFileSync(sb.slicePath, 'utf8'), 'byte-identical slices');

    const construct = new ForgeConstruct();
    const opts = { feed_id: 'lab/test/fixtures/synthetic.json', timestampBase: 0, now: Date.UTC(2021, 11, 31), experimental: { derivation: { p: '0.5', window: { min_days: 1, n_min: 6 } } } };
    const ra = await construct.analyze(sa.slicePath, opts);
    const rb = await construct.analyze(sb.slicePath, opts);
    assert.equal(canonicalize(ra.experimental_derivation), canonicalize(rb.experimental_derivation), 'byte-identical derivation (leakage-safe)');
  });
});

test('engine produces the expected mixed candidate/rejected schedule and is re-run deterministic', async () => {
  await withTempAsync(async (dir) => {
    const recs = daily(Date.UTC(2021, 0, 1), 243, i => (i % 17) + 1); // Jan1..Aug31
    const p = join(dir, 'f.json'); writeFileSync(p, JSON.stringify(recs));
    const config = { feed_id: 'lab/test/fixtures/synthetic-daily.json', p: '0.5', window: { min_days: 1, n_min: 6 }, timestampBase: 0, now: Date.UTC(2021, 11, 31) };
    const r1 = await evaluateOrigins({ fixturePath: p, runId: 'e1', config, outRoot: join(dir, 'out') });
    assert.equal(r1.origins.length, 4, 'four kept origins (Feb, Apr, May, Jun)');
    assert.equal(r1.origins[0].method.state, 'NO_INSTRUMENT', 'Feb origin rejects (insufficient history)');
    assert.equal(r1.origins[0].method.reason_code, 'insufficient_history');
    for (const o of r1.origins.slice(1)) assert.equal(o.method.state, 'RANKED_CANDIDATES', 'later origins emit candidates');

    const r2 = await evaluateOrigins({ fixturePath: p, runId: 'e2', config, outRoot: join(dir, 'out') });
    assert.equal(canonicalize(r1.origins), canonicalize(r2.origins), 're-run origins byte-identical (config-deterministic)');
  });
});

async function withTempAsync(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-wf-'));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
