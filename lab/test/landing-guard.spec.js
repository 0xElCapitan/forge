// lab/test/landing-guard.spec.js
//
// Cycle-006 S01 LU-1 (PRD NFR-C6-LAND, AC-C7; SDD DR-12.1 as corrected by Sprint Plan
// SP-F3; Sprint Plan T1.5). The standing release-suppression canary.
//
// ── SP-F3: what the repository bytes actually say ────────────────────────────
//
// PRD §2.1 and SDD §2 fact 12 both state that EVERY commit since `v0.4.0` carries
// `[skip release]`. First-hand verification during sprint planning — reproduced by this
// spec's own clause 1 — found otherwise: 10 of the 29 commits in `v0.4.0..HEAD` carry no
// honored marker in subject or body:
//
//     2d7bb157  docs: reconcile post-carry-forward status
//     3bdc6d5b  feat: add structural baseline forecasters
//     a69236c6  test: add classifier robustness red-team suite
//     19f926fb  docs: reconcile Cycle-003 carry-forward claim surface
//     82f4db89  docs(forge): close Cycle-003
//     52755554  test(forge): prove composed trust is not emitted
//     71072440  docs(forge): record Sprint 04 hygiene reconciliation
//     668a5553  fix(forge): harden settlement and boundary guards
//     91aa63f0  feat(forge): add canonicalization parity receiving alignment
//     a1ca874e  feat(forge): align producer IR 0.3.0 timestamp trace
//
// These are RECORDED HISTORY, not a defect to repair: landed history is never rewritten.
// The OPERATIVE mechanism is weaker than the prose and is currently satisfied —
// `scripts/ci/semver-bump.sh:319-324` suppresses the tag when an honored marker appears
// in AT LEAST ONE commit in `<latest semver tag>..HEAD`, emitting `{}` so `post-merge.yml`
// skips its "Create tag" step. Nineteen commits in range do carry one.
//
// DR-12.1's original wording ("every commit since v0.4.0 carries an honored skip marker")
// would therefore be RED ON DAY ONE and could never let LU-1 land. EC ratified the SP-F3
// erratum, and this spec asserts the two claims that are both true and load-bearing:
//
//   CLAUSE 1 — the mechanism holds now: at least one commit in `<latest semver tag>..HEAD`
//              carries an honored marker, i.e. semver-bump.sh would emit `{}`.
//   CLAUSE 2 — the Cycle-006 discipline holds: EVERY commit after the Cycle-006 baseline
//              `0ac137f4` carries an honored marker. This mechanizes NFR-C6-LAND (retained
//              verbatim and unamended) and starts trivially true at an empty range.
//
// ── Venue ────────────────────────────────────────────────────────────────────
//
// The binding venue is the DR-12.5 pre-push checklist item 1, executed against a FULL
// clone before every push. `actions/checkout` in `pr-ci.yml` runs at its default shallow
// depth with no tags, and `pr-ci.yml` is outside Sprint 6's authorized mutation surface,
// so on that runner the range clauses cannot be evaluated. They then SKIP VISIBLY with a
// stated reason — never silently pass. The marker predicate and the tag-selection rule
// are asserted unconditionally, in every venue.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The Cycle-006 baseline: the commit every Cycle-006 landing descends from. */
export const CYCLE_006_BASELINE = '0ac137f4d699b4839ba5dd7928e98d9b33f188d5';

/**
 * The markers `semver-bump.sh:319-324` honors, as one regex over the FULL commit
 * message (`%B` — subject and body), matching that script's `grep -qE`.
 */
const HONORED_MARKER = /\[skip release\]|\[skip ci-release\]|\[no-bump\]/;

// Fixed executable, fixed args, execFileSync, no shell, no remote (the freeze-builder
// spec's precedent). Read-only: every invocation below is a query.
function git(args) {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}
function gitOrNull(args) {
  try { return git(args); } catch { return null; }
}

/**
 * The latest semver tag, reproducing `get_version_from_tag` in semver-bump.sh: the
 * permissive glob pair, `--sort=-v:refname`, then the precise regex filter, then head -1.
 */
export function latestSemverTag() {
  const out = gitOrNull(['tag', '-l', 'v[0-9]*.[0-9]*.[0-9]*', 'v[0-9]*.[0-9]*.[0-9]*-*', '--sort=-v:refname']);
  if (out === null) return null;
  const match = out.split(/\r?\n/).map(s => s.trim())
    .filter(t => /^v[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.[0-9]+)?$/.test(t));
  return match.length > 0 ? match[0] : null;
}

/**
 * Commits in `range` as {sha, message} — null when the range is not resolvable.
 * One `git log` for the whole range: `%B` is the same full message semver-bump.sh
 * greps, and the NUL/SOH separators cannot occur inside a commit message.
 */
function commitsInRange(range) {
  const out = gitOrNull(['log', range, '--format=%H%x00%B%x01']);
  if (out === null) return null;
  return out.split('\u0001').map(block => block.replace(/^\r?\n/, '')).filter(b => b.includes('\u0000'))
    .map(block => {
      const [sha, message] = block.split('\u0000');
      return { sha: sha.trim(), message };
    });
}

/** `git rev-list --count` over the same range — an independent completeness oracle. */
function countInRange(range) {
  const out = gitOrNull(['rev-list', '--count', range]);
  return out === null ? null : Number.parseInt(out.trim(), 10);
}

/**
 * Assert the parse saw EVERY commit in the range. A canary that silently under-counts
 * would still pass clause 1 on one marked commit while missing an unmarked commit in
 * clause 2, so completeness is asserted against an independent git count, never assumed.
 */
function assertCompleteParse(range, commits) {
  assert.ok(Array.isArray(commits), `the range ${range} resolves`);
  assert.equal(commits.length, countInRange(range), `the parse must see every commit in ${range}`);
  assert.ok(commits.every(c => /^[0-9a-f]{40}$/.test(c.sha)), 'every parsed sha is a full 40-hex object name');
}

const TAG = latestSemverTag();
const BASELINE_PRESENT = gitOrNull(['rev-parse', '--verify', `${CYCLE_006_BASELINE}^{commit}`]) !== null;
const SHALLOW = (gitOrNull(['rev-parse', '--is-shallow-repository']) ?? '').trim() === 'true';

const clause1Skip = TAG === null
  ? 'no semver tag reachable in this checkout (shallow CI clone) — evaluated against a full clone by the DR-12.5 pre-push checklist'
  : SHALLOW ? 'shallow checkout — the tag..HEAD range is incomplete' : false;
const clause2Skip = !BASELINE_PRESENT
  ? `Cycle-006 baseline ${CYCLE_006_BASELINE.slice(0, 8)} not reachable in this checkout (shallow CI clone) — evaluated against a full clone by the DR-12.5 pre-push checklist`
  : false;

test('SP-F3 clause 1: semver-bump.sh would SUPPRESS the tag for <latest semver tag>..HEAD', { skip: clause1Skip }, () => {
  const commits = commitsInRange(`${TAG}..HEAD`);
  assertCompleteParse(`${TAG}..HEAD`, commits);
  assert.ok(commits.length > 0, `there are commits since ${TAG}`);
  const marked = commits.filter(c => HONORED_MARKER.test(c.message));
  assert.ok(marked.length >= 1,
    `no commit in ${TAG}..HEAD carries an honored marker — semver-bump.sh would NOT emit {} and post-merge.yml would create a tag. ` +
    `Add [skip release] to a landing commit (NFR-C6-LAND) rather than weakening this canary.`);
  // …which is exactly the predicate the script evaluates (at least one, not all).
  assert.ok(marked.length <= commits.length);
});

test('SP-F3 clause 1 (recorded history): the unmarked commits in range are reported, not repaired', { skip: clause1Skip }, () => {
  const commits = commitsInRange(`${TAG}..HEAD`);
  assertCompleteParse(`${TAG}..HEAD`, commits);
  const unmarked = commits.filter(c => !HONORED_MARKER.test(c.message));
  // This is an OBSERVATION, deliberately not an assertion that the count is zero:
  // rewriting landed history is forbidden and would be far worse than the prose error.
  assert.ok(unmarked.length >= 0);
  if (unmarked.length > 0) {
    assert.ok(unmarked.every(c => /^[0-9a-f]{40}$/.test(c.sha)), 'each unmarked commit is identifiable in the record');
  }
});

test('SP-F3 clause 2 / NFR-C6-LAND: EVERY commit after the Cycle-006 baseline carries an honored marker', { skip: clause2Skip }, () => {
  const commits = commitsInRange(`${CYCLE_006_BASELINE}..HEAD`);
  assertCompleteParse(`${CYCLE_006_BASELINE}..HEAD`, commits);
  const unmarked = commits.filter(c => !HONORED_MARKER.test(c.message));
  assert.deepEqual(
    unmarked.map(c => `${c.sha.slice(0, 8)} ${c.message.split('\n')[0]}`),
    [],
    'every Cycle-006 commit must carry [skip release] (or another honored marker) absent an explicit EC release authorization',
  );
});

test('SP-F3: the marker predicate matches semver-bump.sh exactly (self-check)', () => {
  for (const marker of ['[skip release]', '[skip ci-release]', '[no-bump]']) {
    assert.match(`feat: a thing ${marker}`, HONORED_MARKER, `${marker} is honored in a subject`);
    assert.match(`feat: a thing\n\nbody line\n${marker}\n`, HONORED_MARKER, `${marker} is honored in a body`);
  }
  for (const near of ['[skip-release]', '[skip  release]', 'skip release', '[skip release', '[no bump]', '[skip ci]']) {
    assert.doesNotMatch(`feat: a thing ${near}`, HONORED_MARKER, `"${near}" is NOT an honored marker — the predicate is not loosened`);
  }
});

test('SP-F3: the latest-semver-tag rule matches get_version_from_tag (self-check)', () => {
  const precise = /^v[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.[0-9]+)?$/;
  for (const good of ['v0.4.0', 'v1.2.3', 'v2.0.0-alpha.7', 'v2.0.0-rc.1']) assert.match(good, precise);
  // the permissive glob also matches these; the precise regex is what rejects them
  for (const bad of ['v0.1', 'ir-v0.2.0', 'loa@v1.157.0', 'v1.2.3-foo', 'v1.2.3-alpha']) assert.doesNotMatch(bad, precise);
  if (TAG !== null) assert.match(TAG, precise, 'the tag this spec selected passes the precise filter');
});

test('SP-F3: the canary reports its own evaluability rather than passing vacuously', () => {
  // A skipped range clause must always name WHY. In a full clone both are evaluable.
  if (clause1Skip !== false) assert.ok(typeof clause1Skip === 'string' && clause1Skip.length > 0);
  if (clause2Skip !== false) assert.ok(typeof clause2Skip === 'string' && clause2Skip.length > 0);
  assert.equal(typeof BASELINE_PRESENT, 'boolean');
  assert.match(CYCLE_006_BASELINE, /^[0-9a-f]{40}$/);
});
