/**
 * lab/harness/slice-fixtures.js
 *
 * Cycle-004 S02 (FR-6; SDD DR-2; Sprint Plan §7.2 T2.1). The materialized
 * pre-origin slicer — the F-4 invariant enforcer. It calls the PRODUCTION
 * ingester (`ingestFile`, lab → src import, permitted direction) with the same
 * `timestampBase` later passed to `analyze()`, so the slicer and the production
 * pipeline derive identical timestamps for every record. It never reimplements
 * ingestion, and it never computes a quantile / CI / EI (kernel math lives only
 * in `src/derive/`).
 *
 * Leakage containment is physical: the per-origin slice file handed to
 * `analyze()` contains exactly the raw records whose ingested timestamp is
 * strictly `< training_cutoff_ms`. The purge interval `[training_cutoff_ms,
 * t_k)` and everything at/after `t_k` are not in the file, so ingestion,
 * classification, selection, and the kernel physically cannot see them.
 *
 * This module also owns the shared deterministic atomic-write primitives
 * (temp → flush/close → atomic rename; SDD §8.3.1) reused by `manifests.js`.
 *
 * @module lab/harness/slice-fixtures
 */

import {
  readFileSync, writeFileSync, renameSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync,
} from 'node:fs';
import { dirname } from 'node:path';

import { ingestFile } from '../../src/ingester/generic.js';
import { canonicalize } from '../../src/receipt/canonicalize.js';

// ─── Deterministic atomic writers (SDD §8.3.1; §8.3-d explicit LF) ────────────

let _tmpCounter = 0;

/** Ensure the parent directory of `filePath` exists (recursive). */
export function ensureParentDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

/**
 * Atomically write `text` to `filePath`: write to a temp sibling → fsync →
 * close → atomic rename into place. A crash mid-write never leaves a truncated
 * destination (the previous complete file, or none, survives). `renameSync`
 * replaces an existing destination on both POSIX and Windows.
 *
 * @param {string} filePath
 * @param {string} text - exact bytes to write (caller supplies any trailing LF)
 */
export function writeTextAtomic(filePath, text) {
  ensureParentDir(filePath);
  const tmp = `${filePath}.tmp-${process.pid}-${_tmpCounter++}`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, filePath);
}

/**
 * Atomically write the canonical JSON of `value` (LF-terminated) to `filePath`.
 * Canonicalization (sorted keys, stable array order, no insignificant
 * whitespace) makes the bytes deterministic across runs and platforms.
 *
 * @param {string} filePath
 * @param {*} value - JSON-compatible value
 */
export function writeCanonicalJsonAtomic(filePath, value) {
  writeTextAtomic(filePath, canonicalize(value) + '\n');
}

// ─── Fixture ingestion + F-4 invariant ────────────────────────────────────────

/**
 * Ingest the full fixture once through the production ingester with the run's
 * `timestampBase` (the same base later passed to `analyze()` — F-4).
 *
 * @param {string} fixturePath
 * @param {number} timestampBase
 * @returns {Array<{timestamp:number, value:number, metadata:Object}>} NormalizedEvent[]
 */
export function ingestFixture(fixturePath, timestampBase) {
  if (typeof timestampBase !== 'number' || !Number.isFinite(timestampBase)) {
    throw new TypeError(`ingestFixture: timestampBase must be a finite number, got ${timestampBase}`);
  }
  return ingestFile(fixturePath, { timestampBase });
}

/** Read + JSON.parse the raw fixture array (the records the slice subsets). */
export function readRawFixture(fixturePath) {
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
  return raw;
}

/**
 * Enforce the canonical harness-fixture invariant (SDD DR-2 pt1, F-4) BEFORE
 * any slicing. Any violation is DR-5 invalid input (throw fail-closed) — the
 * run fails before slicing, never produces a partial/leaky slice.
 *
 * Requires: flat array of records; 1:1 raw-record → ingested-event
 * correspondence; every record an object carrying an explicit `timestamp` and
 * exactly one finite numeric `value` field; every ingested event
 * `metadata.ts_source === 'parsed'` (a fallback timestamp is invalid input).
 *
 * @param {Array<Object>} rawArray
 * @param {Array<{timestamp:number, value:number, metadata:Object}>} events
 */
export function assertHarnessFixture(rawArray, events) {
  if (!Array.isArray(rawArray)) {
    throw new TypeError('assertHarnessFixture: fixture must be a flat JSON array');
  }
  if (rawArray.length === 0) {
    throw new Error('assertHarnessFixture: empty fixture (no records)');
  }
  if (!Array.isArray(events) || events.length !== rawArray.length) {
    throw new Error(
      `assertHarnessFixture: 1:1 record→event correspondence broken (raw ${rawArray.length} vs events ${events.length})`,
    );
  }
  for (let i = 0; i < rawArray.length; i++) {
    const rec = rawArray[i];
    if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
      throw new TypeError(`assertHarnessFixture: record ${i} is not a flat object`);
    }
    if (!('timestamp' in rec)) {
      throw new Error(`assertHarnessFixture: record ${i} has no explicit "timestamp" field`);
    }
    if (typeof rec.value !== 'number' || !Number.isFinite(rec.value)) {
      throw new Error(`assertHarnessFixture: record ${i} has no single finite numeric "value" field`);
    }
    const ev = events[i];
    if (!ev || !ev.metadata || ev.metadata.ts_source !== 'parsed') {
      throw new Error(
        `assertHarnessFixture: record ${i} ingested with ts_source="${ev?.metadata?.ts_source}" — a fallback timestamp is invalid harness input (DR-2/DR-5); the run fails before slicing`,
      );
    }
    if (typeof ev.value !== 'number' || !Number.isFinite(ev.value)) {
      throw new Error(`assertHarnessFixture: event ${i} ingested value is not finite`);
    }
  }
}

/**
 * Subset the raw JSON array to records whose ingested timestamp is strictly
 * `< trainingCutoffMs`, preserving original raw-record order. Pure — no I/O.
 *
 * @param {Array<Object>} rawArray
 * @param {Array<{timestamp:number}>} events - 1:1 with rawArray (validated)
 * @param {number} trainingCutoffMs
 * @returns {Array<Object>} the sliced raw records (a new array; elements are the
 *   original record references)
 */
export function sliceRawByTimestamp(rawArray, events, trainingCutoffMs) {
  if (!Number.isInteger(trainingCutoffMs)) {
    throw new TypeError(`sliceRawByTimestamp: trainingCutoffMs must be an integer, got ${trainingCutoffMs}`);
  }
  const out = [];
  for (let i = 0; i < rawArray.length; i++) {
    if (events[i].timestamp < trainingCutoffMs) out.push(rawArray[i]);
  }
  return out;
}

/**
 * The per-origin slice path under the run work directory. The filename carries
 * BOTH boundaries so a slice can never be mistaken for an at-origin cut.
 * (`lab/out/<run_id>/slices/…` — the existing bare `out/` .gitignore rule
 * already ignores it.)
 *
 * @param {string} outRoot - e.g. "lab/out"
 * @param {string} runId
 * @param {number} originMs
 * @param {number} trainingCutoffMs
 * @returns {string}
 */
export function sliceFilePath(outRoot, runId, originMs, trainingCutoffMs) {
  return `${outRoot}/${runId}/slices/origin-${originMs}-train-lt-${trainingCutoffMs}.json`;
}

/**
 * Materialize one per-origin slice from already-loaded + already-validated
 * fixture data. Writes canonical-JSON (LF) atomically. Returns the slice path
 * and the sliced raw array.
 *
 * @param {Object} p
 * @param {Array<Object>} p.rawArray
 * @param {Array<{timestamp:number}>} p.events
 * @param {number} p.originMs
 * @param {number} p.trainingCutoffMs
 * @param {string} p.runId
 * @param {string} [p.outRoot="lab/out"]
 * @returns {{ slicePath:string, slicedRawArray:Array<Object>, n:number }}
 */
export function materializeSliceFromLoaded({ rawArray, events, originMs, trainingCutoffMs, runId, outRoot = 'lab/out' }) {
  const slicedRawArray = sliceRawByTimestamp(rawArray, events, trainingCutoffMs);
  const slicePath = sliceFilePath(outRoot, runId, originMs, trainingCutoffMs);
  writeCanonicalJsonAtomic(slicePath, slicedRawArray);
  return { slicePath, slicedRawArray, n: slicedRawArray.length };
}

/**
 * Convenience full-flow slicer for standalone use / tests: read raw + ingest
 * (production `ingestFile` with the run `timestampBase`), enforce the F-4
 * invariant, subset at `trainingCutoffMs`, write the slice atomically.
 *
 * @param {Object} p
 * @param {string} p.fixturePath
 * @param {number} p.timestampBase
 * @param {number} p.originMs
 * @param {number} p.trainingCutoffMs
 * @param {string} p.runId
 * @param {string} [p.outRoot="lab/out"]
 * @returns {{ slicePath:string, slicedRawArray:Array<Object>, events:Array<Object>, rawArray:Array<Object>, n:number }}
 */
export function materializeSlice({ fixturePath, timestampBase, originMs, trainingCutoffMs, runId, outRoot = 'lab/out' }) {
  const rawArray = readRawFixture(fixturePath);
  const events = ingestFixture(fixturePath, timestampBase);
  assertHarnessFixture(rawArray, events);
  const { slicePath, slicedRawArray, n } = materializeSliceFromLoaded({
    rawArray, events, originMs, trainingCutoffMs, runId, outRoot,
  });
  return { slicePath, slicedRawArray, events, rawArray, n };
}
