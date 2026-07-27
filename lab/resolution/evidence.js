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

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { contentAddress, assertNoForbiddenKeys, sha256LFNormalized } from '../harness/manifests.js';
import { writeCanonicalJsonAtomic } from '../harness/slice-fixtures.js';
import { appendLedgerLine, readLedger, TRIALS_LEDGER_PATH, BURN_LEDGER_PATH } from '../harness/ledgers.js';
import { verifyAllPins } from './verify-pins.js';

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

// ───────────────────────────────────────────────────────────────────────────────
// Cycle-006 successor layer (α) — SDD DR-10.1/10.2/10.3/10.4/10.5; Sprint Plan T1.1.
//
// Branch-aware terminal authority. ONE record kind in TWO authority forms: a
// `pre-freeze-standalone` record (an ending before the successor freeze exists, so
// there is no chain and no pin-invariance to reference) and a `post-freeze-chain`
// record (the full chain head). A shared core is mandatory in BOTH forms; the
// form-specific blocks are structurally present ONLY in their own form — the
// validator enforces per-form REQUIRED and FORBIDDEN key sets, so neither form can
// carry, stub, or null-fill the other's fields.
//
// The Cycle-005 builders above are left at their `cycle-005` literals: this is the
// "add alongside" option the Sprint Plan grants for LU-1 (§5.4 mixed-literal
// clause); the wholesale cycle-literal migration of every record builder is T3.1's
// (LU-3). Every Cycle-006 record path below hard-codes its own literals — never a
// parameter, flag, or environment value (C6-FR-A2 is a safety property), so no path
// here can construct a `cycle-005`-labelled Cycle-006 record.
// ───────────────────────────────────────────────────────────────────────────────

const C006_CYCLE = 'cycle-006';
const C006_SCHEMA_VERSION = '2.0.0';

/** The nine §10.2-B terminal type tokens (DR-10.1). Four inherited, five new. */
export const C006_TERMINAL_TYPES = Object.freeze([
  'acquisition-unresolved',
  'contamination-halt',
  'specification-halt',
  'tooling-failure-accepted',
  'no-lawfully-constitutable-pool',
  'pre-freeze-halt',
  'gate-a-not-achieved',
  'g0-declined',
  'runnability-violation',
]);

/** The mandatory authority-form discriminator values (DR-10.2). */
export const C006_AUTHORITY_FORMS = Object.freeze(['pre-freeze-standalone', 'post-freeze-chain']);

/** The fixed stage vocabulary that `stages_reached`/`absent_stages` partition (DR-10.2). */
export const C006_STAGES = Object.freeze([
  'gate-p', 'survey', 'pool', 'gate-f', 'apparatus-gate-a', 'g0', 'acquisition',
  'census', 'selection', 'invariance', 'p-star', 'runnability-validity', 'seal',
]);

/** `buildHaltRecord` classes extended for the successor generation (DR-10.3). */
export const C006_HALT_CLASSES = Object.freeze([
  'census-refusal', 'pin-mismatch', 'identity-drift', 'contamination', 'spec-error',
  'fr-d2-bound', 'survey-contamination',
]);

/** The three lawful M5 seal shapes (DR-10.5). */
export const C006_SEAL_SHAPES = Object.freeze(['primary+reserve', 'primary-only', 'none-eligible']);

/** Stage → the ref key that must be structurally present exactly when the stage is reached. */
const STAGE_REF_KEY = Object.freeze({
  'gate-p': 'gate_p_ref',
  'survey': 'survey_ref',
  'pool': 'pool_ref',
  'gate-f': 'gate_f_ref',
  'apparatus-gate-a': 'gate_a_ref',
  'g0': 'g0_ref',
  'acquisition': 'acquisition_ref',
  'census': 'census_ref',
  'selection': 'selection_ref',
  'invariance': 'invariance_ref',
  'p-star': 'p_star_ref',
  'runnability-validity': 'runnability_validity_ref',
  'seal': 'seal_ref',
});

/** Pre-freeze `reached_artifacts` fields, keyed by the stage that makes each mandatory (DR-10.2). */
const PRE_FREEZE_ARTIFACT_FIELDS = Object.freeze({
  'gate-p': ['criteria_digest', 'preregistration_digest', 'derivations_digest', 'gate_p_record_id'],
  'survey': ['survey_record_digest'],
  'pool': ['pool_digest'],
});

/** Stages that can be reached before the successor freeze exists. */
const PRE_FREEZE_REACHABLE_STAGES = Object.freeze(['gate-p', 'survey', 'pool']);

const SHARED_CORE_KEYS = Object.freeze([
  'record_kind', 'schema_version', 'cycle', 'authority_form', 'disposition', 'b_type',
  'reason', 'stages_reached', 'absent_stages', 'historical_preservation', 'ledger_proofs',
  'contamination_status', 'claim_ceiling_ack', 'operator_statement', 'at', 'refs',
]);

const PRE_FREEZE_REQUIRED_KEYS = Object.freeze([...SHARED_CORE_KEYS, 'reached_artifacts']);

/**
 * Everything a pre-freeze ending cannot possibly have reached. Presence of ANY of
 * these keys — even set to null — is a refusal (DR-10.2 "never stub or null-fill").
 */
const PRE_FREEZE_FORBIDDEN_KEYS = Object.freeze([
  'chain', 'pin_invariance_ref', 'successor_freeze_ref', 'apparatus_identity',
  'supersession_attestation', 'm5_handoff',
  'gate_f_ref', 'gate_a_ref', 'g0_ref', 'acquisition_ref', 'census_ref', 'selection_ref',
  'invariance_ref', 'p_star_ref', 'runnability_validity_ref', 'seal_ref',
]);

const POST_FREEZE_REQUIRED_KEYS = Object.freeze([...SHARED_CORE_KEYS, 'chain', 'pin_invariance_ref']);

/** The pre-freeze form's own block is forbidden in the chain form (DR-10.2). */
const POST_FREEZE_FORBIDDEN_KEYS = Object.freeze(['reached_artifacts']);

/** `handoff_basis` values: a real seal's handoff vs. a disposition-B as-applicable echo (AC-B7). */
const M5_BASIS_SEALED = 'sealed-m4';
const M5_BASIS_AS_APPLICABLE = 'as-applicable-no-seal';

const HISTORICAL_FREEZE_REL = 'lab/freeze/freeze-manifest.json';
const C005_CHAIN_HEAD_REL = 'lab/evidence/cycle-005/terminal-disposition.json';
const C005_SUPERSEDED_GATE_A_REL = 'lab/evidence/cycle-005/gate-a-acceptance-superseded-29b4dd8f.json';
// The two scientific ledgers are named ONLY by the frozen `ledgers.js` constants — never
// re-stated as literals here, which the G9 token lint forbids in every apparatus
// namespace (FR-D5/FR-E4, I-12) and which would also duplicate the single source of truth.
const LEDGER_DIR_REL = TRIALS_LEDGER_PATH.split('/').slice(0, -1).join('/');
const KNOWN_LEDGER_FILES = Object.freeze([TRIALS_LEDGER_PATH, BURN_LEDGER_PATH].map(p => p.split('/').pop()));

function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

/**
 * Historical-preservation verifier for the shared core (DR-10.4, C6-FR-E2/E3): the
 * 43-asset Cycle-004 freeze re-pins, every Cycle-005 chain link is byte-identical,
 * and the superseded Gate-A record is intact. Every link that declares a
 * `record_id` must also self-verify as its own content address.
 *
 * PURE (no throw) — the caller decides HALT. `block` is exactly the shape the
 * record carries; `mismatches` is diagnostics and is NEVER written into a record.
 *
 * @param {{repoRoot:string}} p
 * @returns {{block:Object, mismatches:Array<{path:string, reason:string}>}}
 */
export function verifyHistoricalPreservation({ repoRoot }) {
  const mismatches = [];
  const pins = verifyAllPins({ repoRoot, freezeManifestPath: join(repoRoot, HISTORICAL_FREEZE_REL) });
  mismatches.push(...pins.mismatches);

  let links_verified = 0;
  let all_byte_identical = false;
  let superseded_gate_a_record_intact = false;

  const headAbs = join(repoRoot, C005_CHAIN_HEAD_REL);
  if (!existsSync(headAbs)) {
    mismatches.push({ path: C005_CHAIN_HEAD_REL, reason: 'Cycle-005 chain head missing' });
  } else {
    const head = JSON.parse(readFileSync(headAbs, 'utf8'));
    const links = Array.isArray(head.chain) ? head.chain : [];
    for (const link of links) {
      const abs = join(repoRoot, link.path);
      if (!existsSync(abs)) { mismatches.push({ path: link.path, reason: 'chain-linked artifact missing on disk' }); continue; }
      const text = readFileSync(abs, 'utf8');
      if (sha256LFNormalized(text) !== link.sha256) {
        mismatches.push({ path: link.path, reason: 'chain-linked artifact digest mismatch (C6-FR-E2)' });
        continue;
      }
      if (link.record_id != null && computeRecordId(JSON.parse(text)) !== link.record_id) {
        mismatches.push({ path: link.path, reason: 'chain-linked record_id does not self-verify' });
        continue;
      }
      links_verified += 1;
      if (link.path === C005_SUPERSEDED_GATE_A_REL) superseded_gate_a_record_intact = true;
    }
    all_byte_identical = links.length > 0 && links_verified === links.length;
    if (!superseded_gate_a_record_intact) {
      mismatches.push({ path: C005_SUPERSEDED_GATE_A_REL, reason: 'superseded Gate-A record not verified among the chain links' });
    }
  }

  return {
    block: {
      freeze_43: { all_match: pins.all_match, asset_count: pins.asset_count, companion_match: pins.companion_match },
      chain_13: { links_verified, all_byte_identical },
      superseded_gate_a_record_intact,
    },
    mismatches,
  };
}

/**
 * Ledger proofs for the shared core (DR-10.2; C6-FR-A9/E4, NFR-C6-LEDGER): the
 * Cycle-005 verifier plus `no_successor_ledger` — no Cycle-006 code path opens a
 * scientific ledger for write, so no third ledger file may appear.
 *
 * @param {{repoRoot:string, baselines:{trials_sha256:(string|null), burn_bytes:number}}} p
 * @returns {{block:Object, unexpected_ledger_files:string[]}}
 */
export function verifyC006LedgerProofs({ repoRoot, baselines }) {
  const base = verifyLedgerBaselines({ repoRoot, baselines });
  const dir = join(repoRoot, LEDGER_DIR_REL);
  const unexpected = existsSync(dir) ? readdirSync(dir).filter(n => !KNOWN_LEDGER_FILES.includes(n)) : [];
  return {
    block: {
      trials_line_byte_identical: base.trials_line_byte_identical,
      trials_sha256: base.trials_sha256,
      burn_ledger_bytes: base.burn_ledger_bytes,
      burn_empty: base.burn_empty,
      no_successor_ledger: unexpected.length === 0,
    },
    unexpected_ledger_files: unexpected,
  };
}

/**
 * Validate an `m5_handoff` block (DR-10.5, C6-FR-A6). PURE.
 *
 * Disposition A carries the COMPLETE block under `handoff_basis: "sealed-m4"`.
 * Disposition B carries the block's fields AS-APPLICABLE under
 * `handoff_basis: "as-applicable-no-seal"` and may NEVER carry `sealed` — a
 * terminal ending has no seal to hand off (AC-B7).
 *
 * @param {Object} block
 * @param {{disposition:('A'|'B')}} p
 * @returns {{valid:boolean, problems:string[]}}
 */
export function validateM5Handoff(block, { disposition } = {}) {
  const problems = [];
  const bad = (m) => problems.push(`m5_handoff: ${m}`);
  if (!isPlainObject(block)) return { valid: false, problems: ['m5_handoff: must be an object'] };

  const sealedBasis = disposition === 'A';
  const expectedBasis = sealedBasis ? M5_BASIS_SEALED : M5_BASIS_AS_APPLICABLE;
  if (block.handoff_basis !== expectedBasis) bad(`handoff_basis must be "${expectedBasis}" for disposition ${disposition}`);
  if (!sealedBasis && has(block, 'sealed')) bad('a disposition-B record may never carry `sealed` (AC-B7)');

  // Fields the COMPLETE (disposition-A) block must carry; a B block validates only
  // what it actually carries ("as-applicable").
  const required = ['n', 'p_star', 'census', 'permitted_experimental_span_days', 'n_divergence',
    'runtime_envelope', 'reserve_runnability_reattestation', 'identities', 'burn_prerequisites',
    'open_operator_decisions'];
  if (sealedBasis) {
    for (const k of ['sealed', ...required]) if (!has(block, k)) bad(`missing required key "${k}"`);
  }

  if (has(block, 'sealed')) {
    const s = block.sealed;
    if (!isPlainObject(s)) bad('sealed must be an object');
    else {
      if (!C006_SEAL_SHAPES.includes(s.shape)) bad(`unknown seal shape "${s.shape}"`);
      const memberOk = (m) => isPlainObject(m) && Number.isInteger(m.rank) && m.rank >= 1 && isNonEmptyString(m.provider) && isNonEmptyString(m.product);
      if (s.shape === 'none-eligible') {
        if (s.primary !== null) bad('shape "none-eligible" requires primary: null');
        if (s.reserve !== null) bad('shape "none-eligible" requires reserve: null');
      } else {
        if (!memberOk(s.primary)) bad('primary must be {rank, provider, product}');
        if (s.shape === 'primary+reserve' && !memberOk(s.reserve)) bad('shape "primary+reserve" requires a reserve member');
        if (s.shape === 'primary-only' && s.reserve !== null) bad('shape "primary-only" requires reserve: null');
      }
    }
  }
  if (has(block, 'n')) {
    const n = block.n;
    if (!isPlainObject(n) || !Number.isInteger(n.census_n) || !isNonEmptyString(n.fr_a6_class) || !isNonEmptyString(n.provenance_ref)) {
      bad('n must be {census_n:int, fr_a6_class, provenance_ref}');
    }
  }
  if (has(block, 'p_star')) {
    const p = block.p_star;
    if (!isPlainObject(p)) bad('p_star must be an object');
    else {
      const resolved = has(p, 'value') && has(p, 'record_ref');
      const blocked = has(p, 'lawful_block_ref');
      if (resolved === blocked) bad('p_star must be EITHER {value, record_ref} OR {lawful_block_ref}');
    }
  }
  if (has(block, 'census')) {
    const c = block.census;
    if (!isPlainObject(c) || !has(c, 'cadence') || !has(c, 'span') || !has(c, 'history_years')) {
      bad('census must be {cadence, span, history_years}');
    }
  }
  if (has(block, 'n_divergence')) {
    const d = block.n_divergence;
    if (!isPlainObject(d) || !has(d, 'census_n') || !has(d, 'experimental_n_estimate') || !isNonEmptyString(d.divergence_note)) {
      bad('n_divergence must be {census_n, experimental_n_estimate, divergence_note}');
    } else if (has(block, 'n') && isPlainObject(block.n) && block.n.census_n !== d.census_n) {
      bad(`internal inconsistency: n.census_n (${block.n.census_n}) !== n_divergence.census_n (${d.census_n})`);
    }
  }
  if (has(block, 'runtime_envelope')) {
    const r = block.runtime_envelope;
    if (!isPlainObject(r) || !isNonEmptyString(r.constants_provenance_ref) || !isPlainObject(r.ci_matrix)) {
      bad('runtime_envelope must be {constants_provenance_ref, ci_matrix}');
    } else {
      const { os, node } = r.ci_matrix;
      if (!Array.isArray(os) || !os.some(o => /ubuntu/i.test(String(o))) || !os.some(o => /windows/i.test(String(o)))) {
        bad('ci_matrix.os must record both the ubuntu and windows legs');
      }
      if (!Array.isArray(node) || !node.includes(20) || !node.includes(24)) bad('ci_matrix.node must record legs 20 and 24');
    }
  }
  if (has(block, 'reserve_runnability_reattestation')) {
    const rr = block.reserve_runnability_reattestation;
    if (!isPlainObject(rr) || !has(rr, 'reserve_in_envelope') || !has(rr, 'validity_record_ref')) {
      bad('reserve_runnability_reattestation must be {reserve_in_envelope, validity_record_ref}');
    } else if (isPlainObject(block.sealed) && block.sealed.shape === 'primary+reserve' && typeof rr.reserve_in_envelope !== 'boolean') {
      bad('a sealed reserve requires a boolean reserve_in_envelope');
    }
  }
  if (has(block, 'identities')) {
    const i = block.identities;
    if (!isPlainObject(i) || !isNonEmptyString(i.historical_freeze_companion) || !isNonEmptyString(i.successor_freeze_companion) || !isNonEmptyString(i.apparatus_identity)) {
      bad('identities must carry the historical freeze, successor freeze, and apparatus digests');
    }
  }
  if (has(block, 'burn_prerequisites')) {
    const b = block.burn_prerequisites;
    if (!Array.isArray(b) || b.length === 0 || !b.every(isNonEmptyString)) bad('burn_prerequisites must be a non-empty string list');
  }
  if (has(block, 'open_operator_decisions') && !Array.isArray(block.open_operator_decisions)) {
    bad('open_operator_decisions must be an array');
  }
  return { valid: problems.length === 0, problems };
}

function validateStagePartition(record, problems) {
  const { stages_reached: reached, absent_stages: absent } = record;
  if (!Array.isArray(reached) || !Array.isArray(absent)) { problems.push('stages_reached and absent_stages must both be arrays'); return; }
  for (const [label, list] of [['stages_reached', reached], ['absent_stages', absent]]) {
    for (const s of list) if (!C006_STAGES.includes(s)) problems.push(`${label} contains unknown stage "${s}"`);
    if (new Set(list).size !== list.length) problems.push(`${label} contains duplicate entries`);
  }
  const overlap = reached.filter(s => absent.includes(s));
  if (overlap.length > 0) problems.push(`stages_reached and absent_stages overlap on: ${overlap.join(', ')}`);
  const covered = new Set([...reached, ...absent]);
  const missing = C006_STAGES.filter(s => !covered.has(s));
  if (missing.length > 0) problems.push(`stages do not partition the vocabulary — unaccounted: ${missing.join(', ')}`);
}

/**
 * The per-form terminal-record validator (DR-10.2). PURE — returns every problem
 * rather than throwing on the first, so a record review reads as one report.
 *
 * Enforces: the shared core; the authority-form discriminator; per-form REQUIRED
 * and FORBIDDEN key sets (a forbidden key is a refusal even when null — no
 * stubbing); the stage partition over the fixed vocabulary; structural block
 * absence for every unreached stage (the absence attestation, mechanized); the
 * M5-handoff contract; and the NFR-CLAIM claim-ceiling guard.
 *
 * @param {Object} record
 * @returns {{valid:boolean, problems:string[]}}
 */
export function validateTerminalRecord(record) {
  const problems = [];
  if (!isPlainObject(record)) return { valid: false, problems: ['terminal record must be an object'] };

  const form = record.authority_form;
  if (!C006_AUTHORITY_FORMS.includes(form)) problems.push(`authority_form must be one of ${C006_AUTHORITY_FORMS.join(' | ')}, got "${form}"`);
  if (record.schema_version !== C006_SCHEMA_VERSION) problems.push(`schema_version must be "${C006_SCHEMA_VERSION}"`);
  if (record.cycle !== C006_CYCLE) problems.push(`cycle must be "${C006_CYCLE}"`);

  const disposition = record.disposition;
  if (disposition !== 'A' && disposition !== 'B') problems.push('disposition must be "A" | "B"');
  const expectedKind = disposition === 'A' ? 'm4-acceptance' : 'terminal-disposition';
  if (record.record_kind !== expectedKind) problems.push(`record_kind must be "${expectedKind}" for disposition ${disposition}`);
  if (disposition === 'A') {
    if (record.b_type !== null) problems.push('disposition A requires b_type: null');
  } else if (!C006_TERMINAL_TYPES.includes(record.b_type)) {
    problems.push(`disposition B requires a §10.2-B type, got "${record.b_type}"`);
  }
  if (form === 'pre-freeze-standalone' && disposition === 'A') {
    problems.push('a pre-freeze-standalone record cannot carry disposition A — no seal exists before the successor freeze');
  }

  if (!isNonEmptyString(record.reason)) problems.push('reason (C6-FR-T1) required');
  if (!isNonEmptyString(record.contamination_status)) problems.push('contamination_status required');
  if (record.claim_ceiling_ack !== true) problems.push('claim_ceiling_ack must be true');
  if (!isNonEmptyString(record.operator_statement)) problems.push('operator_statement required');
  if (!isNonEmptyString(record.at)) problems.push('at (wall-clock governance record) required');
  if (!isPlainObject(record.refs)) problems.push('refs must be an object');

  const hp = record.historical_preservation;
  if (!isPlainObject(hp) || !isPlainObject(hp.freeze_43) || !isPlainObject(hp.chain_13) || !has(hp, 'superseded_gate_a_record_intact')) {
    problems.push('historical_preservation must carry {freeze_43, chain_13, superseded_gate_a_record_intact} (DR-10.4, required in BOTH forms)');
  } else {
    for (const k of ['all_match', 'asset_count', 'companion_match']) if (!has(hp.freeze_43, k)) problems.push(`historical_preservation.freeze_43 missing "${k}"`);
    for (const k of ['links_verified', 'all_byte_identical']) if (!has(hp.chain_13, k)) problems.push(`historical_preservation.chain_13 missing "${k}"`);
  }
  const lp = record.ledger_proofs;
  if (!isPlainObject(lp)) problems.push('ledger_proofs required in BOTH forms');
  else for (const k of ['trials_line_byte_identical', 'trials_sha256', 'burn_ledger_bytes', 'burn_empty', 'no_successor_ledger']) {
    if (!has(lp, k)) problems.push(`ledger_proofs missing "${k}"`);
  }

  validateStagePartition(record, problems);
  const reached = Array.isArray(record.stages_reached) ? record.stages_reached : [];

  const required = form === 'pre-freeze-standalone' ? PRE_FREEZE_REQUIRED_KEYS
    : form === 'post-freeze-chain' ? POST_FREEZE_REQUIRED_KEYS : [];
  const forbidden = form === 'pre-freeze-standalone' ? PRE_FREEZE_FORBIDDEN_KEYS
    : form === 'post-freeze-chain' ? POST_FREEZE_FORBIDDEN_KEYS : [];
  for (const k of required) if (!has(record, k)) problems.push(`${form}: missing required key "${k}"`);
  for (const k of forbidden) {
    if (has(record, k)) problems.push(`${form}: forbidden key "${k}" present${record[k] === null ? ' (null-filled — still a refusal)' : ''}`);
  }

  if (form === 'pre-freeze-standalone') {
    const tooLate = reached.filter(s => !PRE_FREEZE_REACHABLE_STAGES.includes(s));
    if (tooLate.length > 0) problems.push(`pre-freeze-standalone cannot have reached: ${tooLate.join(', ')}`);
    const ra = record.reached_artifacts;
    if (!isPlainObject(ra)) problems.push('reached_artifacts must be an object');
    else {
      const allowed = new Set();
      for (const [stage, fields] of Object.entries(PRE_FREEZE_ARTIFACT_FIELDS)) {
        for (const f of fields) {
          if (reached.includes(stage)) { allowed.add(f); if (!has(ra, f)) problems.push(`reached_artifacts missing "${f}" for reached stage "${stage}"`); }
        }
      }
      for (const f of Object.keys(ra)) if (!allowed.has(f)) problems.push(`reached_artifacts carries "${f}" for an unreached stage (strictly as-reached)`);
    }
  }

  if (form === 'post-freeze-chain') {
    if (!reached.includes('gate-f')) problems.push('post-freeze-chain requires the gate-f stage to have been reached');
    if (!Array.isArray(record.chain)) problems.push('chain[] must be an array');
    else {
      const conn = verifyChainConnectivity(record);
      if (!conn.connected) problems.push(...conn.problems);
    }
    // Structural absence: a stage ref is present EXACTLY when its stage was reached.
    for (const stage of C006_STAGES) {
      const key = STAGE_REF_KEY[stage];
      if (reached.includes(stage) && !has(record, key)) problems.push(`stage "${stage}" reached but "${key}" is structurally absent`);
      if (!reached.includes(stage) && has(record, key)) problems.push(`stage "${stage}" is in absent_stages but "${key}" is present (absence attestation breach)`);
    }
    if (disposition === 'A' && !has(record, 'm5_handoff')) problems.push('disposition A requires the m5_handoff block (DR-10.5)');
    if (has(record, 'm5_handoff')) problems.push(...validateM5Handoff(record.m5_handoff, { disposition }).problems);
  }

  if (has(record, 'record_id') && !verifyRecordId(record)) problems.push('record_id does not equal the self-excluded content address');

  try { assertNoForbiddenKeys(record); } catch (e) { problems.push(e.message); }
  return { valid: problems.length === 0, problems };
}

/** Throwing wrapper around {@link validateTerminalRecord} — the guard on every build path. */
export function assertTerminalRecord(record) {
  const { valid, problems } = validateTerminalRecord(record);
  if (!valid) throw new Error(`Cycle-006 terminal record refused:\n  - ${problems.join('\n  - ')}`);
  return record;
}

/**
 * Build the `pre-freeze-standalone` authority form (DR-10.2/10.3, C6-FR-E1(a)):
 * an ending reached before the successor freeze exists. It proves the HISTORICAL
 * pin set only (DR-10.4) and says so through `absent_stages` plus the structural
 * absence of every later block. `absent_stages` is the complement of
 * `stages_reached` over the fixed vocabulary, so the partition holds by
 * construction; the validator re-checks it for records assembled by hand.
 *
 * @returns {Object} the record WITHOUT `record_id` ({@link writeOneShotRecord} adds it)
 */
export function buildPreFreezeTerminalRecord({
  b_type, reason, stages_reached, reached_artifacts, historical_preservation, ledger_proofs,
  contamination_status, claim_ceiling_ack, operator_statement, at, refs = {},
}) {
  const reached = Array.isArray(stages_reached) ? [...stages_reached] : stages_reached;
  return assertTerminalRecord({
    record_kind: 'terminal-disposition',
    schema_version: C006_SCHEMA_VERSION,
    cycle: C006_CYCLE,
    authority_form: 'pre-freeze-standalone',
    disposition: 'B',
    b_type,
    reason,
    stages_reached: reached,
    absent_stages: C006_STAGES.filter(s => !(Array.isArray(reached) && reached.includes(s))),
    historical_preservation,
    ledger_proofs,
    reached_artifacts,
    contamination_status,
    claim_ceiling_ack,
    operator_statement,
    at,
    refs,
  });
}

/**
 * Build the `post-freeze-chain` authority form (DR-10.2/10.3, C6-FR-E1(b)): the
 * successor chain head, `m4-acceptance` (disposition A) XOR `terminal-disposition`
 * (disposition B). `stage_refs` is keyed by stage name and is spread into the
 * record as the per-stage ref keys, so a ref exists EXACTLY for a reached stage —
 * the absence attestation holds by construction.
 *
 * @returns {Object} the record WITHOUT `record_id` ({@link writeOneShotRecord} adds it)
 */
export function buildSuccessorChainHead({
  disposition, b_type = null, reason, stages_reached, stage_refs = {}, chain, pin_invariance_ref,
  historical_preservation, ledger_proofs, contamination_status, claim_ceiling_ack,
  operator_statement, at, refs = {}, m5_handoff = undefined, supersession_attestation = undefined,
}) {
  const reached = Array.isArray(stages_reached) ? [...stages_reached] : [];
  for (const stage of Object.keys(stage_refs)) {
    if (!C006_STAGES.includes(stage)) throw new Error(`buildSuccessorChainHead: unknown stage "${stage}" in stage_refs`);
    if (!reached.includes(stage)) throw new Error(`buildSuccessorChainHead: stage_refs names unreached stage "${stage}"`);
  }
  const record = {
    record_kind: disposition === 'A' ? 'm4-acceptance' : 'terminal-disposition',
    schema_version: C006_SCHEMA_VERSION,
    cycle: C006_CYCLE,
    authority_form: 'post-freeze-chain',
    disposition,
    b_type: disposition === 'A' ? null : b_type,
    reason,
    stages_reached: reached,
    absent_stages: C006_STAGES.filter(s => !reached.includes(s)),
    historical_preservation,
    ledger_proofs,
    chain,
    pin_invariance_ref,
    contamination_status,
    claim_ceiling_ack,
    operator_statement,
    at,
    refs,
  };
  for (const [stage, value] of Object.entries(stage_refs)) record[STAGE_REF_KEY[stage]] = value;
  if (m5_handoff !== undefined) record.m5_handoff = m5_handoff;
  if (supersession_attestation !== undefined) record.supersession_attestation = supersession_attestation;
  return assertTerminalRecord(record);
}

/**
 * Build a Cycle-006 `halt-<n>.json` record (§6.5, DR-10.3). Same mechanics as the
 * Cycle-005 builder with the class list extended by `fr-d2-bound` (DR-8 typed
 * fail-closed escalation) and `survey-contamination` (DR-4.8), at the successor
 * literals. Wrapped with a content-address by {@link writeOneShotRecord}.
 */
export function buildCycle006HaltRecord({ halt_class, evidence, blast_radius, at, refs = {} }) {
  if (!C006_HALT_CLASSES.includes(halt_class)) throw new Error(`buildCycle006HaltRecord: unknown class "${halt_class}"`);
  if (!isNonEmptyString(at)) throw new Error('buildCycle006HaltRecord: at (wall-clock) required');
  const record = { record_kind: 'halt', schema_version: C006_SCHEMA_VERSION, cycle: C006_CYCLE, class: halt_class, evidence, blast_radius, refs, at };
  assertNoForbiddenKeys(record);
  return record;
}
