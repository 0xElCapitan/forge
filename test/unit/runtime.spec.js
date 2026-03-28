/**
 * test/unit/runtime.spec.js
 * Tests for the ForgeRuntime theatre lifecycle orchestrator.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ForgeRuntime } from '../../src/runtime/lifecycle.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = 1700000000000;

const THRESHOLD_PROPOSAL = {
  template: 'threshold_gate',
  params: { threshold: 5.0, window_hours: 24, input_mode: 'single', threshold_type: 'statistical', settlement_source: null, base_rate: null },
  confidence: 0.90,
  rationale: 'test rule',
};

const CASCADE_PROPOSAL = {
  template: 'cascade',
  params: { trigger_threshold: 6.0, bucket_count: 5, window_hours: 72, prior_model: 'omori' },
  confidence: 0.85,
  rationale: 'test rule',
};

const DIVERGENCE_PROPOSAL = {
  template: 'divergence',
  params: { source_a_type: 'automatic', source_b_type: 'reviewed', divergence_threshold: null, resolution_mode: 'self-resolving' },
  confidence: 0.80,
  rationale: 'test rule',
};

// ─── Instantiation ───────────────────────────────────────────────────────────

describe('ForgeRuntime — instantiation', () => {
  it('creates theatres from proposals', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    const ids = rt.instantiate([THRESHOLD_PROPOSAL, CASCADE_PROPOSAL], { now: NOW });

    assert.equal(ids.length, 2);
    assert.equal(rt.getStats().theatres_created, 2);

    const t1 = rt.getTheatre(ids[0]);
    assert.equal(t1.template, 'threshold_gate');
    assert.equal(t1.status, 'open');
    assert.equal(t1.created_at, NOW);
    assert.equal(t1.expires_at, NOW + 24 * 3600000);

    const t2 = rt.getTheatre(ids[1]);
    assert.equal(t2.template, 'cascade');
    assert.equal(t2.status, 'open');
  });

  it('skips unknown template types', () => {
    const rt = new ForgeRuntime();
    const ids = rt.instantiate([{ template: 'nonexistent', params: {}, confidence: 0.5, rationale: '' }]);
    assert.equal(ids.length, 0);
    assert.equal(rt.getStats().theatres_created, 0);
  });

  it('attaches runtime metadata to theatres', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    const ids = rt.instantiate([THRESHOLD_PROPOSAL], { feed_id: 'usgs_test' });
    const t = rt.getTheatre(ids[0]);

    assert.equal(t._feed_id, 'usgs_test');
    assert.equal(t._confidence, 0.90);
    assert.equal(t._created_by, 'forge');
  });

  it('getOpenTheatres returns only open theatre IDs', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    const ids = rt.instantiate([THRESHOLD_PROPOSAL, CASCADE_PROPOSAL], { now: NOW });
    const open = rt.getOpenTheatres();

    assert.equal(open.length, 2);
    assert.ok(open.includes(ids[0]));
    assert.ok(open.includes(ids[1]));
  });
});

// ─── Bundle processing ───────────────────────────────────────────────────────

describe('ForgeRuntime — bundle processing', () => {
  it('routes bundles to all open theatres (broadcast)', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    const ids = rt.instantiate([THRESHOLD_PROPOSAL], { now: NOW });

    const result = rt.ingestBundle({
      value: 5.5,
      timestamp: NOW + 1000,
      doubt_price: 0.1,
    });

    assert.equal(result.processed, 1);
    assert.equal(result.rejected, false);
    assert.equal(rt.getStats().bundles_processed, 1);

    // Theatre should have updated position
    const t = rt.getTheatre(ids[0]);
    assert.ok(t.position_history.length > 0);
  });

  it('routes bundles only to specified theatre_refs', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    const ids = rt.instantiate([THRESHOLD_PROPOSAL, CASCADE_PROPOSAL], { now: NOW });

    const result = rt.ingestBundle({
      value: 5.5,
      timestamp: NOW + 1000,
      doubt_price: 0.1,
      theatre_refs: [ids[0]],  // only first theatre
    });

    assert.equal(result.processed, 1);

    const t1 = rt.getTheatre(ids[0]);
    const t2 = rt.getTheatre(ids[1]);
    assert.ok(t1.position_history.length > 0);
    assert.equal(t2.position_history.length, 0);
  });

  it('rejects adversarial bundles (frozen data)', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    rt.instantiate([THRESHOLD_PROPOSAL], { now: NOW });

    const result = rt.ingestBundle({
      value: 5.5,
      timestamp: NOW + 1000,
      frozen_count: 10,
    });

    assert.equal(result.rejected, true);
    assert.ok(result.reason.includes('frozen_data'));
    assert.equal(rt.getStats().bundles_rejected, 1);
    assert.equal(rt.getStats().bundles_processed, 0);
  });

  it('does not process bundles for non-open theatres', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    const ids = rt.instantiate([THRESHOLD_PROPOSAL], { now: NOW });

    // Settle the theatre first
    rt.settle(ids[0], true, { source_id: 'usgs_reviewed' });

    const result = rt.ingestBundle({
      value: 5.5,
      timestamp: NOW + 1000,
    });

    assert.equal(result.processed, 0);
  });
});

// ─── Expiry ──────────────────────────────────────────────────────────────────

describe('ForgeRuntime — expiry', () => {
  it('expires theatres past their window', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    const ids = rt.instantiate([THRESHOLD_PROPOSAL], { now: NOW });

    const pastExpiry = NOW + 25 * 3600000;  // 25 hours (window is 24)
    const expired = rt.checkExpiries({ now: pastExpiry });

    assert.equal(expired.length, 1);
    assert.equal(expired[0], ids[0]);
    assert.equal(rt.getStats().theatres_expired, 1);

    const t = rt.getTheatre(ids[0]);
    assert.equal(t.status, 'expired');
  });

  it('does not expire theatres within their window', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    rt.instantiate([THRESHOLD_PROPOSAL], { now: NOW });

    const withinWindow = NOW + 12 * 3600000;  // 12 hours
    const expired = rt.checkExpiries({ now: withinWindow });

    assert.equal(expired.length, 0);
  });
});

// ─── Settlement ──────────────────────────────────────────────────────────────

describe('ForgeRuntime — settlement', () => {
  it('settles a theatre with T0 source', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    const ids = rt.instantiate([THRESHOLD_PROPOSAL], { now: NOW });

    const result = rt.settle(ids[0], true, { source_id: 'usgs_reviewed' });

    assert.equal(result.settled, true);
    assert.equal(rt.getStats().theatres_resolved, 1);

    const t = rt.getTheatre(ids[0]);
    assert.equal(t.status, 'resolved');
    assert.equal(t.resolution.outcome, true);
  });

  it('settles a theatre with T1 source', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    const ids = rt.instantiate([THRESHOLD_PROPOSAL], { now: NOW });

    const result = rt.settle(ids[0], false, { source_id: 'usgs_automatic' });

    assert.equal(result.settled, true);
  });

  it('rejects settlement from T3 source', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    const ids = rt.instantiate([THRESHOLD_PROPOSAL], { now: NOW });

    const result = rt.settle(ids[0], true, { source_id: 'purpleair' });

    assert.equal(result.settled, false);
    assert.ok(result.reason.includes('T3'));
  });

  it('rejects settlement from T2 source', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    const ids = rt.instantiate([THRESHOLD_PROPOSAL], { now: NOW });

    const result = rt.settle(ids[0], true, { source_id: 'openaq' });

    assert.equal(result.settled, false);
    assert.ok(result.reason.includes('T2'));
  });

  it('rejects settlement on non-open theatre', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    const ids = rt.instantiate([THRESHOLD_PROPOSAL], { now: NOW });

    // Settle once
    rt.settle(ids[0], true, { source_id: 'usgs_reviewed' });

    // Try again
    const result = rt.settle(ids[0], false, { source_id: 'usgs_reviewed' });
    assert.equal(result.settled, false);
    assert.ok(result.reason.includes('not open'));
  });

  it('settles cascade theatre with count outcome', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    const ids = rt.instantiate([CASCADE_PROPOSAL], { now: NOW });

    const result = rt.settle(ids[0], 7, { source_id: 'usgs_reviewed' });

    assert.equal(result.settled, true);
    const t = rt.getTheatre(ids[0]);
    assert.equal(t.status, 'resolved');
    assert.equal(t.resolution.outcome, 7);
    assert.equal(t.resolution.outcome_bucket, 3);  // 6-10 bucket
  });

  // ── Sprint 3: RT-01 fail-closed settlement (CRITICAL fix) ─────────────────
  it('rejects settlement when source_id is omitted (RT-01 fix)', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    const ids = rt.instantiate([THRESHOLD_PROPOSAL], { now: NOW });

    const result = rt.settle(ids[0], true);  // no source_id

    assert.equal(result.settled, false);
    assert.ok(result.reason.includes('source_id is required'));
  });

  it('rejects settlement when source_id is empty string', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    const ids = rt.instantiate([THRESHOLD_PROPOSAL], { now: NOW });

    const result = rt.settle(ids[0], true, { source_id: '' });

    assert.equal(result.settled, false);
    assert.ok(result.reason.includes('source_id is required'));
  });

  it('rejects settlement when source_id is null', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    const ids = rt.instantiate([THRESHOLD_PROPOSAL], { now: NOW });

    const result = rt.settle(ids[0], true, { source_id: null });

    assert.equal(result.settled, false);
    assert.ok(result.reason.includes('source_id is required'));
  });
});

// ─── Certificates ────────────────────────────────────────────────────────────

describe('ForgeRuntime — certificates', () => {
  it('exports certificate on settlement', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    const ids = rt.instantiate([THRESHOLD_PROPOSAL], { now: NOW });

    // Process a bundle to build position history
    rt.ingestBundle({ value: 5.5, timestamp: NOW + 1000, doubt_price: 0.1 });

    // Settle
    rt.settle(ids[0], true, { source_id: 'usgs_reviewed' });

    const certs = rt.getCertificates();
    assert.equal(certs.length, 1);
    assert.equal(certs[0].theatre_id, ids[0]);
    assert.equal(certs[0].template, 'threshold_gate');
    assert.equal(certs[0].outcome, true);
    assert.equal(typeof certs[0].brier_score, 'number');
    assert.ok(certs[0].brier_score >= 0 && certs[0].brier_score <= 1);
  });

  it('flushCertificates clears and returns count', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    const ids = rt.instantiate([THRESHOLD_PROPOSAL], { now: NOW });
    rt.settle(ids[0], true, { source_id: 'usgs_reviewed' });

    assert.equal(rt.getCertificates().length, 1);
    const flushed = rt.flushCertificates();
    assert.equal(flushed, 1);
    assert.equal(rt.getCertificates().length, 0);
  });

  it('getCertificates returns defensive copy', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    const ids = rt.instantiate([THRESHOLD_PROPOSAL], { now: NOW });
    rt.settle(ids[0], true, { source_id: 'usgs_reviewed' });

    const certs1 = rt.getCertificates();
    const certs2 = rt.getCertificates();
    assert.notStrictEqual(certs1, certs2);
    assert.deepEqual(certs1, certs2);
  });
});

// ─── State introspection ─────────────────────────────────────────────────────

describe('ForgeRuntime — getState', () => {
  it('reports correct state breakdown', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });
    const ids = rt.instantiate([THRESHOLD_PROPOSAL, CASCADE_PROPOSAL, DIVERGENCE_PROPOSAL], { now: NOW });

    // Settle one
    rt.settle(ids[0], true, { source_id: 'usgs_reviewed' });

    // Expire one
    rt.checkExpiries({ now: NOW + 100 * 3600000 });

    const state = rt.getState();
    assert.equal(state.theatres.total, 3);
    assert.equal(state.theatres.by_status.resolved, 1);
    assert.ok(state.theatres.by_template.threshold_gate >= 1);
    assert.equal(state.certificates, 1);
  });
});

// ─── Full lifecycle integration ──────────────────────────────────────────────

describe('ForgeRuntime — full lifecycle', () => {
  it('runs proposals → instantiate → process → settle → certificate', () => {
    const rt = new ForgeRuntime({ clock: () => NOW });

    // 1. Instantiate from proposals
    const ids = rt.instantiate([THRESHOLD_PROPOSAL], { now: NOW, feed_id: 'usgs_test' });
    assert.equal(ids.length, 1);

    // 2. Process evidence bundles
    rt.ingestBundle({ value: 4.8, timestamp: NOW + 60000, doubt_price: 0.15 });
    rt.ingestBundle({ value: 5.2, timestamp: NOW + 120000, doubt_price: 0.10 });
    rt.ingestBundle({ value: 5.7, timestamp: NOW + 180000, doubt_price: 0.05 });

    // Verify position updated
    const theatre = rt.getTheatre(ids[0]);
    assert.equal(theatre.position_history.length, 3);
    assert.ok(theatre.position_probability > 0.5);  // crossed threshold

    // 3. Settle
    const result = rt.settle(ids[0], true, {
      source_id: 'usgs_reviewed',
      settlement_class: 'oracle',
    });
    assert.equal(result.settled, true);

    // 4. Verify certificate
    const certs = rt.getCertificates();
    assert.equal(certs.length, 1);
    assert.equal(certs[0].outcome, true);
    assert.equal(certs[0].template, 'threshold_gate');
    assert.ok(certs[0].brier_score < 0.25);  // good forecast (crossed threshold, high prob)
    assert.equal(certs[0].position_history.length, 3);

    // 5. Stats
    const stats = rt.getStats();
    assert.equal(stats.theatres_created, 1);
    assert.equal(stats.theatres_resolved, 1);
    assert.equal(stats.bundles_processed, 3);
    assert.equal(stats.certificates_exported, 1);
  });
});
