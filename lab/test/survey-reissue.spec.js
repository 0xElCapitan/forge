// lab/test/survey-reissue.spec.js
//
// Cycle-006 S01 Sprint-6 (PRD C6-FR-N4; SDD DR-2.3/2.4/2.5, DR-4.1, DR-4.8; criteria
// §14.3, §14.5, §14.6, §16.1). The revision-1 → revision-2 Gate-P RE-ISSUE surface.
//
// ── Why this file exists ─────────────────────────────────────────────────────
//
// The revision-1 survey procedure defined a surveyable product by a disjunction — "the
// declared root OR its official product/service index" — while declaring no index for any
// portal and giving no rule for choosing a limb when the two exposed different
// granularities. That is not a hard call; it is an under-determined specification, and the
// under-determination was outcome-determining: one reading plausibly clears the pool
// minimum and the other plausibly does not. The halted T2.4 attempt refused to resolve it,
// because choosing a granularity AFTER observing which granularity yields admissions is
// outcome-AWARE selection.
//
// Revision 2 repairs it. These tests prove the repair is mechanical rather than rhetorical:
// one fixed index per portal, one taxonomy rule with one interpretation, a supersession
// that preserves rather than overwrites, an exposure disclosure that is true rather than
// convenient, and a stale authority that cannot authorize the new revision's outputs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256LFNormalized } from '../harness/manifests.js';
import { REFUSAL_REASONS as R, SurveyRefusal } from '../survey/refusal.js';
import { parseCriteriaDocument, criteriaDigest } from '../survey/criteria.js';
import {
  validateGatePRecord, computeGatePRecordId, verifyGatePAuthority, resolveGoverningGatePRecord,
  isReissueRecord, validateOutcomeBlindnessAttestation, PRIOR_EXPOSURE_DISCLOSURE_FIELDS,
  GATE_P_RECORD_REL, GATE_P_RECORD_REL_R2, GATE_P_RECORD_CHAIN, CRITERIA_DOC_REL,
} from '../survey/gate-p.js';
import {
  requireSurveyAuthority, serializeSurveyArtifact,
  readContaminationLedgerState, validateContaminationLedgerPhase, SURVEY_PHASES,
  SURVEY_RECORD_REL_R2, SURVEY_CONTAMINATION_REL_R2, SUCCESSOR_POOL_REL_R2,
} from '../survey/validate.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PREREG_DIR = join(REPO_ROOT, 'lab/preregistration/cycle-006');

const CRITERIA_TEXT = readFileSync(join(PREREG_DIR, 'pool-entry-criteria.md'), 'utf8');
const { block: BLOCK } = parseCriteriaDocument(CRITERIA_TEXT);
const RECORD_1 = JSON.parse(readFileSync(join(REPO_ROOT, GATE_P_RECORD_REL), 'utf8'));
const RECORD_2 = JSON.parse(readFileSync(join(REPO_ROOT, GATE_P_RECORD_REL_R2), 'utf8'));

/** The revision-1 identity, transcribed from the preserved record itself — never a literal. */
const SUPERSEDED_RECORD_ID = RECORD_1.record_id;

function refusesWith(reason, fn, what) {
  try { fn(); } catch (e) {
    assert.ok(e instanceof SurveyRefusal, `${what}: expected a SurveyRefusal, got ${e?.name}`);
    assert.equal(e.reason, reason, `${what}: ${e.message}`);
    return e;
  }
  assert.fail(`${what}: expected a ${reason} refusal, none was thrown`);
}

// ── §1 One fixed enumeration index per portal ────────────────────────────────

test('EC-R2: every portal declares EXACTLY ONE fixed enumeration_index_url', () => {
  const entries = BLOCK.source_universe.entries;
  assert.equal(entries.length, 8, 'eight portals, unchanged by the re-issue');

  const EXPECTED = {
    'nasa-power-api': 'https://power.larc.nasa.gov/docs/services/api/',
    'noaa-coops-web-services': 'https://www.tidesandcurrents.noaa.gov/web_services_info.html',
    'noaa-ndbc-web-data-guide': 'https://www.ndbc.noaa.gov/docs/ndbc_web_data_guide.pdf',
    'usace-cwms-data-api': 'https://cwms-data.usace.army.mil/cwms-data/',
    'usbr-rise': 'https://data.usbr.gov/rise-api',
    'usda-nrcs-awdb': 'https://www.nrcs.usda.gov/programs-initiatives/sswsf-snow-survey-and-water-supply-forecasting-program/snow-and-water-products',
    'usgs-earthquake-catalog-api': 'https://earthquake.usgs.gov/fdsnws/event/1/',
    'usgs-water-data-apis': 'https://api.waterdata.usgs.gov/docs/',
  };

  for (const e of entries) {
    assert.ok(e.portal_id in EXPECTED, `unexpected portal "${e.portal_id}"`);
    assert.equal(e.enumeration_index_url, EXPECTED[e.portal_id], `${e.portal_id}: fixed index`);
    // "Exactly one" is a SHAPE claim: a string, never an array or an alternatives object.
    assert.equal(typeof e.enumeration_index_url, 'string');
  }
  assert.equal(new Set(entries.map(e => e.enumeration_index_url)).size, 8, 'the eight fixed indexes are distinct');

  // The prose table and the machine block agree — the document cannot say two things.
  for (const e of entries) assert.ok(CRITERIA_TEXT.includes(`\`${e.enumeration_index_url}\``), `${e.portal_id}: the index URL appears in the §14.3 table`);

  // The declared_root survives as authority and navigation provenance, distinct from the index.
  const differ = entries.filter(e => e.declared_root !== e.enumeration_index_url);
  assert.equal(differ.length, 3, 'three portals fix an index that is not their declared root');
  assert.match(BLOCK.source_universe.enumeration_index_authority, /sole authority/i);
  assert.match(BLOCK.source_universe.enumeration_index_authority, /navigation provenance/i);
});

test('EC-R2: the portal order and controlling-authority arithmetic are byte-preserved', () => {
  const su = BLOCK.source_universe;
  const portals = su.entries.map(e => e.portal_id);
  assert.deepEqual(portals, [
    'nasa-power-api', 'noaa-coops-web-services', 'noaa-ndbc-web-data-guide', 'usace-cwms-data-api',
    'usbr-rise', 'usda-nrcs-awdb', 'usgs-earthquake-catalog-api', 'usgs-water-data-apis',
  ], 'the declared sweep order is unchanged by the re-issue');
  assert.deepEqual(portals, [...portals].sort(), 'and is still lexicographic portal_id order');

  const authorities = new Set(su.entries.map(e => e.controlling_authority));
  assert.deepEqual([...authorities].sort(), ['NASA', 'NOAA', 'USACE', 'USBR', 'USDA NRCS', 'USGS']);
  assert.equal(BLOCK.pool_bounds.max_pool.value, authorities.size, 'max_pool is still the six-authority ceiling');
  assert.equal(su.growth_policy, 'never grown mid-survey');
});

// ── §2 The product-family definition has ONE mechanical interpretation ───────

test('EC-R2: the product-family definition is a leaf test over the fixed index, not a disjunction', () => {
  const pfd = BLOCK.survey_procedure.product_family_definition;
  assert.ok(pfd, 'the definition exists as a first-class digest-fixed object, not only as step prose');

  // (i) Named leaf API/service, (ii) own stable page/section, (iii) no child API/service.
  assert.match(pfd.rule, /leaf API or machine-readable data service/);
  assert.match(pfd.rule, /own stable provider documentation page or stable provider-authored section/);
  assert.match(pfd.rule, /no child entry in that same official hierarchy that is itself named as an API or service/);
  assert.equal(pfd.inclusion_tests.length, 3, 'three conjunctive inclusion tests, each independently checkable');

  // The revision-1 defect is named, and its disjunction is GONE from the governing rule.
  assert.match(pfd.defect_repaired, /disjunction/);
  assert.doesNotMatch(pfd.rule, /\bor its official product\/service index\b/,
    'the rule no longer offers a choice of discovery source');
  assert.match(pfd.authority, /sole product-family discovery authority/);
  assert.match(pfd.authority, /No substitute index and no alternative interpretation/i);
});

test('EC-R2: a category with documented child services can never become a product family', () => {
  const pfd = BLOCK.survey_procedure.product_family_definition;
  assert.ok(pfd.not_a_product_family.includes('categories or grouping headings'),
    'a category is excluded by enumeration');
  // And by the leaf test, independently — belt and braces, because the exclusion list
  // alone would leave "is this a category?" as a judgment call.
  assert.match(pfd.category_rule, /documented child entry named as an API or service is never a product family/);
  assert.match(pfd.category_rule, /resolves the level without judgment/);
});

test('EC-R2: endpoints and every lower-level resource can never become product families', () => {
  const pfd = BLOCK.survey_procedure.product_family_definition;
  for (const excluded of [
    'endpoints or methods', 'parameters or variables', 'datasets or series',
    'stations, sites, or locations', 'files or formats', 'examples',
    'dashboards, query builders, report generators, widgets, visualizations, or helper tools',
  ]) {
    assert.ok(pfd.not_a_product_family.includes(excluded), `"${excluded}" is excluded by enumeration`);
  }
  assert.equal(pfd.not_a_product_family.length, 8, 'the exclusion list is exactly the eight EC-named classes');
  assert.match(pfd.lower_level_rule, /never a product family, at any level of the hierarchy/);

  // The step-4 prose carries the same eight classes, so the human and machine texts agree.
  const step4 = BLOCK.survey_procedure.steps[3];
  for (const token of ['categories or grouping headings', 'endpoints or methods', 'parameters or variables',
    'datasets or series', 'files or formats', 'query builders', 'report generators', 'visualizations']) {
    assert.ok(step4.includes(token), `step 4 must exclude ${token}`);
  }
});

test('EC-R2: NO admission result may be consulted during family discovery', () => {
  const pfd = BLOCK.survey_procedure.product_family_definition;
  assert.deepEqual(pfd.forbidden_level_selection_inputs,
    ['cadence', 'history', 'admissibility', 'expected yield', 'pool sufficiency'],
    'exactly the five EC-named outcome-aware inputs are foreclosed');
  assert.match(pfd.forbidden_level_selection_rule, /do not use cadence, history, admissibility, expected yield, or pool sufficiency/);
  assert.match(pfd.application_order, /before any admission criterion/);
  assert.match(pfd.application_order, /complete before the first criterion is evaluated/);

  // Ordering is also carried by the steps: discovery (3-5) strictly precedes admission (8-10).
  assert.match(BLOCK.survey_procedure.steps[4], /before applying any admission criterion/);

  // The definition names no criterion, no cadence class, and no band — it cannot be read
  // as a filter dressed up as a taxonomy.
  const pfdText = JSON.stringify(pfd);
  for (const leak of BLOCK.criteria.map(c => c.criterion_id)) {
    assert.ok(!pfdText.includes(leak), `the product-family definition references criterion ${leak}`);
  }
  for (const c of BLOCK.cadence_classes) {
    assert.ok(!pfdText.includes(c.cadence_class), `the product-family definition references cadence class ${c.cadence_class}`);
  }
});

test('EC-R2: a non-unique family set routes to the EXISTING pre-freeze-halt, never to a substitute index', () => {
  const pfd = BLOCK.survey_procedure.product_family_definition;
  assert.match(pfd.non_unique_route, /pre-freeze-halt/);
  assert.match(pfd.non_unique_route, /no substitute index or interpretation may be chosen/i);
  assert.match(BLOCK.survey_procedure.record_obligations.step_12_route, /non-unique/);
  assert.match(BLOCK.survey_procedure.record_obligations.step_12_route, /no new terminal type is created/);
  assert.match(BLOCK.survey_procedure.steps[11], /cannot produce a unique product-family set/);
  assert.match(BLOCK.survey_procedure.steps[11], /do not choose a substitute index/);
});

// ── §3 The re-issue: supersession, disclosure, and no false attestation ──────

test('EC-R2: the re-issue record self-verifies and names the record it supersedes', () => {
  assert.deepEqual(validateGatePRecord(RECORD_2), { valid: true, problems: [] });
  assert.equal(RECORD_2.record_id, computeGatePRecordId(RECORD_2), 'record_id is the SELF-EXCLUDED content address');
  assert.equal(RECORD_2.record_kind, 'gate-p-acceptance');
  assert.equal(RECORD_2.gate, 'P');
  assert.equal(RECORD_2.cycle, 'cycle-006');
  assert.equal(RECORD_2.criteria_revision, 2);
  assert.equal(isReissueRecord(RECORD_2), true);
  assert.equal(isReissueRecord(RECORD_1), false, 'the first issue does not present itself as a re-issue');

  const s = RECORD_2.supersedes;
  assert.equal(s.record_id, SUPERSEDED_RECORD_ID, 'it names the revision-1 record by its own content address');
  assert.equal(s.record_path, GATE_P_RECORD_REL);
  assert.equal(s.preserved, true);
  assert.equal(s.criteria_digest, RECORD_1.criteria_digest);
  assert.equal(s.successor_prereg_digest, RECORD_1.successor_prereg_digest);
  assert.equal(s.derivations_digest, RECORD_1.derivations_digest);
  for (const k of ['criteria_digest', 'successor_prereg_digest', 'derivations_digest']) {
    assert.notEqual(RECORD_2[k], s[k], `${k} must differ across the re-issue — the unit is re-accepted over new bytes`);
  }

  // The invariants EC required to survive the re-issue, read off the governing record.
  assert.equal(RECORD_2.credential_posture, 'uncredentialed-only');
  assert.deepEqual(RECORD_2.pool_bounds, { k_max: 6, max_pool: 6, min_pool_selection_relevant: 3 });
  assert.deepEqual(RECORD_2.refs, RECORD_1.refs, 'the historical refs are byte-identical across the re-issue');
  assert.equal(RECORD_2.source_universe_ref, 'cycle-006-source-universe-2');
  assert.equal(RECORD_2.survey_procedure_ref, 'cycle-006-survey-procedure-2');

  // The record on disk is canonical + LF-terminated, like every one-shot record here.
  assert.equal(readFileSync(join(REPO_ROOT, GATE_P_RECORD_REL_R2), 'utf8'), serializeSurveyArtifact(RECORD_2));
});

test('C6-FR-N4: the re-issue carries NO unqualified no-prior-enumeration attestation', () => {
  assert.equal('no_prior_enumeration_attestation' in RECORD_2, false,
    'copying the first-issue attestation forward would put a false claim on the authority record');
  assert.equal(RECORD_1.no_prior_enumeration_attestation, true, 'the FIRST issue still owes the strict attestation');

  // And the validator enforces both halves, not just the one that happens to hold today.
  const forged = { ...RECORD_2, no_prior_enumeration_attestation: true };
  const problems = validateOutcomeBlindnessAttestation(forged);
  assert.ok(problems.some(p => /must not carry no_prior_enumeration_attestation/.test(p)),
    `a re-issue asserting the unqualified attestation must be rejected: ${problems.join('; ')}`);

  const strippedFirstIssue = { ...RECORD_1 };
  delete strippedFirstIssue.no_prior_enumeration_attestation;
  assert.ok(validateOutcomeBlindnessAttestation(strippedFirstIssue)
    .some(p => /no_prior_enumeration_attestation must be exactly true/.test(p)),
  'an ORIGINAL first-issue record still requires the strict attestation');
});

test('C6-FR-N4: the disclosed prior exposure is complete, bounded, and true to the preserved evidence', () => {
  const d = RECORD_2.prior_exposure_disclosure;

  // Every mandated field is present with its mandated value — no partial disclosure.
  for (const [k, expected] of Object.entries(PRIOR_EXPOSURE_DISCLOSURE_FIELDS)) {
    if (expected === 'text') assert.ok(typeof d[k] === 'string' && d[k].length > 0, `${k} must be disclosed`);
    else assert.equal(d[k], expected, `${k} must be exactly ${expected}`);
  }

  // The ten facts EC required, each mechanically locatable.
  assert.equal(d.occurred, true);
  assert.equal(d.stopped_during_portal, 'nasa-power-api', 'the first attempt stopped during portal 1');
  assert.match(d.exposure_scope, /stopped during portal 1/);
  assert.match(d.exposure_scope, /Portals 2 through 8 were never opened/);
  assert.match(d.documentation_taxonomy_inspected, /NASA POWER documentation taxonomy was inspected/);
  assert.match(d.ambiguity_discovered, /category level and a service level/);
  assert.equal(d.criterion_implications_discussed, true);
  assert.equal(d.canonical_product_family_set_emitted, false);
  assert.equal(d.survey_record_written, false);
  assert.equal(d.candidate_disposition_written, false);
  assert.equal(d.candidate_admitted_rejected_ranked_or_pooled, false);
  assert.equal(d.measured_value_or_provider_api_accessed, false);
  assert.match(d.reissue_rule_basis, /provider-taxonomy/);
  assert.equal(d.complete_re_survey_required, true);
  assert.equal(d.earlier_evidence_preserved, true);
  assert.ok(d.evidence_ref.length > 0, 'the disclosure points at the preserved evidence');

  // The disclosure discloses; it does not smuggle. No product family it saw is named.
  const text = JSON.stringify(d);
  for (const seen of ['Temporal', 'Climatology', 'Hourly', 'Daily', 'Monthly', 'Application', 'System']) {
    assert.ok(!new RegExp(`\\b${seen}\\b`).test(text),
      `the disclosure names a revision-1 product label ("${seen}") — disclosure must not become enumeration`);
  }
});

test('C6-FR-N4: an incomplete or self-serving re-issue disclosure is a TYPED refusal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gatep-reissue-'));
  try {
    const write = (rec) => {
      const p = join(dir, 'rec.json');
      const withId = { ...rec };
      delete withId.record_id;
      withId.record_id = computeGatePRecordId(withId);
      writeFileSync(p, serializeSurveyArtifact(withId));
      return p;
    };
    const critPath = join(dir, 'pool-entry-criteria.md');
    writeFileSync(critPath, readFileSync(join(PREREG_DIR, 'pool-entry-criteria.md')));

    // Baseline: the real re-issue verifies against the real criteria bytes.
    assert.equal(verifyGatePAuthority({ gatePRecordPath: write(RECORD_2), criteriaDocumentPath: critPath }).record_id,
      computeGatePRecordId(RECORD_2));

    // A re-issue that drops the disclosure entirely.
    const noDisclosure = { ...RECORD_2 };
    delete noDisclosure.prior_exposure_disclosure;
    refusesWith(R.GATE_P_REISSUE_DISCLOSURE_INVALID,
      () => verifyGatePAuthority({ gatePRecordPath: write(noDisclosure), criteriaDocumentPath: critPath }),
      'a re-issue with no disclosure');

    // A re-issue that claims nothing needs restarting.
    const noRestart = { ...RECORD_2, prior_exposure_disclosure: { ...RECORD_2.prior_exposure_disclosure, complete_re_survey_required: false } };
    refusesWith(R.GATE_P_REISSUE_DISCLOSURE_INVALID,
      () => verifyGatePAuthority({ gatePRecordPath: write(noRestart), criteriaDocumentPath: critPath }),
      'a re-issue that does not require a restart');

    // A re-issue that quietly admits a candidate disposition occurred is not thereby
    // lawful — the attestation is FIXED at false, so the record cannot be used to
    // launder one. (The lawful response to a real disposition is HALT, not a re-issue.)
    const admits = { ...RECORD_2, prior_exposure_disclosure: { ...RECORD_2.prior_exposure_disclosure, candidate_admitted_rejected_ranked_or_pooled: true } };
    refusesWith(R.GATE_P_REISSUE_DISCLOSURE_INVALID,
      () => verifyGatePAuthority({ gatePRecordPath: write(admits), criteriaDocumentPath: critPath }),
      'a re-issue over a real candidate disposition');

    // A re-issue that does not preserve its predecessor.
    const notPreserved = { ...RECORD_2, supersedes: { ...RECORD_2.supersedes, preserved: false } };
    refusesWith(R.GATE_P_REISSUE_DISCLOSURE_INVALID,
      () => verifyGatePAuthority({ gatePRecordPath: write(notPreserved), criteriaDocumentPath: critPath }),
      'a re-issue that does not preserve the superseded record');

    // A re-issue that supersedes itself, or re-accepts the same bytes, is circular.
    const selfSuperseding = { ...RECORD_2, supersedes: { ...RECORD_2.supersedes, criteria_digest: RECORD_2.criteria_digest } };
    assert.ok(validateOutcomeBlindnessAttestation(selfSuperseding)
      .some(p => /must accept different bytes/.test(p)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── §4 Stale authority cannot authorize revision-2 outputs ───────────────────

test('DR-2.5: the GOVERNING record is the newest chain link, and the superseded one is preserved', () => {
  assert.deepEqual([...GATE_P_RECORD_CHAIN], [GATE_P_RECORD_REL, GATE_P_RECORD_REL_R2],
    'the chain is issue-ordered; the last existing link governs');

  const gov = resolveGoverningGatePRecord({ repoRoot: REPO_ROOT });
  assert.equal(gov.rel, GATE_P_RECORD_REL_R2);
  assert.deepEqual(gov.superseded, [GATE_P_RECORD_REL]);
  assert.equal(existsSync(join(REPO_ROOT, GATE_P_RECORD_REL)), true, 'the superseded record is still on disk');

  const auth = requireSurveyAuthority({ repoRoot: REPO_ROOT });
  assert.equal(auth.gate_p_record_rel, GATE_P_RECORD_REL_R2, 'the production path routes through the re-issue');
  assert.equal(auth.gate_p_record_id, RECORD_2.record_id);
  assert.equal(auth.criteria.revision, 2);
  assert.equal(auth.criteria_digest, criteriaDigest(readFileSync(join(PREREG_DIR, 'pool-entry-criteria.md'))));
});

test('DR-2.5: the STALE revision-1 record refuses — it cannot authorize a revision-2 survey output', () => {
  // It is still a structurally valid record. That is the point: preservation does not
  // mean re-authorization, and a record that still self-verifies is exactly the case
  // where a digest gate has to be the thing that says no.
  assert.deepEqual(validateGatePRecord(RECORD_1), { valid: true, problems: [] });
  assert.equal(RECORD_1.record_id, computeGatePRecordId(RECORD_1));

  const e = refusesWith(R.GATE_P_CRITERIA_DIGEST_MISMATCH, () => verifyGatePAuthority({
    gatePRecordPath: join(REPO_ROOT, GATE_P_RECORD_REL),
    criteriaDocumentPath: join(REPO_ROOT, CRITERIA_DOC_REL),
  }), 'the superseded revision-1 record');
  assert.equal(e.detail.accepted, RECORD_1.criteria_digest);
  assert.equal(e.detail.on_disk, RECORD_2.criteria_digest);
  assert.match(e.message, /full re-issue/);
});

// ── §5 The revision-2 contamination ledger: required at start, absent now ────

test('DR-4.8: the revision-2 outputs are declared, and NONE exists at this node', () => {
  assert.equal(SURVEY_RECORD_REL_R2, 'lab/preregistration/cycle-006/survey-record-r2.json');
  assert.equal(SURVEY_CONTAMINATION_REL_R2, 'lab/preregistration/cycle-006/survey-contamination-r2.jsonl');
  assert.equal(SUCCESSOR_POOL_REL_R2, 'lab/preregistration/cycle-006/successor-pool-r2.json');

  const declared = BLOCK.survey_procedure.revision_outputs;
  assert.equal(declared.survey_record, SURVEY_RECORD_REL_R2);
  assert.equal(declared.contamination_ledger, SURVEY_CONTAMINATION_REL_R2);
  assert.equal(declared.successor_pool, SUCCESSOR_POOL_REL_R2);
  assert.match(declared.complete_re_survey, /complete re-survey from portal 1 is mandatory/);
  assert.match(declared.superseded_outputs_preserved, /never edited or deleted/);

  // The governing record names the same three paths — criteria and authority agree.
  assert.equal(RECORD_2.required_outputs.survey_record, SURVEY_RECORD_REL_R2);
  assert.equal(RECORD_2.required_outputs.contamination_ledger, SURVEY_CONTAMINATION_REL_R2);
  assert.equal(RECORD_2.required_outputs.successor_pool, SUCCESSOR_POOL_REL_R2);

  // The revision-2 survey STARTED and halted mid-sweep, so the three declared outputs are
  // no longer in the same state. The contamination ledger exists — created at exactly
  // 0 bytes at the authorized start, before the first documentation read — while the two
  // completion artifacts were never produced and must stay strictly absent.
  const ledger = join(REPO_ROOT, SURVEY_CONTAMINATION_REL_R2);
  assert.equal(existsSync(ledger), true, `${SURVEY_CONTAMINATION_REL_R2} exists — the revision-2 survey began`);
  assert.equal(statSync(ledger).size, 0, 'and is retained at exactly 0 bytes — no contamination event was recorded');
  for (const rel of [SURVEY_RECORD_REL_R2, SUCCESSOR_POOL_REL_R2]) {
    assert.equal(existsSync(join(REPO_ROOT, rel)), false, `${rel} must not exist — the revision-2 survey did not complete`);
  }
});

test('DR-4.8: the contamination ledger is PHASE-governed — absent now, 0 bytes at start, retained when clean', () => {
  const live = readContaminationLedgerState({ repoRoot: REPO_ROOT });
  assert.deepEqual([live.exists, live.size, live.typed_event_count, live.untyped_lines], [true, 0, 0, 0],
    'the revision-2 ledger exists at exactly 0 bytes with no event of any kind');
  assert.deepEqual(validateContaminationLedgerPhase({ phase: SURVEY_PHASES.SURVEY_STARTED, ledger: live }),
    { valid: true, problems: [] }, 'a 0-byte ledger is the lawful survey-started state');
  assert.equal(validateContaminationLedgerPhase({ phase: SURVEY_PHASES.PRE_AUTHORIZATION, ledger: live }).valid, false,
    'and it is no longer pre-authorization — the ledger existing is mechanical proof the survey began');

  const absent = { exists: false, size: 0, typed_event_count: 0, untyped_lines: 0 };
  const empty = { exists: true, size: 0, typed_event_count: 0, untyped_lines: 0 };
  const oneEvent = { exists: true, size: 84, typed_event_count: 1, untyped_lines: 0 };

  // (1) Before authorization: present is a defect.
  const early = validateContaminationLedgerPhase({ phase: SURVEY_PHASES.PRE_AUTHORIZATION, ledger: empty });
  assert.equal(early.valid, false);
  assert.match(early.problems[0], /must not exist before the survey is authorized/);

  // (2) After authorized start: 0 bytes is lawful; ABSENT is not — lazy creation is rejected.
  assert.equal(validateContaminationLedgerPhase({ phase: SURVEY_PHASES.SURVEY_STARTED, ledger: empty }).valid, true);
  const lazy = validateContaminationLedgerPhase({ phase: SURVEY_PHASES.SURVEY_STARTED, ledger: absent });
  assert.equal(lazy.valid, false);
  assert.match(lazy.problems[0], /lazy first-exposure creation is not adopted/);

  // (3) A clean completed survey RETAINS the 0-byte ledger.
  assert.equal(validateContaminationLedgerPhase({ phase: SURVEY_PHASES.SURVEY_COMPLETE, ledger: empty }).valid, true);
  assert.equal(validateContaminationLedgerPhase({ phase: SURVEY_PHASES.SURVEY_COMPLETE, ledger: absent }).valid, false,
    'an absent ledger after a survey is a defect, not a clean result');

  // (4) Contamination appends only typed events.
  assert.equal(validateContaminationLedgerPhase({ phase: SURVEY_PHASES.SURVEY_COMPLETE, ledger: oneEvent }).valid, true);
  const junk = validateContaminationLedgerPhase({ phase: SURVEY_PHASES.SURVEY_STARTED, ledger: { exists: true, size: 12, typed_event_count: 0, untyped_lines: 1 } });
  assert.equal(junk.valid, false);
  assert.ok(junk.problems.some(p => /not a typed event object/.test(p)));
  assert.ok(junk.problems.some(p => /carries no typed contamination event/.test(p)));

  // An unknown phase is a refusal, not a silent pass — no fail-open on a typo.
  assert.equal(validateContaminationLedgerPhase({ phase: 'whenever', ledger: empty }).valid, false);
});

test('DR-4.8: the ledger reader counts typed events off real bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'contam-'));
  try {
    const rel = join(dir, SURVEY_CONTAMINATION_REL_R2);
    // Absent.
    assert.equal(readContaminationLedgerState({ repoRoot: dir }).exists, false);

    // 0 bytes.
    mkdirSync(join(dir, 'lab/preregistration/cycle-006'), { recursive: true });
    writeFileSync(rel, '');
    let st = readContaminationLedgerState({ repoRoot: dir });
    assert.deepEqual([st.exists, st.size, st.typed_event_count, st.untyped_lines], [true, 0, 0, 0]);
    assert.equal(validateContaminationLedgerPhase({ phase: SURVEY_PHASES.SURVEY_COMPLETE, ledger: st }).valid, true);

    // Two typed events + one untyped line.
    writeFileSync(rel, '{"a":1}\n{"b":2}\nnot json\n');
    st = readContaminationLedgerState({ repoRoot: dir });
    assert.equal(st.typed_event_count, 2);
    assert.equal(st.untyped_lines, 1);
    assert.equal(validateContaminationLedgerPhase({ phase: SURVEY_PHASES.SURVEY_COMPLETE, ledger: st }).valid, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── §6 The re-issue changed the rule and NOTHING numeric ─────────────────────

test('EC-R2: the re-issue changed no measured value and no binding arithmetic', () => {
  const ws = JSON.parse(readFileSync(join(PREREG_DIR, 'criteria-derivations.json'), 'utf8'));
  assert.equal(ws.revision, 2);
  const p = ws.reissue_provenance;
  assert.equal(p.revision, 2);
  assert.equal(p.superseded_worksheet_digest, RECORD_1.derivations_digest,
    'the worksheet names the exact revision-1 bytes the first Gate-P record accepted');
  assert.equal(p.superseded_gate_p_record_id, SUPERSEDED_RECORD_ID);
  assert.equal(p.superseded_gate_p_record_preserved, true);
  assert.equal(p.measured_values_changed, false);
  assert.equal(p.binding_arithmetic_changed, false);
  assert.equal(p.frozen_inputs_changed, false);
  assert.equal(p.ci_legs_changed, false);
  assert.deepEqual(p.changed_fields, ['revision', 'reissue_provenance'],
    'exactly two provenance fields were added to the worksheet');

  // The claim is checkable, not merely asserted: strip the two added fields and the
  // worksheet must be deep-equal to a worksheet with no re-issue surface at all.
  const stripped = { ...ws };
  delete stripped.revision;
  delete stripped.reissue_provenance;
  assert.deepEqual(Object.keys(stripped), [
    'record_kind', 'schema_version', 'cycle', 'constants', 'dispatch_provenance',
    'cadence_history_envelope', 'operator_reserved_values', 'known_discrepancies', 'artifact_validation',
  ], 'no key beyond the two provenance fields was added, moved, or removed');

  // The invariants EC pinned, read straight off the governing criteria block.
  assert.equal(BLOCK.pool_bounds.min_pool_selection_relevant.value, 3);
  assert.equal(BLOCK.pool_bounds.max_pool.value, 6);
  assert.equal(BLOCK.fr_d2_bounds.k_max.value, 6);
  assert.equal(BLOCK.fr_d2_bounds.probe_budget.value, 20);
  assert.equal(BLOCK.fr_d2_bounds.n_ceiling.value, 24120603015);
  assert.equal(BLOCK.fr_d2_bounds.corroboration_budget.value, 1000);
  assert.equal(BLOCK.credential_posture.posture, 'uncredentialed-only');
  assert.deepEqual(BLOCK.rank_function.sort_keys.map(k => k.attribute),
    ['count_surface_class', 'cadence_obs_interval_seconds', 'history_band_margin_days']);
  assert.deepEqual(BLOCK.cadence_classes.filter(c => c.admissible).map(c => c.cadence_class),
    ['c900', 'c3600', 'c21600', 'c86400']);
});

// ── §7 The operator-act timestamp: the genuine EC event, not the materialization clock ──

test('T2.3a-R2: the record-2 operator-act timestamp is the genuine EC authorization event', () => {
  const at = RECORD_2.at;
  assert.match(at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'ISO-8601 UTC with millisecond precision');
  assert.equal(new Date(at).toISOString(), at, 'the instant round-trips exactly — no placeholder, no truncation');

  const actMs = Date.parse(at);
  assert.ok(Number.isFinite(actMs));
  assert.ok(actMs < Date.now(), 'the operator act precedes every later read of this record');
  assert.ok(actMs > Date.parse('2026-07-26T00:00:00.000Z'),
    'the act is not back-dated behind the LU-2A tree it accepts');

  // The exact user-message-event instant recovered from the durable session transcript —
  // the EC dispatch that carried the final Revision-2 decisions (product-family rule, all
  // eight enumeration_index_url values, the reissue instruction, the disclosure requirement,
  // the contamination-ledger phase decision) — never the queue-enqueue instant that precedes
  // it and never a `new Date().toISOString()` read taken at materialization time.
  assert.equal(at, '2026-07-28T06:25:57.747Z', 'the genuine EC-dispatch operator-act instant');
  assert.notEqual(at, '2026-07-28T06:42:38.023Z',
    'must NOT be the materialization-clock read the R2 independent review found (Δ 16m40s from the operator act)');

  // record_id is the self-excluded content address of the record CARRYING the corrected `at`.
  assert.equal(RECORD_2.record_id, computeGatePRecordId(RECORD_2));
  assert.equal(readFileSync(join(REPO_ROOT, GATE_P_RECORD_REL_R2), 'utf8'), serializeSurveyArtifact(RECORD_2));

  // Preservation: the revision-1 timestamp and its own dedicated test remain untouched —
  // this is a record-2-only correction, verified independently of record 1.
  assert.equal(RECORD_1.at, '2026-07-27T22:29:39.457Z');
  assert.equal(RECORD_1.record_id, computeGatePRecordId(RECORD_1));
});

// ── §8 The first-issue/re-issue attestation cross-shape must fail closed ─────

test('C6-FR-N4: a disclosure-without-supersedes-plus-first-issue-attestation cross-shape refuses at every boundary', () => {
  // Constructed from the live, corrected record 2: strip `supersedes`, add back the
  // unqualified first-issue attestation. This is the exact fail-open the R2 independent
  // review found — no named predecessor, no `preserved: true`, no different-bytes check —
  // while simultaneously attesting no prior enumeration occurred AND disclosing that one did.
  const hybrid = { ...RECORD_2, no_prior_enumeration_attestation: true };
  delete hybrid.supersedes;
  delete hybrid.record_id;
  hybrid.record_id = computeGatePRecordId(hybrid);

  assert.equal(isReissueRecord(hybrid), false,
    'no supersedes — the record elects the first-issue branch by omission alone');

  // (1) The shape-level rule, in isolation.
  const shapeProblems = validateOutcomeBlindnessAttestation(hybrid);
  assert.ok(shapeProblems.some(p => /must not carry prior_exposure_disclosure/.test(p)),
    `a first-issue-shaped record carrying a disclosure must be rejected: ${shapeProblems.join('; ')}`);

  // (2) validateGatePRecord — the pure, no-I/O gate.
  const { valid, problems } = validateGatePRecord(hybrid);
  assert.equal(valid, false);
  assert.ok(problems.some(p => /must not carry prior_exposure_disclosure/.test(p)));

  const dir = mkdtempSync(join(tmpdir(), 'gatep-hybrid-'));
  try {
    // (3) verifyGatePAuthority — the earliest lawful boundary a persisted record passes
    // through. A typed refusal, never an untyped throw and never a silent accept.
    const critPath = join(dir, 'pool-entry-criteria.md');
    writeFileSync(critPath, readFileSync(join(PREREG_DIR, 'pool-entry-criteria.md')));
    const recPath = join(dir, 'hybrid.json');
    writeFileSync(recPath, serializeSurveyArtifact(hybrid));
    const e = refusesWith(R.GATE_P_RECORD_INVALID,
      () => verifyGatePAuthority({ gatePRecordPath: recPath, criteriaDocumentPath: critPath }),
      'the disclosure-without-supersedes/first-issue-attestation hybrid');
    assert.match(e.message, /failed validation/);

    // (4) resolveGoverningGatePRecord + requireSurveyAuthority — the hybrid cannot become
    // governing authority even when it is placed as the newest (and only) existing chain
    // link, mirroring how a future re-issue attempt would actually reach the repository.
    mkdirSync(join(dir, 'lab/preregistration/cycle-006'), { recursive: true });
    mkdirSync(join(dir, 'lab/evidence/cycle-006'), { recursive: true });
    writeFileSync(join(dir, CRITERIA_DOC_REL), readFileSync(join(PREREG_DIR, 'pool-entry-criteria.md')));
    writeFileSync(join(dir, GATE_P_RECORD_REL_R2), serializeSurveyArtifact(hybrid));

    const gov = resolveGoverningGatePRecord({ repoRoot: dir });
    assert.equal(gov.rel, GATE_P_RECORD_REL_R2, 'the hybrid is the newest — and only — existing chain link');

    refusesWith(R.GATE_P_RECORD_INVALID,
      () => requireSurveyAuthority({ repoRoot: dir }),
      'requireSurveyAuthority over a tree whose only Gate-P record is the hybrid');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // The real, governing record-2 on disk is NOT this shape, and remains lawful.
  assert.equal(isReissueRecord(RECORD_2), true);
  assert.deepEqual(validateGatePRecord(RECORD_2), { valid: true, problems: [] });
});

test('EC-R2: the criteria block records the supersession, and the ledgers are untouched', () => {
  const s = BLOCK.supersedes;
  assert.equal(s.criteria_digest, RECORD_1.criteria_digest);
  assert.equal(s.gate_p_record_id, SUPERSEDED_RECORD_ID);
  assert.equal(s.gate_p_record_path, GATE_P_RECORD_REL);
  assert.equal(s.gate_p_record_preserved, true);
  assert.match(s.basis, /provider taxonomy/);
  assert.match(s.survey_consequence, /complete re-survey from portal 1/);

  // The re-issue is a documentation act. It moved no scientific byte.
  assert.equal(sha256LFNormalized(readFileSync(join(REPO_ROOT, 'lab/ledgers/trials-ledger.jsonl'))),
    'sha256:e0e30b3d20f4a81cd36d686ccbbb8dd8d34212a9410673ecc727b91e581f2422');
  assert.equal(readFileSync(join(REPO_ROOT, 'lab/ledgers/burn-ledger.jsonl')).length, 0);
});
