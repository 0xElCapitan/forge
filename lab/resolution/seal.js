/**
 * lab/resolution/seal.js
 *
 * Cycle-005 S01 (PRD FR-C/FR-D/FR-E, §9.2; SDD DR-2, DR-4.5, DR-5, DR-6, §6.2;
 * Sprint Plan T1.6).
 *
 * The resolution orchestrator: verify-pins → reconcile (select) → FR-D2 invariance →
 * frozen selection → selection-outcome → p\* (where lawful) → outputs. It REFUSES to
 * run unless the DR-2 acquisition-identity self-verify passes AND the Gate-A + G0
 * records are present. It NEVER confers authority itself (DR-4.5): `selection-outcome.json`
 * carries no authority flag; authority is conferred only by the chain head
 * (`m4-acceptance.json`), which is the operator's S02 act.
 *
 * A selection-outcome record is written ONLY when the FR-D2 invariance verdict is
 * `invariant:true`; otherwise the honest ending is §9.2-B (acquisition-unresolved),
 * with no authoritative seal. Any pin mismatch / census refusal / DR-5 fail-closed is
 * a HALT (NFR-HALT). S01: composed + fixture-tested; the real seal over real census
 * output is an S02 operation.
 *
 * @module lab/resolution/seal
 */

import { verifyAcquisitionIdentity } from './identity.js';
import { verifyAllPins } from './verify-pins.js';
import { reconcile, runFrozenSelection } from './select.js';
import { runInvarianceTest } from './invariance.js';
import { resolveLawful } from './pstar.js';
import { writeOneShotRecord } from './evidence.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** A resolution HALT — pin mismatch, identity drift, or a DR-5 fail-closed verdict. */
export class SealHalt extends Error {
  constructor(message, halt_class) { super(message); this.name = 'SealHalt'; this.halt_class = halt_class; }
}

/**
 * Assert the seal preconditions (DR-2): acquisition identity self-verify passes AND
 * the Gate-A acceptance + G0 authorization records exist. Throws {@link SealHalt}.
 */
export function assertSealPreconditions({ repoRoot, evidenceDir }) {
  const manifestPath = join(evidenceDir, 'acquisition-manifest.json');
  try {
    verifyAcquisitionIdentity({ repoRoot, manifestPath });
  } catch (e) {
    throw new SealHalt(`seal refuses: ${e.message}`, 'identity-drift');
  }
  for (const name of ['gate-a-acceptance.json', 'g0-authorization.json']) {
    if (!existsSync(join(evidenceDir, name))) throw new SealHalt(`seal refuses: gate record absent: ${name} (Gate A + G0 must precede the seal)`, 'spec-error');
  }
}

/**
 * Run the resolution pipeline over the census report + classification set. Returns a
 * structured result: either a sealed selection-outcome (+ p\*), a blocked
 * (disposition-B acquisition-unresolved) result, or a HALT. Writes the
 * selection-outcome.json / p-star-resolution.json records ONLY when lawful.
 *
 * @param {Object} p
 * @param {string} p.repoRoot
 * @param {string} p.evidenceDir
 * @param {string} p.freezeManifestPath
 * @param {Object} p.censusReport
 * @param {Object} p.pool - frozen candidate-pool.json (parsed)
 * @param {{entries:Array}} p.burnedList - frozen burned-list.json (parsed)
 * @param {Object} p.statusByRank - { <rank>: { status, class, fixed_fields? } }
 * @param {{eligible:Object, ineligible:Object}} p.standIns
 * @param {Object} [p.primaryN] - { n, classification } of the sealed primary, when known (FR-D4)
 * @param {boolean} [p.write] - write the records to evidenceDir (default true)
 * @returns {Object}
 */
export function sealSelection({ repoRoot, evidenceDir, freezeManifestPath, censusReport, pool, burnedList, statusByRank, standIns, primaryN = null, write = true }) {
  // 1. Pin invariance (FR-E3) — a mismatch is a HALT, never a seal.
  const pins = verifyAllPins({ repoRoot, freezeManifestPath });
  if (!pins.all_match) throw new SealHalt(`seal refuses: pinned-asset invariance failed (${pins.mismatches.length} mismatch(es)) — void condition 1`, 'pin-mismatch');

  // 2. Reconcile census ↔ pool ↔ classifications (fail-closed).
  const rec = reconcile({ censusReport, pool, statusByRank });

  // 3. FR-D2 invariance test over the resolved/unresolved split.
  const unresolvedWithFixed = rec.unresolved.map(u => ({ ...u, fixed_fields: statusByRank[u.rank]?.fixed_fields }));
  const fr_d2 = runInvarianceTest({ resolved: rec.resolved, unresolved: unresolvedWithFixed, burnedList, standIns });

  // 4. The real frozen-rule run over the resolved subset (verbatim frozen output).
  const real_run = runFrozenSelection(rec.resolved, burnedList);

  // 5. Build the (provisional — DR-4.5) selection-outcome record.
  const selectionOutcome = {
    record_kind: 'selection-outcome',
    schema_version: '1.0.0',
    cycle: 'cycle-005',
    trial_ref: 'c005-e1-primary-001',
    refs: { census_report: censusReport.report_kind || null },
    real_run,
    fr_d2,
  };

  if (!fr_d2.invariant) {
    // §9.2-B acquisition-unresolved: no authoritative seal. The provisional outcome is
    // NOT written as an authoritative artifact; the honest ending is disposition B.
    return { halted: false, sealed: false, disposition_b: 'acquisition-unresolved', pins, reconciliation: rec.reconciliation, fr_d2, blocking_candidates: fr_d2.blocking_candidates, selection_outcome: selectionOutcome };
  }

  // 6. Invariant → write the (still-provisional-until-chain-head) selection outcome.
  let writtenOutcome = selectionOutcome;
  if (write) writtenOutcome = writeOneShotRecord(join(evidenceDir, 'selection-outcome.json'), selectionOutcome);

  // 7. p\* where lawful (FR-D4).
  let pStar = null;
  if (real_run.primary) {
    const n = primaryN?.n ?? null;
    const n_classification = primaryN?.classification ?? null;
    pStar = resolveLawful({ sealed_primary: real_run.primary, n, n_classification, refs: { selection_outcome: writtenOutcome.record_id || null } });
    if (write) pStar = writeOneShotRecord(join(evidenceDir, 'p-star-resolution.json'), pStar);
  }

  return { halted: false, sealed: true, pins, reconciliation: rec.reconciliation, fr_d2, selection_outcome: writtenOutcome, p_star: pStar };
}
