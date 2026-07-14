/**
 * lab/harness/ledgers.js
 *
 * Cycle-004 S02 (FR-10 ledger implementation support; SDD Lane L4; Sprint Plan
 * §7.2 T2.6). Append-only JSONL ledgers with whole-line atomic append. The
 * trials ledger enforces the exactly-one-`primary` invariant (a second `primary`
 * append is refused). `registered_at_ms` comes from the run config — NEVER the
 * wall clock (determinism). The two tracked ledgers
 * (`lab/ledgers/trials-ledger.jsonl`, `lab/ledgers/burn-ledger.jsonl`) are
 * created BYTE-EMPTY and stay empty through S02 — tests operate on temp copies.
 *
 * @module lab/harness/ledgers
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { canonicalize } from '../../src/receipt/canonicalize.js';

/** Canonical repo-relative paths of the two tracked ledgers (byte-empty in S02). */
export const TRIALS_LEDGER_PATH = 'lab/ledgers/trials-ledger.jsonl';
export const BURN_LEDGER_PATH = 'lab/ledgers/burn-ledger.jsonl';

/** Read a JSONL ledger into an array of objects (empty for a missing/empty file). */
export function readLedger(filePath) {
  if (!existsSync(filePath)) return [];
  const text = readFileSync(filePath, 'utf8');
  if (text.length === 0) return [];
  return text.split('\n').filter(l => l.length > 0).map((l, i) => {
    try { return JSON.parse(l); } catch (e) { throw new Error(`readLedger: malformed JSONL at ${filePath} line ${i + 1}: ${e.message}`); }
  });
}

/**
 * Append one fully-formed, `\n`-terminated canonical JSONL record atomically
 * (write the complete line or nothing; §8.3.1). A partial line is never left.
 */
export function appendLedgerLine(filePath, obj) {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, canonicalize(obj) + '\n');
}

/**
 * Build a trials-ledger entry (Lane L4 shape). `registered_at_ms` is supplied
 * from the run config (never wall clock). `parameter` and `score` are fixed.
 *
 * @param {Object} p
 * @param {string} p.trial_id
 * @param {number} p.registered_at_ms
 * @param {string} p.family
 * @param {string} p.method
 * @param {string} p.p - DR-6 decimal string
 * @param {string} p.window_rule
 * @param {"primary"|"exploratory"} p.status
 * @param {string} [p.notes]
 * @returns {Object}
 */
export function buildTrialEntry({ trial_id, registered_at_ms, family, method, p, window_rule, status, notes = '' }) {
  if (typeof trial_id !== 'string' || trial_id.length === 0) throw new Error('buildTrialEntry: trial_id required');
  if (!Number.isInteger(registered_at_ms)) throw new Error('buildTrialEntry: registered_at_ms must be an integer from run config (never wall clock)');
  if (status !== 'primary' && status !== 'exploratory') throw new Error('buildTrialEntry: status must be "primary" | "exploratory"');
  return { trial_id, registered_at_ms, family, parameter: 'threshold', method, score: 'pinball', p, window_rule, status, notes };
}

/**
 * Append a trial entry, enforcing the exactly-one-`primary` invariant: if the
 * ledger already contains a `primary` entry and this entry is `primary`, refuse
 * (throw) — a second primary is never accepted (void condition 4).
 *
 * @param {string} filePath - a test-scoped temp copy (NEVER the tracked ledger in S02)
 * @param {Object} entry - from `buildTrialEntry`
 */
export function appendTrial(filePath, entry) {
  if (entry.status === 'primary') {
    const existing = readLedger(filePath);
    if (existing.some(e => e.status === 'primary')) {
      throw new Error('appendTrial: exactly-one-primary invariant — a second "primary" trial is refused (n_trials = 1; void condition 4)');
    }
  }
  appendLedgerLine(filePath, entry);
}

/**
 * Build a holdout-burn-ledger entry (reserved shape for C-005 step 9 onward).
 * NEVER appended to the tracked burn ledger this cycle — it stays byte-empty
 * through M3. Provided for shape validation only.
 *
 * @param {Object} p
 * @param {string} p.family
 * @param {"fetch"|"retest"} p.event
 * @param {number} p.consumed_at
 * @param {string} p.cycle
 * @param {string} p.authorization
 * @returns {Object}
 */
export function buildBurnEntry({ family, event, consumed_at, cycle, authorization }) {
  if (event !== 'fetch' && event !== 'retest') throw new Error('buildBurnEntry: event must be "fetch" | "retest"');
  return { family, event, consumed_at, cycle, authorization };
}
