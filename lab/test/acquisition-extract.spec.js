// lab/test/acquisition-extract.spec.js
//
// Cycle-005 S01 (PRD FR-A1/FR-A6; SDD DR-7, §6.4; Sprint Plan T1.8). Per-provider
// extractors against positive / negative / malformed fixtures (FR-A2's "including
// negative and malformed cases"). Only declared metadata fields are extracted; the
// DR-7 documented-equivalence history_years derivation is conservative (365.25d);
// n_observations is null for every flat-file/value-paging provider, exact only for EIA.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractors, historyYearsFromSpan, YEAR_MS, ExtractionError } from '../acquisition/extract.js';

test('DR-7: historyYearsFromSpan is the conservative documented-equivalence (365.25d)', () => {
  const oneYear = YEAR_MS;
  assert.equal(historyYearsFromSpan(0, oneYear), 1);
  assert.ok(historyYearsFromSpan(0, 4 * oneYear) >= 3, '4 years clears the >=3y gate');
  assert.throws(() => historyYearsFromSpan(oneYear, 0), ExtractionError, 'end before start refuses');
});

test('USGS NWIS site catalog (RDB): period-of-record → history_years; n_observations null', () => {
  const rdb = [
    'agency_cd\tsite_no\tstation_nm\tbegin_date\tend_date\tcount_nu',
    '5s\t15s\t50s\t20d\t20d\t8n',
    'USGS\t01646500\tPOTOMAC RIVER\t1990-01-01\t2024-01-01\t1200000',
  ].join('\n');
  const { fields } = extractors['usgs-nwis-site-metadata'](rdb);
  assert.ok(fields.history_years > 33 && fields.history_years < 35, `~34y, got ${fields.history_years}`);
  assert.equal(fields.n_observations, null, 'no lawful count surface → n null (class 3)');
  assert.ok(fields.span && Number.isFinite(fields.span.start_ms));
});

test('USGS RDB with no period columns → ExtractionError', () => {
  const rdb = 'agency_cd\tsite_no\n5s\t15s\nUSGS\t01646500';
  assert.throws(() => extractors['usgs-nwis-site-metadata'](rdb), ExtractionError);
});

test('NOAA CO-OPS station details (JSON): established/period → history_years', () => {
  const j = JSON.stringify({ stations: [{ id: '8594900', established: '1980-01-01', period_end: '2024-01-01' }] });
  const { fields } = extractors['noaa-coops-station-metadata'](j);
  assert.ok(fields.history_years > 43 && fields.history_years < 45, `~44y, got ${fields.history_years}`);
  assert.equal(fields.n_observations, null);
});

test('NOAA CO-OPS malformed JSON → ExtractionError', () => {
  assert.throws(() => extractors['noaa-coops-station-metadata']('{not json'), ExtractionError);
});

test('NWS/ISD station inventory (CSV): BEGIN/END → history_years; n null', () => {
  const csv = [
    'USAF,WBAN,STATION NAME,CTRY,STATE,ICAO,LAT,LON,ELEV(M),BEGIN,END',
    '724050,13743,WASHINGTON DULLES,US,VA,KIAD,38.935,-77.447,88.4,19730101,20240101',
  ].join('\n');
  const { fields } = extractors['nws-isd-station-inventory'](csv);
  assert.ok(fields.history_years > 50 && fields.history_years < 52, `~51y, got ${fields.history_years}`);
  assert.equal(fields.n_observations, null);
});

test('ISD CSV without BEGIN/END → ExtractionError', () => {
  assert.throws(() => extractors['nws-isd-station-inventory']('USAF,WBAN\n724050,13743'), ExtractionError);
});

test('EIA v2 envelope: response.total → exact n_observations (class i); period → history_years', () => {
  const j = JSON.stringify({ response: { total: '87600', startPeriod: '2015-01-01', endPeriod: '2024-01-01' } });
  const { fields, notes } = extractors['eia-electricity-demand-count'](j);
  assert.equal(fields.n_observations, 87600, 'exact count from response.total');
  assert.ok(fields.history_years > 8 && fields.history_years < 10, `~9y, got ${fields.history_years}`);
  assert.match(notes.n_observations, /class-\(i\)/);
});

test('EIA envelope missing total → ExtractionError', () => {
  assert.throws(() => extractors['eia-electricity-demand-count'](JSON.stringify({ response: {} })), ExtractionError);
});

test('EIA total as string vs number both parse to the same integer', () => {
  const a = extractors['eia-electricity-demand-count'](JSON.stringify({ response: { total: '10000' } })).fields.n_observations;
  const b = extractors['eia-electricity-demand-count'](JSON.stringify({ response: { total: 10000 } })).fields.n_observations;
  assert.equal(a, 10000); assert.equal(b, 10000);
});
