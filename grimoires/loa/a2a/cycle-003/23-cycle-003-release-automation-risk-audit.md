# FORGE Cycle-003 — Release-Automation Risk Audit (master landing)

> **State-Zone, gitignored. READ-ONLY AUDIT.** No merge, push, tag, release, package bump,
> Beads mutation, workflow edit, semver-script edit, forge-ewa Retire, fixture deletion, or
> COMPLETED marker was performed. All scripts invoked (`classify-merge-pr.sh`,
> `semver-bump.sh`) are pure-computation and create no git objects (verified). This audit
> resolves the "must-resolve-before-master-push" risk flagged in `22-cycle-003-closeout-prep-master-landing-plan.md` §8.

**Cycle:** 003
**Question:** Would pushing `master` from `715072c3` → `cycle-003-integration @ 52755554` trigger post-merge automation that creates a tag / release / package bump?
**Date:** 2026-07-07
**Method:** full read of `.github/workflows/post-merge.yml` + `scripts/ci/{classify-merge-pr,classify-pr-type,semver-bump}.sh`; actual dry-run of the classifier against the real merge SHA; read-only semver dry-run.

---

## Verdict: ✅ SAFE TO LAND MASTER WITHOUT RELEASE — via **direct fast-forward push only**

A direct `git merge --ff-only` + `git push origin master` fires the workflow, but **every
tag/release/notify job is gated OFF** because the pushed HEAD subject carries no PR number.
**No tag, no release, no package bump** results. ⚠ This safety is **conditional on the
landing method**: a **PR-based merge would NOT be safe** (see §5b) because it populates
`pr_number` and would trigger `simple-release` → tag `v0.5.0`.

---

## 1. Current repo state

| Field | Value |
|-------|-------|
| `cycle-003-integration` / origin | `527555547772430cb0eb362dcb4711ecbf7bd321` (`52755554`) |
| `master` / `origin/master` | `715072c3` |
| `package.json` | `0.4.0` |
| Latest release tag | `v0.4.0` → points at `715072c3` (current master); `v0.3.0` intentionally untagged |
| Cycle commits (`715072c3..52755554`) | 5, linear: `a1ca874e feat`, `91aa63f0 feat`, `668a5553 fix`, `71072440 docs`, `52755554 test` |
| Skip markers in those commits | **none** (`[skip release]` / `[skip ci-release]` / `[no-bump]` all absent) |

## 2. Workflow trigger findings — `.github/workflows/post-merge.yml`

- **Trigger (lines 8–10):** `on: push: branches: [master, main]`. A push to `master` **does**
  fire the workflow. The in-file comment (lines 3–7) explains prior master merges skipped it
  only because the trigger was historically `main`-only — that dormancy is **fixed**; `master`
  now triggers it. **Do not rely on the "prior merges skipped" comment as protection.**
- **Jobs and their gates:**

  | Job | `if` condition | Creates tag/release? |
  |-----|----------------|----------------------|
  | `classify` | (always) | No — pure classification, no side effects |
  | `simple-release` | `pr_type != 'cycle' && pr_number != ''` | **YES** — computes semver + `git tag -a` + `git push origin "$TAG"` (lines 144–159) |
  | `full-pipeline` | `pr_type == 'cycle'` | Possibly — runs `post-merge-orchestrator.sh` (needs `ANTHROPIC_API_KEY`; shell fallback fails on missing `.claude/scripts` + `\|\| true` → no-op) |
  | `notify` | `always() && pr_number != ''` | No — Discord-on-failure only |

- **`pr_number` derivation (`classify-merge-pr.sh`):** the workflow calls
  `classify-merge-pr.sh --merge-sha "$GITHUB_SHA"` (no `--pr-number`). The script resolves the
  subject via `git log -1 --format='%s' <sha>` and extracts `pr_number` **only** by
  `grep -oE '#[0-9]+'` on that subject (line 90). No `#NNN` in the subject ⇒ **`pr_number`
  empty**.
- **`pr_type` derivation (`classify-pr-type.sh`):** `cycle` only if a label contains "cycle",
  or the title matches `\bcycle-[0-9]+\b`, or starts with `Run Mode|Sprint Plan|feat(sprint|feat(cycle`.
  Bare `^feat:` is **deliberately NOT** cycle (lines 38–41). `^fix` → `bugfix`. Else → `other`.

## 3. Semver / release script findings — `scripts/ci/semver-bump.sh`

- **Pure computation, no side effects.** `grep -nE "git (tag|push)"` returns **only comment
  lines** — the script never creates or pushes a tag. Tag creation lives **exclusively** in the
  workflow's `simple-release` "Create tag" step (post-merge.yml:144–159), which is gated as
  above.
- **Skip-marker honor (lines 319–324):** if any commit in `tag_ref..HEAD` body contains
  `[skip release]` / `[skip ci-release]` / `[no-bump]`, it emits `{}` and exits 0 → workflow
  treats empty `.next` as "skip tag". **None of the cycle-003 commits carry a marker.**
- **Bump map:** `feat → minor`, `fix/docs/test/... → patch`, `!`/`BREAKING CHANGE → major`.
  Latest tag = `v0.4.0`; range `v0.4.0..52755554` includes 2 × `feat` ⇒ **minor**.

## 4. Dry-run / source-inspection result

**Classifier, run against the real merge SHA (exactly as the workflow would):**

```
$ bash scripts/ci/classify-merge-pr.sh --merge-sha 527555547772430cb0eb362dcb4711ecbf7bd321
pr_type=other
pr_number=
```

- `pr_number` is **empty** (HEAD subject `test(forge): prove composed trust is not emitted`
  has no `#NNN`; no cycle subject carries one).
- `pr_type=other` (a `test(...)` subject is neither cycle nor bugfix).

**Semver dry-run (read-only; created no tag):**

```
$ bash scripts/ci/semver-bump.sh
{ "current": "0.4.0", "next": "0.5.0", "bump": "minor", "commits": [ … ] }
```

So *if* `simple-release` ever executed on this range it would tag **`v0.5.0`** — but on a
direct FF push it never executes (§5a).

## 5. Expected tag/release/package behavior if master is pushed as-is

### 5a. Direct fast-forward push (`git merge --ff-only` + `git push origin master`) — the §7 plan path

| Job | Evaluated gate | Outcome |
|-----|----------------|---------|
| `classify` | always | runs; emits `pr_type=other`, `pr_number=` (empty); no side effects |
| `simple-release` | `other != 'cycle'` **true** `&&` `'' != ''` **FALSE** → **false** | **SKIPPED** — tag step never runs |
| `full-pipeline` | `other == 'cycle'` → **false** | **SKIPPED** |
| `notify` | `always() && '' != ''` → **false** | **SKIPPED** |

**Result: NO tag, NO GitHub release, NO `package.json` mutation, NO tag push.** `package.json`
stays `0.4.0`; `v0.4.0` remains the latest tag; `master` simply fast-forwards to `52755554`.
The workflow fires and no-ops. ✅ Consistent with the standing "no tag/release/bump" constraint.

### 5b. PR-based merge (create PR `cycle-003-integration` → `master`, then `gh pr merge`) — NOT safe

A merge/squash commit subject like `Merge pull request #N …` or `… (#N)` makes
`grep -oE '#[0-9]+'` populate `pr_number=N`. Then:
- If the PR title/labels are non-cycle (likely, unless titled `cycle-003…` or labeled `cycle`):
  `simple-release` gate becomes `other != 'cycle' (true) && N != '' (true)` → **RUNS** →
  semver `0.5.0` → **creates + pushes tag `v0.5.0`** and PR-comments the release.
- If the PR is titled/labeled cycle: `full-pipeline` runs instead (tag/release via the
  orchestrator **iff** `secrets.ANTHROPIC_API_KEY` is set; otherwise the shell fallback fails
  on missing `.claude/scripts/*` and no-ops).

**A PR-merge landing would therefore likely auto-create `v0.5.0`** — violating the no-release
constraint. Avoid the PR path for this landing.

## 6. Safe mitigation options

| # | Option | System-Zone edit? | Notes |
|---|--------|:-----------------:|-------|
| **A (recommended)** | Land via **direct FF push** (`checkout master` → `merge --ff-only cycle-003-integration` → `push origin master`) | **No** | Gates off all release jobs via empty `pr_number` (§5a). No commit rewrite, no marker, no workflow change. This is already the §7 plan path. |
| B | If a PR is required for visibility, add a `[skip release]` / `[no-bump]` marker to a commit in range | No workflow edit, but **requires a new/extra commit** (changes the FF target — needs approval; no longer a pure FF) | `semver-bump.sh` then emits `{}` and `simple-release` skips the tag step even with a `pr_number`. Do NOT rewrite existing commits without approval. |
| C | Temporarily disable / gate the workflow for the landing push | **Yes — System Zone** (`.github/`) | `.github/` is System Zone → overrides/upstream-PR only, **no ad-hoc edit**. Requires explicit operator approval. Not needed if Option A is used. |
| D | Explicitly authorize the `v0.5.0` auto-release | n/a | A separate release decision (version + release-note claim ceiling). Conflicts with the current "no release" stance unless the operator changes it. |

**No System-Zone edit and no commit rewrite are required** to land safely — Option A suffices.

## 7. Recommendation

**SAFE TO LAND MASTER WITHOUT RELEASE — via the direct fast-forward push path (Option A).**

The §22 closeout-prep flagged the post-merge automation as a must-resolve risk; this audit
**resolves it**: on a direct FF push the classifier emits an empty `pr_number`, which gates
off `simple-release` (the only shell tag-creator) and `full-pipeline` (`pr_type=other`), so
**no tag/release/bump occurs**. The `v0.5.0` computation is real but unreachable on that path.

**Guardrail:** do **not** land via a GitHub PR merge (§5b) — that would populate `pr_number`
and trigger `v0.5.0`. If a PR is desired, use Option B (skip marker, with approval) or Option
D (authorize the release).

## 8. Exact next operator decision needed

1. **Confirm the landing method = direct FF push** (Option A). If yes, no further mitigation
   is required and the §7 master-landing sequence is safe to authorize as written.
2. If you instead want a **PR-based** landing, decide between Option B (`[skip release]` marker
   — needs an extra approved commit) or Option D (authorize `v0.5.0`).
3. Optional hardening (separate, System-Zone, upstream-PR): make `simple-release` also require
   an explicit release intent so a future stray `#NNN`-carrying master push cannot auto-tag.
   Not required for this landing.

## 9. Stop-condition confirmation (read-only audit)

Verified after the audit: no merge · no push · no tag (tag list unchanged; `v0.5.0` does **not**
exist) · no release · no package bump (`package.json` `0.4.0`) · no workflow edit · no semver-
script edit · no Beads mutation · no forge-ewa Retire · no fixture deletion · no COMPLETED
marker. `master` = `715072c3`; `cycle-003-integration` = `52755554`; working tree clean
(only this gitignored report added). The classifier and semver dry-runs created no git objects.
