# SWPC GOES X-ray API Reference (for FORGE adapter)

## Endpoint
- **1-day**: `https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json`
- **3-day**: `https://services.swpc.noaa.gov/json/goes/primary/xrays-3-day.json`
- **Auth**: None required
- **Format**: JSON array of objects
- **Update frequency**: ~1 minute (new reading appended each minute)
- **Trust tier**: T1 (official source, NOAA SWPC)

## Response shape
Each element in the array:
```json
{
  "time_tag": "2026-02-28T17:19:00Z",
  "satellite": 18,
  "flux": 5.405078695730481e-08,
  "observed_flux": 1.2091771850464283e-07,
  "electron_correction": 6.686692444191067e-08,
  "electron_contaminaton": true,
  "energy": "0.05-0.4nm"
}
```

### Fields
| Field | Type | Description |
|-------|------|-------------|
| `time_tag` | string (ISO 8601) | Observation timestamp in UTC |
| `satellite` | integer | GOES satellite number (e.g. 16, 18) |
| `flux` | float | Corrected X-ray flux (W/m²) — this is the primary value |
| `observed_flux` | float | Raw observed flux before electron correction |
| `electron_correction` | float | Correction applied for electron contamination |
| `electron_contaminaton` | boolean | Whether electron contamination was detected (note: typo "contaminaton" is in the real API) |
| `energy` | string | Energy band — two bands per timestamp: `"0.05-0.4nm"` (short) and `"0.1-0.8nm"` (long) |

### Key characteristics for FORGE adapter
- **Two readings per minute**: One for each energy band (0.05-0.4nm and 0.1-0.8nm)
- **Dedup key**: `time_tag + energy` (or `time_tag + satellite + energy` if multi-satellite)
- **Primary value field**: `flux` (corrected). Use this for classification.
- **Cadence**: Regular ~60s intervals (multi_cadence when both bands considered)
- **Value range**: Unbounded numeric (flux values span orders of magnitude, ~1e-8 to ~1e-3 during flares)
- **Flare classification thresholds**: Based on 0.1-0.8nm band flux:
  - A class: < 1e-7
  - B class: 1e-7 to 1e-6
  - C class: 1e-6 to 1e-5
  - M class: 1e-5 to 1e-4
  - X class: > 1e-4

## Notes
- The API returns the full 1-day (or 3-day) window on every request — no pagination, no cursor
- Stale data detection: if the most recent `time_tag` is >5 minutes old, the feed may be delayed
- No rate limit documented, but be respectful (60s poll interval matches the data update frequency)
