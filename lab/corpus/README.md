# Passive corpus record shapes (v0)

Cycle-004 S02 (SDD Lane L4 §6, P12-passive; Sprint Plan §7.1/§7.2 T2.7).

This directory documents the **passive** corpus-record shapes emitted by
`lab/harness/run.js` on every harness run. These are **shapes only** — there is
**no corpus formalization** this cycle.

## Runtime-output policy (R-3 — binding)

- **`README.md` is the only tracked file under `lab/corpus/`.**
- Every runtime corpus record is written **below the run work directory**
  `lab/out/<run_id>/corpus/*.jsonl`, which the existing bare `out/` `.gitignore`
  rule already ignores (`git check-ignore lab/out/…/corpus/x.jsonl → .gitignore:out/`).
- **No runtime execution may leave an untracked `lab/corpus/*.jsonl`.** Runtime
  corpus records are **never** committed. BI-5 self-tests, all lab tests, and
  ledger/corpus tests write to temp directories or under `lab/out/` — never a
  tracked path — so the working tree stays clean before every commit and before
  the freeze.

## Record shapes (minimum fields — Lane L4)

Each record carries a `record_kind` discriminator and is written one JSON object
per line (canonical JSON, explicit `\n`).

| Record | Minimum fields |
|---|---|
| `FeedSnapshotRef` | `feed_id`, `window: {start_ms, end_ms}`, `data_sha256`, `vintage_note: "single-vintage"`, `ingested_at_ms` (from run config) |
| `GrammarStateRecord` | `feed_id`, `feed_profile` (5-dim), `effective_information` (DR-1 triple), `grammar_version`, `classifier_version` |
| `CandidateRecord` | `template`, `params_ref`, `origin: derived \| authored \| baseline`, `record_sha256` — every (family, method, params) considered **including shadows** (exploratory p/W variants) and the transplanted constant |
| `DecisionRecord` | `decision: selected \| rejected`, `reason_code?`, `evidence_ref`, `reconsideration?`, `trials_ledger_ref` |
| `ReplayRecord` | `run_manifest_sha256`, `per_origin_scores_ref` |

## Reserved

- `OutcomeRecord` is **schema-reserved and labelled empty** (partner-gated P13).
  No table, no rows — this comment line is its only presence this cycle. It is
  introduced only when a downstream partner surface (P13) is defined; C-004
  writes nothing under this shape.
