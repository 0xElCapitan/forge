/**
 * lab/resolution/invariance.js
 *
 * Cycle-005 S01 (PRD FR-D2, §9.1, UD-5/UD-7; SDD DR-5; Sprint Plan T1.6).
 *
 * The FR-D2 outcome-invariance mechanical test — EXACT, fail-closed, no
 * reimplementation. A seal is permitted only when, for every candidate not resolved
 * to §9.1 class 1/2, the frozen rule's primary/reserve/none result is provably
 * unaffected by whichever way that candidate would ultimately resolve.
 *
 * Method (DR-5): enumerate all 2^k assignments of {becomes-eligible,
 * becomes-ineligible} over the k unresolved candidates; run the FROZEN
 * `applySelectionRule` for each branch (stand-ins carry the candidate's real
 * provider/product so gate 5 runs on truth); Tier 1 counts all branches, Tier 2
 * (consulted only if Tier 1 blocks) EXCLUDES the branches the frozen gates themselves
 * prove impossible (an unresolved candidate whose already-fixed authored inputs fail a
 * hard gate in its most-favorable completion). Any throw ⇒ unresolved ⇒ no seal
 * (fail-closed). Self-check: the all-ineligible branch must equal the real
 * resolved-subset run.
 *
 * Eligibility is probed ONLY through `applySelectionRule` (a single-candidate run
 * exposes `evaluations[0].eligible`) — `eligibility.js` is not imported directly (G9).
 *
 * @module lab/resolution/invariance
 */

import { applySelectionRule } from '../census/selection-rule.js';

/** Canonical identity string for a primary/reserve slot (or "none"). */
function slotKey(identity) {
  return identity === null ? 'none' : `${identity.rank}:${identity.provider}:${identity.product}`;
}

/** Outcome key = (primary, reserve) pair — the equality used across branches. */
function outcomeKey(outcome) {
  return `P[${slotKey(outcome.primary)}]|R[${slotKey(outcome.reserve)}]`;
}

/** Run the frozen rule over a candidate array and reduce to the (primary, reserve) outcome. */
function frozenOutcome(candidates, burnedList) {
  const res = applySelectionRule(candidates, burnedList);
  return { primary: res.primary, reserve: res.reserve };
}

/** Is a single candidate eligible under the frozen gates? (probed via applySelectionRule) */
function isEligible(candidate, burnedList) {
  const res = applySelectionRule([candidate], burnedList);
  const ev = res.evaluations.find(e => e.rank === candidate.rank);
  return Boolean(ev && ev.eligible);
}

/** Build the branch candidate array for one 0/1 assignment over the unresolved set. */
function buildBranch(resolved, unresolved, assignmentBits, standIns) {
  const arr = resolved.map(r => ({ rank: r.rank, provider: r.provider, product: r.product, metadata: r.metadata }));
  unresolved.forEach((u, i) => {
    const standIn = assignmentBits[i] ? standIns.eligible : standIns.ineligible;
    arr.push({
      rank: u.rank,
      provider: u.provider,
      product: u.product,
      // Real identity preserved (gate 5 runs on truth); the stand-in supplies the
      // gate-relevant free fields for this hypothetical completion.
      metadata: { ...standIn, provider: u.provider, product: u.product },
    });
  });
  return arr;
}

/**
 * Run the FR-D2 outcome-invariance test. Returns the DR-5.7 record body.
 *
 * @param {Object} p
 * @param {Array<{rank,provider,product,metadata}>} p.resolved - class-1/2 with census aggregates
 * @param {Array<{rank,provider,product,class,fixed_fields?}>} p.unresolved - class-3–6
 * @param {{entries:Array}} p.burnedList - frozen authority
 * @param {{eligible:Object, ineligible:Object}} p.standIns - DR-5 stand-in fixtures (real identity injected here)
 * @returns {Object} the fr_d2 record
 */
export function runInvarianceTest({ resolved, unresolved, burnedList, standIns }) {
  const base = {
    unresolved: unresolved.map(u => ({ rank: u.rank, provider: u.provider, product: u.product, class: u.class })),
    branch_count: 0,
    branches: [],
    tier: null,
    tier2_exclusions: [],
    invariant: false,
    common_outcome: null,
    blocking_candidates: [],
  };
  try {
    const k = unresolved.length;

    // Self-check baseline (DR-5.6): the resolved-only run.
    const realResolvedOutcome = frozenOutcome(
      resolved.map(r => ({ rank: r.rank, provider: r.provider, product: r.product, metadata: r.metadata })),
      burnedList,
    );

    // k = 0: trivially invariant — the outcome is exactly the resolved run.
    if (k === 0) {
      return { ...base, branch_count: 1, tier: 1, invariant: true, common_outcome: realResolvedOutcome };
    }

    // Enumerate all 2^k assignments (DR-5.2). Bit i = 1 → candidate i "becomes-eligible".
    const total = 1 << k;
    const branches = [];
    for (let mask = 0; mask < total; mask++) {
      const bits = unresolved.map((_, i) => Boolean(mask & (1 << i)));
      const arr = buildBranch(resolved, unresolved, bits, standIns);
      const outcome = frozenOutcome(arr, burnedList);
      branches.push({
        assignment: unresolved.map((u, i) => ({ rank: u.rank, becomes_eligible: bits[i] })),
        outcome,
        outcome_key: outcomeKey(outcome),
      });
    }

    // Self-check (DR-5.6): the all-ineligible branch (mask 0) must equal the resolved run.
    const allIneligible = branches[0];
    if (allIneligible.outcome_key !== outcomeKey(realResolvedOutcome)) {
      throw new Error('DR-5.6 self-check failed: all-ineligible branch outcome != real resolved-subset run (spec error, HALT)');
    }

    // Tier 1: unrestricted — every branch counts.
    const tier1Keys = new Set(branches.map(b => b.outcome_key));
    if (tier1Keys.size === 1) {
      return { ...base, branch_count: total, branches, tier: 1, invariant: true, common_outcome: branches[0].outcome };
    }

    // Tier 2 (lawful-completion narrowing): exclude branches proven impossible by the
    // candidate's already-fixed authored inputs. A candidate whose most-favorable
    // completion is STILL ineligible can only ever be ineligible → drop its eligible branches.
    const tier2_exclusions = [];
    const forcedIneligible = unresolved.map((u) => {
      if (!u.fixed_fields || typeof u.fixed_fields !== 'object') return false;
      // Most-favorable completion = the eligible stand-in overlaid with the fixed authored inputs.
      const probe = { rank: u.rank, provider: u.provider, product: u.product, metadata: { ...standIns.eligible, ...u.fixed_fields, provider: u.provider, product: u.product } };
      const eligibleInBestCase = isEligible(probe, burnedList);
      if (!eligibleInBestCase) {
        tier2_exclusions.push({ rank: u.rank, provider: u.provider, product: u.product, reason: 'fixed authored inputs fail a hard gate in the most-favorable completion; "becomes-eligible" branches are lawfully impossible' });
        return true;
      }
      return false;
    });

    const lawfulBranches = branches.filter(b => b.assignment.every((a, i) => !(a.becomes_eligible && forcedIneligible[i])));
    const tier2Keys = new Set(lawfulBranches.map(b => b.outcome_key));
    if (tier2Keys.size === 1 && lawfulBranches.length > 0) {
      return { ...base, branch_count: total, branches, tier: 2, tier2_exclusions, invariant: true, common_outcome: lawfulBranches[0].outcome };
    }

    // Blocked: name the candidates whose branches disagree (feeds AC-B3).
    const blocking = [];
    for (let i = 0; i < k; i++) {
      if (forcedIneligible[i]) continue;
      // A candidate is outcome-relevant if flipping only its bit changes some outcome.
      const changes = lawfulBranches.some((b) => {
        const flipped = lawfulBranches.find(o =>
          o.assignment.length === b.assignment.length &&
          o.assignment.every((a, j) => j === i ? a.becomes_eligible !== b.assignment[j].becomes_eligible : a.becomes_eligible === b.assignment[j].becomes_eligible));
        return flipped && flipped.outcome_key !== b.outcome_key;
      });
      if (changes) blocking.push({ rank: unresolved[i].rank, provider: unresolved[i].provider, product: unresolved[i].product });
    }
    return { ...base, branch_count: total, branches, tier: 2, tier2_exclusions, invariant: false, common_outcome: null, blocking_candidates: blocking };
  } catch (e) {
    // Fail-closed: any throw ⇒ unresolved ⇒ no seal (DR-5.5, FR-D2 final sentence).
    return { ...base, invariant: false, error: e.message, fail_closed: true };
  }
}
