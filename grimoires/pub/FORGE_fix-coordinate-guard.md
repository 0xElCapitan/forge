# FORGE — Fix: Coordinate False-Positive on Bounded 0-1 Data

> Agent prompt. One fix, one file changed, tests added, convergence verified.

---

## Context

FORGE's ingester uses structural heuristics to detect geographic coordinates in feed data. The `findCoordinates()` function in `src/ingester/generic.js` looks for numeric field pairs where one value falls in [-90, 90] (latitude range) and the other in [-180, 180] (longitude range).

**The bug:** Polymarket prediction market data has `yes_price` and `no_price` fields with values between 0 and 1. Both values fall within the latitude AND longitude ranges, so `findCoordinates()` returns a false positive — it thinks market prices are geographic coordinates. This cascades into Q4 density classifier producing `sparse_network` instead of `single_point`, which produces wrong template proposals.

**This was discovered during a diagnostic pass** running real Polymarket fixtures (committed by Tobias at `f081b16d`) through `forge.analyze()`. The diagnostic confirmed:
- Q2 distribution classifier correctly handles 0-1 data as `bounded_numeric`
- Q4 density classifier correctly falls through to `single_point` when `has_coords: false`
- The anonymizer is value-agnostic and safe for market data
- But the coordinate false-positive in the ingester breaks the chain before the classifier even sees the data correctly

**This is not just a Polymarket problem.** Any future feed with small bounded numeric values (normalized indices, percentages expressed as decimals, probability scores) would hit the same false positive.

## The fix

Add a guard clause in `findCoordinates()` in `src/ingester/generic.js` that rejects coordinate candidates when both values fall within [0, 1]. Physical geographic coordinates virtually never have both latitude and longitude in that range (it would mean a location in the Gulf of Guinea at 0°-1°N, 0°-1°E — not impossible but astronomically unlikely for real sensor data, and never for a sensor network).

### Where to put the guard

In `findCoordinates()`, after the lat/lon candidate values are selected but BEFORE the existing return block:

```js
// Guard: reject bounded probability pairs (prediction markets, normalized indices)
// If both candidate values are in [0, 1], they are almost certainly not coordinates.
if (latVal >= 0 && latVal <= 1 && lonVal >= 0 && lonVal <= 1) {
  return null;
}
```

This goes immediately before the existing:
```js
if (Math.abs(lonVal) > 90 || Math.abs(latVal) <= 90) {
  return { latField, lonField, lat: latVal, lon: lonVal };
}
```

### What NOT to change

- Do not modify any other function in `generic.js`
- Do not modify the classifier, selector, or any other module
- Do not change how `findValueField()` works (that's a separate, larger issue for cycle-003)
- Do not add Polymarket-specific logic anywhere — this guard is domain-agnostic

## Tests to add

Add these tests to `test/unit/ingester.spec.js`. If an ingester describe block already exists, add to it. If not, create one.

### Test 1: Rejects 0-1 bounded probability pairs as coordinates
```js
test('rejects 0-1 bounded probability pairs as coordinates', () => {
  const marketFixture = [
    { market_id: "0x1A", yes_price: 0.65, no_price: 0.35, volume: 1500000 },
    { market_id: "0x1B", yes_price: 0.92, no_price: 0.08, volume: 420000 }
  ];
  const events = ingest(marketFixture);
  for (const event of events) {
    assert.strictEqual(event.metadata.has_coords, false,
      'Falsely flagged bounded 0-1 prices as geographic coordinates');
  }
});
```

### Test 2: Rejects exact boundary values 0.0 and 1.0 (resolved market prices)
```js
test('rejects exact 0 and 1 values as coordinates (resolved market)', () => {
  const resolvedFixture = [
    { outcome: "yes", price: 1.0, volume: 500000 },
    { outcome: "no", price: 0.0, volume: 500000 }
  ];
  const events = ingest(resolvedFixture);
  for (const event of events) {
    assert.strictEqual(event.metadata.has_coords, false,
      'Falsely flagged 0/1 resolved prices as coordinates');
  }
});
```

### Test 3: Rejects small normalized index pairs (not just market data)
```js
test('rejects small normalized index pairs as coordinates', () => {
  const normalizedFixture = [
    { sensor: "A", confidence: 0.88, score: 0.72, reading: 42 },
    { sensor: "B", confidence: 0.55, score: 0.91, reading: 67 }
  ];
  const events = ingest(normalizedFixture);
  for (const event of events) {
    assert.strictEqual(event.metadata.has_coords, false,
      'Falsely flagged normalized 0-1 scores as coordinates');
  }
});
```

### Test 4: Allows valid physical coordinates where one value exceeds 1
```js
test('allows coordinates where one value exceeds 1', () => {
  const sensorFixture = [
    { id: "s1", reading_a: 0.5, reading_b: 34.05, value: 100 },
    { id: "s2", reading_a: 0.8, reading_b: -118.24, value: 200 }
  ];
  const events = ingest(sensorFixture);
  for (const event of events) {
    assert.strictEqual(event.metadata.has_coords, true,
      'Failed to detect coordinates when one value is outside [0,1]');
  }
});
```

### Test 5: Allows valid large-magnitude coordinate pairs (standard seismic)
```js
test('allows standard large-magnitude coordinate pairs', () => {
  const seismicFixture = [
    { id: "eq1", lat: 34.0522, lon: -118.2437, mag: 4.5 },
    { id: "eq2", lat: 36.7783, lon: -119.4179, mag: 3.2 }
  ];
  const events = ingest(seismicFixture);
  for (const event of events) {
    assert.strictEqual(event.metadata.has_coords, true,
      'Failed to detect standard geographic coordinates');
  }
});
```

### Test 6: Allows negative coordinate pairs (southern/western hemisphere)
```js
test('allows negative coordinate pairs (southern/western hemisphere)', () => {
  const southernFixture = [
    { id: "s1", pos_a: -33.87, pos_b: 151.21, reading: 5.0 },
    { id: "s2", pos_a: -22.91, pos_b: -43.17, reading: 3.1 }
  ];
  const events = ingest(southernFixture);
  for (const event of events) {
    assert.strictEqual(event.metadata.has_coords, true,
      'Failed to detect negative-value coordinate pairs');
  }
});
```

### Test 7: Rejects all-zero pair as coordinates
```js
test('rejects all-zero numeric pair as coordinates', () => {
  const zeroFixture = [
    { id: "z1", field_a: 0, field_b: 0, reading: 99 },
    { id: "z2", field_a: 0.0, field_b: 0.0, reading: 101 }
  ];
  const events = ingest(zeroFixture);
  for (const event of events) {
    assert.strictEqual(event.metadata.has_coords, false,
      'Falsely flagged zero-value pair as coordinates');
  }
});
```

### Test 8: Handles single-field events (no pair to form coordinates)
```js
test('handles events with only one numeric field gracefully', () => {
  const singleFieldFixture = [
    { id: "m1", price: 0.73 },
    { id: "m2", price: 0.81 }
  ];
  const events = ingest(singleFieldFixture);
  for (const event of events) {
    assert.strictEqual(event.metadata.has_coords, false,
      'Falsely detected coordinates from single numeric field');
  }
});
```

## Execution order

1. Read `src/ingester/generic.js` — find `findCoordinates()`, understand the full function
2. Add the guard clause in the exact location described above
3. Add all 8 tests to `test/unit/ingester.spec.js`
4. Run unit tests: `npm run test:unit` — all must pass including new tests
5. Run convergence: `npm test` — all 6 tests must pass (TREMOR/CORONA/BREATH × raw/anonymized)
6. If convergence fails, the guard is too aggressive — it's rejecting real coordinates from a backing spec fixture. Investigate which fixture and adjust the guard.

## DONE condition

- Guard clause added to `findCoordinates()` in `src/ingester/generic.js`
- 8 new tests added to `test/unit/ingester.spec.js`
- All unit tests pass (560 existing + 8 new = 568)
- All 6 convergence tests pass (20.0/20.0 total score)
- Only two files modified: `src/ingester/generic.js` and `test/unit/ingester.spec.js`
- Commit message: `fix: reject 0-1 bounded value pairs as false-positive coordinates`
