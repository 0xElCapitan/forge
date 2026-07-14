// lab/test/ledgers.spec.js
//
// Cycle-004 S02 (FR-10 ledger support; SDD Lane L4; Sprint Plan §7.2 T2.9,
// AC-6/AC-21). Append-only JSONL discipline, exactly-one-primary refusal,
// deterministic registered_at_ms, and the byte-empty tracked-ledger invariant.
// Ledger tests operate on TEMP copies — never the tracked files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalize } from '../../src/receipt/canonicalize.js';
import {
  readLedger, appendLedgerLine, buildTrialEntry, appendTrial, buildBurnEntry,
  TRIALS_LEDGER_PATH, BURN_LEDGER_PATH,
} from '../harness/ledgers.js';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url)))); // <repo>/lab/test/x → <repo>

function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-led-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('append-only: whole-line canonical JSONL + LF; readLedger round-trips', () => {
  withTemp((dir) => {
    const p = join(dir, 'trials.jsonl');
    assert.deepStrictEqual(readLedger(p), [], 'missing ledger reads empty');
    appendLedgerLine(p, { b: 2, a: 1 });
    appendLedgerLine(p, { c: 3 });
    assert.equal(readFileSync(p, 'utf8'), '{"a":1,"b":2}\n{"c":3}\n', 'canonical sorted-key lines, explicit LF');
    assert.deepStrictEqual(readLedger(p), [{ a: 1, b: 2 }, { c: 3 }]);
  });
});

test('trial entry shape: parameter=threshold, score=pinball fixed; registered_at_ms from config (integer)', () => {
  const e = buildTrialEntry({ trial_id: 't1', registered_at_ms: 1700000000000, family: 'synthetic', method: 'quantile-trailing-window', p: '0.95', window_rule: 'W≥90d,n_min=59', status: 'primary', notes: 'pre-registered' });
  assert.equal(e.parameter, 'threshold');
  assert.equal(e.score, 'pinball');
  assert.equal(e.status, 'primary');
  assert.equal(e.registered_at_ms, 1700000000000);
  assert.throws(() => buildTrialEntry({ trial_id: 't', registered_at_ms: 1.5, family: 'f', method: 'm', p: '0.5', window_rule: 'w', status: 'primary' }), /never wall clock/, 'non-integer registered_at_ms rejected');
  assert.throws(() => buildTrialEntry({ trial_id: 't', registered_at_ms: 0, family: 'f', method: 'm', p: '0.5', window_rule: 'w', status: 'bogus' }), /primary.*exploratory/);
});

test('exactly-one-primary: a second primary is refused; exploratory entries are unlimited', () => {
  withTemp((dir) => {
    const p = join(dir, 'trials.jsonl');
    const primary = buildTrialEntry({ trial_id: 'p', registered_at_ms: 1, family: 'f', method: 'm', p: '0.95', window_rule: 'w', status: 'primary' });
    appendTrial(p, primary);
    appendTrial(p, buildTrialEntry({ trial_id: 'e1', registered_at_ms: 2, family: 'f', method: 'm', p: '0.90', window_rule: 'w', status: 'exploratory' }));
    appendTrial(p, buildTrialEntry({ trial_id: 'e2', registered_at_ms: 3, family: 'f', method: 'm', p: '0.99', window_rule: 'w', status: 'exploratory' }));
    assert.throws(() => appendTrial(p, buildTrialEntry({ trial_id: 'p2', registered_at_ms: 4, family: 'f', method: 'm', p: '0.95', window_rule: 'w', status: 'primary' })), /exactly-one-primary/, 'second primary refused');
    assert.equal(readLedger(p).filter(e => e.status === 'primary').length, 1, 'still exactly one primary');
    assert.equal(readLedger(p).filter(e => e.status === 'exploratory').length, 2);
  });
});

test('burn-ledger entry is a reserved shape (event ∈ {fetch, retest}); never appended this cycle', () => {
  const b = buildBurnEntry({ family: 'synthetic', event: 'fetch', consumed_at: 1, cycle: 'C-005', authorization: 'op' });
  assert.equal(canonicalize(b), '{"authorization":"op","consumed_at":1,"cycle":"C-005","event":"fetch","family":"synthetic"}');
  assert.throws(() => buildBurnEntry({ family: 'x', event: 'nope', consumed_at: 1, cycle: 'c', authorization: 'a' }), /fetch.*retest/);
});

test('AC-6/AC-21: the tracked ledgers are byte-empty (harness never populates them)', () => {
  assert.equal(statSync(join(REPO_ROOT, TRIALS_LEDGER_PATH)).size, 0, 'trials-ledger.jsonl is 0 bytes');
  assert.equal(statSync(join(REPO_ROOT, BURN_LEDGER_PATH)).size, 0, 'burn-ledger.jsonl is 0 bytes');
});
