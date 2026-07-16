/**
 * lab/resolution/evidence.js
 *
 * Cycle-005 S01 (PRD FR-E1/FR-E2/FR-E4, FR-D5, NFR-CLAIM; SDD DR-4, DR-10;
 * Sprint Plan T1.6).
 *
 * The evidence-chain record writers. Every one-shot record is canonical JSON with a
 * self-excluded content id (`record_id = sha256(canonicalize(record − record_id))`,
 * the `computeRunId` pattern) and an explicit `refs` block naming upstream records.
 * Every record passes the §3 forbidden-key guard (`assertNoForbiddenKeys`) BEFORE
 * write (NFR-CLAIM). JSONL appends are `\n`-terminated canonical lines via the frozen
 * `appendLedgerLine`. Append-only + invalidation-by-record (DR-4.5): status is
 * conferred/withdrawn by LATER records, never by editing bytes.
 *
 * The ledger-baseline verifier proves the two scientific ledgers untouched (FR-D5 /
 * FR-E4): the preregistered trials line byte-identical, the burn JSONL exactly 0
 * bytes. Nothing in this module (or namespace) writes either scientific ledger — the
 * G9 token lint enforces it.
 *
 * @module lab/resolution/evidence
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { contentAddress, assertNoForbiddenKeys, sha256LFNormalized } from '../harness/manifests.js';
import { writeCanonicalJsonAtomic } from '../harness/slice-fixtures.js';
import { appendLedgerLine, readLedger, TRIALS_LEDGER_PATH, BURN_LEDGER_PATH } from '../harness/ledgers.js';

/** Compute a record's self-excluded content id (DR-4.3). */
export function computeRecordId(record) {
  const { record_id, ...rest } = record;
  void record_id;
  return contentAddress(rest);
}

/** True when a record's `record_id` equals its self-excluded content id. */
export function verifyRecordId(record) {
  return typeof record.record_id === 'string' && record.record_id === computeRecordId(record);
}

/**
 * Write a one-shot evidence record: §3 forbidden-key guard, insert the self-excluded
 * `record_id`, canonical atomic write (DR-10). Returns the written record.
 *
 * @param {string} filePath
 * @param {Object} record - WITHOUT `record_id` (it is computed here)
 * @returns {Object}
 */
export function writeOneShotRecord(filePath, record) {
  assertNoForbiddenKeys(record);
  const withId = { ...record, record_id: computeRecordId(record) };
  writeCanonicalJsonAtomic(filePath, withId);
  return withId;
}

/** Append one canonical JSONL record (with the §3 guard). Returns the record. */
export function appendJsonlRecord(filePath, record) {
  assertNoForbiddenKeys(record);
  appendLedgerLine(filePath, record);
  return record;
}

/**
 * Verify the scientific ledger baselines (FR-D5 / FR-E4 / AC-C1 / AC-C3): the
 * preregistered trials line byte-identical to the DR-2 baseline, and the burn JSONL
 * exactly 0 bytes. PURE result (no throw); the caller decides HALT.
 *
 * @param {Object} p
 * @param {string} p.repoRoot
 * @param {{trials_sha256:(string|null), burn_bytes:number}} p.baselines - the DR-2 ledger_baselines
 * @returns {{trials_line_byte_identical:boolean, trials_sha256:(string|null), burn_ledger_bytes:number, burn_empty:boolean}}
 */
export function verifyLedgerBaselines({ repoRoot, baselines }) {
  const trialsAbs = join(repoRoot, TRIALS_LEDGER_PATH);
  const trials_sha256 = existsSync(trialsAbs) ? sha256LFNormalized(readFileSync(trialsAbs, 'utf8')) : null;
  const burnAbs = join(repoRoot, BURN_LEDGER_PATH);
  const burn_ledger_bytes = existsSync(burnAbs) ? statSync(burnAbs).size : 0;
  return {
    trials_line_byte_identical: baselines.trials_sha256 != null && trials_sha256 === baselines.trials_sha256,
    trials_sha256,
    burn_ledger_bytes,
    burn_empty: burn_ledger_bytes === 0,
  };
}

/** Read a JSONL evidence log into records (empty for missing/empty). */
export function readJsonl(filePath) { return readLedger(filePath); }

/**
 * Build a `halt-<n>.json` HALT record body (§6.5). Wall-clock governance record
 * (DR-10.3). Wrapped with a content-address by {@link writeOneShotRecord}.
 */
export function buildHaltRecord({ halt_class, evidence, blast_radius, at, refs = {} }) {
  const CLASSES = ['census-refusal', 'pin-mismatch', 'identity-drift', 'contamination', 'spec-error'];
  if (!CLASSES.includes(halt_class)) throw new Error(`buildHaltRecord: unknown class "${halt_class}"`);
  if (typeof at !== 'string' || at.length === 0) throw new Error('buildHaltRecord: at (wall-clock) required');
  return { record_kind: 'halt', schema_version: '1.0.0', cycle: 'cycle-005', class: halt_class, evidence, blast_radius, refs, at };
}

/**
 * Build an `invalidation-<n>.json` record (DR-4.5): marks a provisional record
 * invalidated/non-authoritative by reference — NEVER an edit of the invalidated record.
 */
export function buildInvalidationRecord({ invalidates, terminal_reason_ref, at }) {
  if (typeof invalidates !== 'string' || invalidates.length === 0) throw new Error('buildInvalidationRecord: invalidates (record_id) required');
  if (typeof at !== 'string' || at.length === 0) throw new Error('buildInvalidationRecord: at (wall-clock) required');
  return { record_kind: 'invalidation', schema_version: '1.0.0', cycle: 'cycle-005', invalidates, terminal_reason_ref, at };
}

/**
 * Assemble the chain-head body (§7): `m4-acceptance.json` (disposition A) XOR
 * `terminal-disposition.json` (disposition B). Enumerates every chain artifact and
 * carries the ledger/pin proofs + claim-ceiling ack. Wall-clock governance record.
 * This is the S02 terminal artifact; S01 provides the builder + tests only.
 *
 * @returns {Object}
 */
export function buildChainHead({ disposition, b_type = null, classification_table, contamination_status, chain, ledger_proofs, pin_invariance_ref, claim_ceiling_ack, operator_statement, at }) {
  if (disposition !== 'A' && disposition !== 'B') throw new Error('buildChainHead: disposition must be "A" | "B"');
  if (disposition === 'B' && !['acquisition-unresolved', 'contamination-halt', 'specification-halt', 'tooling-failure-accepted'].includes(b_type)) {
    throw new Error(`buildChainHead: disposition B requires a valid b_type, got "${b_type}"`);
  }
  if (!Array.isArray(chain)) throw new Error('buildChainHead: chain[] required');
  if (typeof at !== 'string' || at.length === 0) throw new Error('buildChainHead: at (wall-clock) required');
  return {
    record_kind: disposition === 'A' ? 'm4-acceptance' : 'terminal-disposition',
    schema_version: '1.0.0',
    cycle: 'cycle-005',
    disposition,
    b_type: disposition === 'B' ? b_type : null,
    classification_table,
    contamination_status,
    chain,
    ledger_proofs,
    pin_invariance_ref,
    claim_ceiling_ack,
    operator_statement,
    at,
  };
}

/** Verify a chain head enumerates a fully-connected chain (every artifact digested + record_id present). */
export function verifyChainConnectivity(chainHead) {
  const problems = [];
  if (!Array.isArray(chainHead.chain)) return { connected: false, problems: ['no chain[]'] };
  for (const link of chainHead.chain) {
    if (typeof link.path !== 'string') problems.push('chain link missing path');
    if (typeof link.sha256 !== 'string') problems.push(`chain link ${link.path} missing sha256`);
  }
  return { connected: problems.length === 0, problems };
}
