// test/unit/derive-byte-identity.spec.js
//
// BI-1 — default-mode envelope byte-identity regression (Cycle-004 S01 Phase A).
//
// Recomputes sha256(canonicalize(envelope)) for all 13 authoritative fixtures
// through the UNTOUCHED production analyze() path and asserts equality with the
// baseline captured at commit 2d7bb157 in
//   test/baselines/cycle-004-default-mode-digests.json
//
// Any default-path byte drift fails this test. This is the pre-cycle byte-identity
// floor the derivation kernel (S01 Phase C/D) must never move in default mode.
//
// SCOPE: BI-1 baseline reproduction (accepted CP-A — the three BI-1 tests below
// are unchanged in meaning) PLUS BI-2 (explicit-OFF ≡ option-absent), BI-3
// (experimental-ON on the mechanically-derived burned-domain set ≡ default), the
// rejection-envelope byte-identity invariant, and the determinism co-requirement.
// BI-2/BI-3 were added in S01 Phase D alongside the default-OFF derivation kernel.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ForgeConstruct, RULES } from '../../src/index.js';
import { canonicalize }   from '../../src/receipt/canonicalize.js';
import { sha256 }         from '../../src/receipt/hash.js';

const repoRootUrl  = new URL('../../', import.meta.url);
const baselinePath = fileURLToPath(new URL('../baselines/cycle-004-default-mode-digests.json', import.meta.url));
const baseline     = JSON.parse(readFileSync(baselinePath, 'utf8'));

const EXPECTED_COMMIT         = '2d7bb157e19ffda86f5e072f92c42c2dbb575f6d';
const EXPECTED_TIMESTAMP_BASE = 1700000000000;
const EXPECTED_NOW            = 1700000000000;
const EXPECTED_FIXTURE_COUNT  = 13;

// A repository-relative POSIX path: non-empty; forward-slash separators only;
// not absolute (no leading '/', no 'X:' drive); no backslashes; no empty,
// '.' or '..' segments (rejects escaping / non-canonical / non-POSIX paths).
function isValidPosixRelPath(p) {
  if (typeof p !== 'string' || p.length === 0) return false;
  if (p.includes('\\')) return false;         // backslash ⇒ non-POSIX
  if (p.startsWith('/')) return false;        // absolute (POSIX)
  if (/^[A-Za-z]:/.test(p)) return false;     // absolute (Windows drive)
  for (const seg of p.split('/')) {
    if (seg.length === 0) return false;       // empty / leading / trailing / double-slash
    if (seg === '.' || seg === '..') return false; // relative / escaping segment
  }
  return true;
}

test('BI-1: baseline header pins the authoritative capture configuration', () => {
  assert.equal(baseline.captured_at_commit, EXPECTED_COMMIT, 'captured_at_commit must be the baseline commit');
  assert.equal(baseline.node_line, '20', 'node_line must be 20');
  assert.ok(baseline.capture_config && typeof baseline.capture_config === 'object', 'capture_config present');
  assert.equal(baseline.capture_config.timestampBase, EXPECTED_TIMESTAMP_BASE, 'timestampBase pinned');
  assert.equal(baseline.capture_config.now, EXPECTED_NOW, 'now pinned');
  assert.ok(Array.isArray(baseline.fixtures), 'fixtures[] inventory present');
  assert.ok(Array.isArray(baseline.digests), 'digests[] present');
});

test('BI-1: exactly 13 unique, well-formed POSIX fixture entries', () => {
  assert.equal(baseline.fixtures.length, EXPECTED_FIXTURE_COUNT, 'exactly 13 fixtures in the inventory');
  assert.equal(baseline.digests.length, EXPECTED_FIXTURE_COUNT, 'exactly 13 digest entries');

  // digests are in the same order as the inventory (no missing / reordered entry)
  assert.deepEqual(baseline.digests.map(d => d.fixture), baseline.fixtures,
    'digest fixture order matches the inventory exactly');

  // inventory: valid POSIX + unique (rejects absolute/escaping/non-POSIX/duplicate)
  const seen = new Set();
  for (const f of baseline.fixtures) {
    assert.ok(isValidPosixRelPath(f), `fixture must be a valid relative POSIX path: ${f}`);
    assert.ok(!seen.has(f), `duplicate fixture path: ${f}`);
    seen.add(f);
  }
  assert.equal(seen.size, EXPECTED_FIXTURE_COUNT, 'no duplicate fixtures');

  // each digest entry: feed_id == POSIX fixture path; lowercase sha256:<64hex>
  for (const d of baseline.digests) {
    assert.ok(isValidPosixRelPath(d.fixture), `digest.fixture must be valid POSIX: ${d.fixture}`);
    assert.equal(d.feed_id, d.fixture, 'feed_id equals the repository-relative POSIX fixture path');
    assert.match(d.digest, /^sha256:[0-9a-f]{64}$/, `digest must be lowercase sha256:<64hex>: ${d.digest}`);
  }
});

test('BI-1: every default-mode envelope digest reproduces the baseline (13/13)', async () => {
  for (const entry of baseline.digests) {
    const absFixture = fileURLToPath(new URL(entry.fixture, repoRootUrl)); // absolute read path
    const forge = new ForgeConstruct();
    const result = await forge.analyze(absFixture, {
      feed_id: entry.fixture,                                 // repository-relative POSIX feed_id
      timestampBase: baseline.capture_config.timestampBase,
      now: baseline.capture_config.now,
    });
    const digest = sha256(canonicalize(result.envelope));
    assert.equal(digest, entry.digest, `default-mode envelope drift for ${entry.fixture}`);
  }
});

// ── BI-2 / BI-3 — default-OFF derivation integration (S01 Phase D) ───────────

const CAPTURE = baseline.capture_config;

async function analyzeFixture(fixtureRel, extraOptions) {
  const abs = fileURLToPath(new URL(fixtureRel, repoRootUrl));
  const forge = new ForgeConstruct();
  const result = await forge.analyze(abs, {
    feed_id: fixtureRel,
    timestampBase: CAPTURE.timestampBase,
    now: CAPTURE.now,
    ...extraOptions,
  });
  return { result, digest: sha256(canonicalize(result.envelope)) };
}

test('BI-2: explicit-OFF ≡ option-absent (all OFF forms, all 13 fixtures)', async () => {
  const OFF_FORMS = [{ experimental: null }, { experimental: {} }, { experimental: { derivation: false } }];
  for (const entry of baseline.digests) {
    const base = await analyzeFixture(entry.fixture, {});
    assert.equal(base.digest, entry.digest, `BI-2 sanity: default digest for ${entry.fixture}`);
    assert.ok(!('experimental_derivation' in base.result),
      `default (OFF) response must contain no experimental result field: ${entry.fixture}`);
    for (const off of OFF_FORMS) {
      const v = await analyzeFixture(entry.fixture, off);
      assert.equal(v.digest, base.digest,
        `explicit-OFF ${JSON.stringify(off)} must be byte-identical to absent for ${entry.fixture}`);
    }
  }
});

test('BI-3: experimental-ON on the burned-domain set ≡ default (fence 2; authored proposals unchanged)', async () => {
  // Mechanically determine the burned-domain set: fixtures producing ≥1 authored
  // domain proposal in default mode (computed here, never hardcoded).
  const burned = [];
  for (const entry of baseline.digests) {
    const base = await analyzeFixture(entry.fixture, {});
    if (base.result.proposals.length >= 1) {
      burned.push({ fixture: entry.fixture, digest: entry.digest, proposals: base.result.proposals });
    }
  }
  assert.ok(burned.length >= 1, 'expected a non-empty burned-domain set');

  for (const b of burned) {
    const on = await analyzeFixture(b.fixture, { experimental: { derivation: true } });
    // envelope byte-identical to default (the kernel is never invoked — fence 2)
    assert.equal(on.digest, b.digest, `burned-domain ${b.fixture}: ON envelope must equal default`);
    // authored domain proposals remain first and unchanged (no fallback appended)
    assert.deepStrictEqual(on.result.proposals, b.proposals, `authored proposals must be unchanged for ${b.fixture}`);
  }
});

test('BI-3: a derivation rejection leaves the envelope byte-identical to default', async () => {
  // Zero-proposal fixtures pass fence 2 and invoke the kernel; a NO_INSTRUMENT
  // rejection must leave the claim surface (envelope) untouched.
  let rejections = 0;
  for (const entry of baseline.digests) {
    const base = await analyzeFixture(entry.fixture, {});
    if (base.result.proposals.length !== 0) continue; // fence 2 would block kernel invocation
    const on = await analyzeFixture(entry.fixture, { experimental: { derivation: true } });
    if (on.result.experimental_derivation && on.result.experimental_derivation.state === 'NO_INSTRUMENT') {
      rejections++;
      assert.equal(on.digest, entry.digest,
        `derivation rejection for ${entry.fixture} must leave the envelope byte-identical to default`);
    }
  }
  assert.ok(rejections >= 1, 'expected ≥1 zero-proposal fixture to reject and prove envelope invariance');
});

test('experimental derivation ON requires explicit timestampBase and now (fail-closed)', async () => {
  const abs = fileURLToPath(new URL('fixtures/usgs-m4.5-day.json', repoRootUrl));
  const forge = new ForgeConstruct();
  await assert.rejects(
    () => forge.analyze(abs, { feed_id: 'fixtures/usgs-m4.5-day.json', experimental: { derivation: true } }),
    /requires explicit timestampBase and now/);
});

// ── Load-bearing reachability: the positive derive path through the real analyze() ──
// (S01 review §3.1 correction) — proves a full-history, zero-domain input derives an
// appended statistical fallback proposal via the production analyze() entry point, and
// that the ParameterRecord / forbidden claim keys never enter the envelope. A direct
// deriveThresholdParameter() unit test does not exercise this composition.

test('BI-3+: full-history zero-domain input derives a fallback through the real analyze() (end-to-end positive path)', async () => {
  const fixture = 'fixtures/robustness/correlated-upstream.json';
  const abs = fileURLToPath(new URL(fixture, repoRootUrl));

  // (1) precondition: the chosen input yields ZERO authored-domain proposals in default mode,
  //     and default mode carries no experimental result key.
  const base = await new ForgeConstruct().analyze(abs, {
    feed_id: fixture, timestampBase: 1700000000000, now: 1700000000000,
  });
  assert.equal(base.proposals.length, 0, 'precondition: fixture is zero-domain in default mode');
  assert.ok(!('experimental_derivation' in base), 'default mode carries no experimental_derivation key');

  // (2)–(4) drive the SAME input through the production analyze() with derivation explicitly ON,
  //     explicit deterministic timestampBase + now, and a config sufficient for the full history to
  //     DERIVE (not reject): p=0.5 (existence minimum n*=6), a wide window, n_min=6.
  const on = await new ForgeConstruct().analyze(abs, {
    feed_id: fixture,
    timestampBase: 1700000000000,
    now: 99999999999999,
    experimental: { derivation: { p: '0.5', window: { min_days: 100000, n_min: 6 } } },
  });

  // (5) reachability through the exported analyze() (not a direct deriveThresholdParameter()).
  const ed = on.experimental_derivation;
  assert.ok(ed, 'experimental mode surfaces the experimental_derivation result key');
  assert.equal(ed.state, 'RANKED_CANDIDATES', 'the full-history input derives, not rejects');
  assert.ok(ed.record && Number.isFinite(ed.record.value), 'derived ParameterRecord value is finite');

  // exactly one appended fallback proposal in the envelope, of the statistical fallback shape
  assert.equal(on.envelope.proposals.length, 1, 'exactly one appended fallback proposal in the envelope');
  const p = on.envelope.proposals[0];
  assert.equal(p.template, 'threshold_gate', 'statistical fallback uses the threshold_gate template');
  assert.equal(p.confidence, 0.5, 'statistical fallback confidence is 0.50');
  assert.deepStrictEqual(
    Object.keys(p.params).sort(),
    ['base_rate', 'input_mode', 'settlement_source', 'threshold', 'threshold_type', 'window_hours'],
    'only the approved six schema-open fallback fields appear in params');
  // derived threshold flows to the envelope proposal and equals the derived record value
  // (assert the relationship + finiteness rather than duplicating kernel math or hardcoding)
  assert.equal(p.params.threshold, ed.record.value, 'envelope proposal threshold === derived record.value');
  assert.ok(Number.isFinite(p.params.threshold), 'derived threshold is finite');
  assert.equal(p.params.window_hours, 720);
  assert.equal(p.params.base_rate, null);
  assert.equal(p.params.input_mode, 'single');
  assert.equal(p.params.threshold_type, 'statistical');
  assert.equal(p.params.settlement_source, null);

  // the ParameterRecord itself must NOT be embedded anywhere in the envelope
  const envStr = JSON.stringify(on.envelope);
  for (const field of ['effective_information', 'uncertainty', 'algorithm_id', 'quantile-ci-existence', 'n_star', 'coverage_model', 'reconsideration']) {
    assert.ok(!envStr.includes(field), `envelope must not leak ParameterRecord field: ${field}`);
  }

  // no forbidden claim-surface key anywhere in the envelope
  const FORBIDDEN = new Set(['scoring', 'certified', 'admitted', 'calibrated', 'calibration', 'certificate']);
  const keys = [];
  (function collect(n) {
    if (Array.isArray(n)) n.forEach(collect);
    else if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) { keys.push(k); collect(v); }
  })(on.envelope);
  assert.deepEqual(keys.filter(k => FORBIDDEN.has(k)), [], 'envelope contains no forbidden claim-surface keys');

  // authored rule registry unchanged
  assert.equal(RULES.length, 13, 'authored RULES registry remains 13');
});
