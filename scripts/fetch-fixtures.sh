#!/usr/bin/env bash
# scripts/fetch-fixtures.sh
# Fetches all 5 fixture files from live APIs and saves them to fixtures/.
# Run once during Sprint 1 scaffolding. Fixtures are committed and never modified.
#
# Usage:
#   bash scripts/fetch-fixtures.sh
#
# Environment variables (for PurpleAir + AirNow):
#   PURPLEAIR_API_KEY  — PurpleAir API v1 key
#   AIRNOW_API_KEY     — AirNow API key
#
# If API keys are not set, synthetic fixtures are written instead.

set -euo pipefail

FIXTURES_DIR="$(dirname "$0")/../fixtures"
mkdir -p "$FIXTURES_DIR"

echo "[fetch-fixtures] Fetching USGS M4.5+ day feed..."
curl -fsSL \
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson" \
  -o "$FIXTURES_DIR/usgs-m4.5-day.json"
echo "[fetch-fixtures] usgs-m4.5-day.json saved ($(wc -c < "$FIXTURES_DIR/usgs-m4.5-day.json") bytes)"

echo "[fetch-fixtures] Fetching SWPC GOES X-ray flux (6h)..."
curl -fsSL \
  "https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json" \
  -o /tmp/swpc-xrays.json

echo "[fetch-fixtures] Fetching SWPC Kp observed..."
curl -fsSL \
  "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json" \
  -o /tmp/swpc-kp.json

# Combine into single CORONA SWPC fixture
node --input-type=module <<'JSEOF'
import { readFileSync, writeFileSync } from 'node:fs';
const xrays = JSON.parse(readFileSync('/tmp/swpc-xrays.json', 'utf8'));
const kp = JSON.parse(readFileSync('/tmp/swpc-kp.json', 'utf8'));
const combined = { xray_flux: xrays, kp_index: kp };
writeFileSync('fixtures/swpc-goes-xray.json', JSON.stringify(combined, null, 2));
console.log('[fetch-fixtures] swpc-goes-xray.json saved');
JSEOF

echo "[fetch-fixtures] Fetching NASA DONKI FLR + CME (7-day)..."
DONKI_START=$(date -d "7 days ago" +%Y-%m-%d 2>/dev/null || date -v-7d +%Y-%m-%d)
DONKI_END=$(date +%Y-%m-%d)
curl -fsSL \
  "https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/FLR?startDate=${DONKI_START}&endDate=${DONKI_END}" \
  -o /tmp/donki-flr.json
curl -fsSL \
  "https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/CME?startDate=${DONKI_START}&endDate=${DONKI_END}" \
  -o /tmp/donki-cme.json

node --input-type=module <<'JSEOF'
import { readFileSync, writeFileSync } from 'node:fs';
const flr = JSON.parse(readFileSync('/tmp/donki-flr.json', 'utf8'));
const cme = JSON.parse(readFileSync('/tmp/donki-cme.json', 'utf8'));
const combined = { flares: flr, cmes: cme };
writeFileSync('fixtures/donki-flr-cme.json', JSON.stringify(combined, null, 2));
console.log('[fetch-fixtures] donki-flr-cme.json saved');
JSEOF

# PurpleAir — requires API key
if [ -n "${PURPLEAIR_API_KEY:-}" ]; then
  echo "[fetch-fixtures] Fetching PurpleAir SF Bay sensors..."
  # SF Bay bounding box: nwlng=-123.0, nwlat=38.0, selng=-121.5, selat=37.0
  curl -fsSL \
    "https://api.purpleair.com/v1/sensors?fields=sensor_index,name,latitude,longitude,pm2.5_cf_1,pm2.5_atm,temperature,humidity,last_seen&nwlng=-123.0&nwlat=38.0&selng=-121.5&selat=37.0" \
    -H "X-API-Key: ${PURPLEAIR_API_KEY}" \
    -o "$FIXTURES_DIR/purpleair-sf-bay.json"
  echo "[fetch-fixtures] purpleair-sf-bay.json saved"
else
  echo "[fetch-fixtures] PURPLEAIR_API_KEY not set — writing synthetic fixture"
  cat > "$FIXTURES_DIR/purpleair-sf-bay.json" << 'SYNTHETIC'
{
  "api_version": "V1.0.11-0.0.41",
  "time_stamp": 1710000000,
  "data_time_stamp": 1710000000,
  "max_age": 604800,
  "firmware_default_version": "7.02",
  "fields": ["sensor_index", "name", "latitude", "longitude", "pm2.5_cf_1", "pm2.5_atm", "temperature", "humidity", "last_seen"],
  "data": [
    [131075, "BRSF-Bay-1", 37.7749, -122.4194, 8.2, 7.9, 68, 62, 1710000000],
    [131077, "BRSF-Bay-2", 37.7751, -122.4196, 9.1, 8.8, 67, 63, 1709999940],
    [131079, "BRSF-Bay-3", 37.7753, -122.4190, 7.5, 7.2, 69, 61, 1709999880],
    [131081, "BRSF-Bay-4", 37.8044, -122.2712, 12.3, 11.9, 66, 65, 1710000000],
    [131083, "BRSF-Bay-5", 37.8046, -122.2714, 11.8, 11.4, 65, 66, 1709999940],
    [131085, "BRSF-Bay-6", 37.6879, -122.4702, 6.1, 5.8, 70, 60, 1710000000],
    [131087, "BRSF-Bay-7", 37.6881, -122.4704, 5.9, 5.6, 71, 59, 1709999940],
    [131089, "BRSF-Bay-8", 37.5630, -122.0530, 15.7, 15.2, 64, 68, 1710000000],
    [131091, "BRSF-Bay-9", 37.5632, -122.0532, 16.2, 15.8, 63, 69, 1709999940],
    [131093, "BRSF-Bay-10", 37.9735, -122.5311, 9.8, 9.4, 67, 64, 1710000000],
    [131095, "BRSF-Bay-11", 37.9737, -122.5313, 10.1, 9.7, 66, 65, 1709999940],
    [131097, "BRSF-Bay-12", 37.3382, -121.8863, 20.4, 19.8, 72, 55, 1710000000],
    [131099, "BRSF-Bay-13", 37.3384, -121.8865, 21.1, 20.5, 71, 56, 1709999940],
    [131101, "BRSF-Bay-14", 37.4419, -122.1430, 13.5, 13.1, 68, 62, 1710000000],
    [131103, "BRSF-Bay-15", 37.4421, -122.1432, 14.0, 13.6, 67, 63, 1709999940],
    [131105, "BRSF-Bay-16", 37.5485, -121.9886, 18.9, 18.3, 69, 61, 1710000000],
    [131107, "BRSF-Bay-17", 37.5487, -121.9888, 19.3, 18.7, 68, 62, 1709999940],
    [131109, "BRSF-Bay-18", 37.8716, -122.2727, 11.2, 10.8, 66, 64, 1710000000],
    [131111, "BRSF-Bay-19", 37.8718, -122.2729, 10.9, 10.5, 65, 65, 1709999940],
    [131113, "BRSF-Bay-20", 37.6546, -122.0827, 14.8, 14.3, 70, 60, 1710000000]
  ]
}
SYNTHETIC
  echo "[fetch-fixtures] Synthetic purpleair-sf-bay.json written"
fi

# AirNow — requires API key
if [ -n "${AIRNOW_API_KEY:-}" ]; then
  echo "[fetch-fixtures] Fetching AirNow SF Bay hourly observations..."
  DATE=$(date +%Y-%m-%d)
  HOUR=$(date +%H)
  curl -fsSL \
    "https://www.airnowapi.org/aq/observation/latLong/historical/?format=application/json&latitude=37.7749&longitude=-122.4194&date=${DATE}T${HOUR}-0000&distance=50&API_KEY=${AIRNOW_API_KEY}" \
    -o "$FIXTURES_DIR/airnow-sf-bay.json"
  echo "[fetch-fixtures] airnow-sf-bay.json saved"
else
  echo "[fetch-fixtures] AIRNOW_API_KEY not set — writing synthetic fixture"
  cat > "$FIXTURES_DIR/airnow-sf-bay.json" << 'SYNTHETIC'
[
  {"DateObserved": "2024-03-10", "HourObserved": 14, "LocalTimeZone": "PST", "ReportingArea": "San Francisco", "StateCode": "CA", "Latitude": 37.75, "Longitude": -122.41, "ParameterName": "PM2.5", "AQI": 42, "Category": {"Number": 1, "Name": "Good"}},
  {"DateObserved": "2024-03-10", "HourObserved": 13, "LocalTimeZone": "PST", "ReportingArea": "San Francisco", "StateCode": "CA", "Latitude": 37.75, "Longitude": -122.41, "ParameterName": "PM2.5", "AQI": 38, "Category": {"Number": 1, "Name": "Good"}},
  {"DateObserved": "2024-03-10", "HourObserved": 12, "LocalTimeZone": "PST", "ReportingArea": "San Francisco", "StateCode": "CA", "Latitude": 37.75, "Longitude": -122.41, "ParameterName": "PM2.5", "AQI": 35, "Category": {"Number": 1, "Name": "Good"}},
  {"DateObserved": "2024-03-10", "HourObserved": 11, "LocalTimeZone": "PST", "ReportingArea": "San Francisco", "StateCode": "CA", "Latitude": 37.75, "Longitude": -122.41, "ParameterName": "PM2.5", "AQI": 31, "Category": {"Number": 1, "Name": "Good"}},
  {"DateObserved": "2024-03-10", "HourObserved": 10, "LocalTimeZone": "PST", "ReportingArea": "San Francisco", "StateCode": "CA", "Latitude": 37.75, "Longitude": -122.41, "ParameterName": "PM2.5", "AQI": 28, "Category": {"Number": 1, "Name": "Good"}},
  {"DateObserved": "2024-03-10", "HourObserved": 9,  "LocalTimeZone": "PST", "ReportingArea": "San Francisco", "StateCode": "CA", "Latitude": 37.75, "Longitude": -122.41, "ParameterName": "PM2.5", "AQI": 25, "Category": {"Number": 1, "Name": "Good"}},
  {"DateObserved": "2024-03-10", "HourObserved": 8,  "LocalTimeZone": "PST", "ReportingArea": "San Francisco", "StateCode": "CA", "Latitude": 37.75, "Longitude": -122.41, "ParameterName": "PM2.5", "AQI": 22, "Category": {"Number": 1, "Name": "Good"}},
  {"DateObserved": "2024-03-10", "HourObserved": 7,  "LocalTimeZone": "PST", "ReportingArea": "San Francisco", "StateCode": "CA", "Latitude": 37.75, "Longitude": -122.41, "ParameterName": "PM2.5", "AQI": 18, "Category": {"Number": 1, "Name": "Good"}},
  {"DateObserved": "2024-03-10", "HourObserved": 6,  "LocalTimeZone": "PST", "ReportingArea": "San Francisco", "StateCode": "CA", "Latitude": 37.75, "Longitude": -122.41, "ParameterName": "PM2.5", "AQI": 16, "Category": {"Number": 1, "Name": "Good"}},
  {"DateObserved": "2024-03-10", "HourObserved": 5,  "LocalTimeZone": "PST", "ReportingArea": "San Francisco", "StateCode": "CA", "Latitude": 37.75, "Longitude": -122.41, "ParameterName": "PM2.5", "AQI": 14, "Category": {"Number": 1, "Name": "Good"}},
  {"DateObserved": "2024-03-10", "HourObserved": 4,  "LocalTimeZone": "PST", "ReportingArea": "San Francisco", "StateCode": "CA", "Latitude": 37.75, "Longitude": -122.41, "ParameterName": "PM2.5", "AQI": 12, "Category": {"Number": 1, "Name": "Good"}},
  {"DateObserved": "2024-03-10", "HourObserved": 3,  "LocalTimeZone": "PST", "ReportingArea": "Oakland", "StateCode": "CA", "Latitude": 37.80, "Longitude": -122.27, "ParameterName": "PM2.5", "AQI": 48, "Category": {"Number": 1, "Name": "Good"}},
  {"DateObserved": "2024-03-10", "HourObserved": 2,  "LocalTimeZone": "PST", "ReportingArea": "Oakland", "StateCode": "CA", "Latitude": 37.80, "Longitude": -122.27, "ParameterName": "PM2.5", "AQI": 52, "Category": {"Number": 2, "Name": "Moderate"}},
  {"DateObserved": "2024-03-10", "HourObserved": 1,  "LocalTimeZone": "PST", "ReportingArea": "San Jose", "StateCode": "CA", "Latitude": 37.33, "Longitude": -121.88, "ParameterName": "PM2.5", "AQI": 61, "Category": {"Number": 2, "Name": "Moderate"}},
  {"DateObserved": "2024-03-10", "HourObserved": 0,  "LocalTimeZone": "PST", "ReportingArea": "San Jose", "StateCode": "CA", "Latitude": 37.33, "Longitude": -121.88, "ParameterName": "PM2.5", "AQI": 55, "Category": {"Number": 2, "Name": "Moderate"}}
]
SYNTHETIC
  echo "[fetch-fixtures] Synthetic airnow-sf-bay.json written"
fi

echo ""
echo "[fetch-fixtures] Done. Validate:"
for f in usgs-m4.5-day.json swpc-goes-xray.json donki-flr-cme.json purpleair-sf-bay.json airnow-sf-bay.json; do
  SIZE=$(wc -c < "$FIXTURES_DIR/$f" 2>/dev/null || echo "MISSING")
  echo "  fixtures/$f — $SIZE bytes"
done
