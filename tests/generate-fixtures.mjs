// Generates the SYNTHETIC FIT fixtures in tests/fixtures (no real location).
// Run with:  npm run gen:fixtures
// They reproduce the structure the app must handle, then this prints the exact
// ground-truth stats (decoded with the app's own parser) to paste into test.js.
//
//   garmin_optical.fit  — single record stream @4s; every record has
//     position + enhanced_speed + enhanced_altitude + heart_rate (+ distance, cadence)
//   strava_with_hrm.fit — GPS records @1s (position + speed + enhanced_altitude +
//     gps_accuracy + distance) AND a separate, shorter heart_rate-only stream @1s
import { Encoder, Profile } from '@garmin/fitsdk';
import FitParser from 'fit-file-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const SEMI = 2 ** 31 / 180;
const T0 = new Date('2025-01-01T08:00:00Z').getTime();
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// synthetic, deliberately not a real place: a small out-and-back near (45, 7)
const lat = frac => 45.0 + 0.012 * Math.sin(frac * Math.PI);
const lng = frac => 7.0 + 0.040 * Math.sin(frac * Math.PI);
const hrCurve = (frac, t, base) => Math.round(clamp(base + 42 * Math.sin(frac * Math.PI) + 12 * Math.sin(t * 0.02), 90, 199));
const speedCurve = (frac, t) => Math.max(0, 2.0 + 1.3 * Math.sin(frac * Math.PI) + 0.8 * Math.sin(t * 0.03));

function buildA() {
  const enc = new Encoder();
  enc.onMesg(Profile.MesgNum.FILE_ID, { type: 'activity', timeCreated: new Date(T0) });
  const DUR = 3960, STEP = 4;
  let dist = 0;
  for (let t = 0; t <= DUR; t += STEP) {
    const frac = t / DUR;
    const sp = speedCurve(frac, t);
    dist += sp * STEP;
    enc.onMesg(Profile.MesgNum.RECORD, {
      timestamp: new Date(T0 + t * 1000),
      positionLat: Math.round(lat(frac) * SEMI),
      positionLong: Math.round(lng(frac) * SEMI),
      distance: dist,
      enhancedSpeed: sp,
      enhancedAltitude: 200 + 250 * Math.sin(frac * Math.PI) + 5 * Math.sin(t * 0.05),
      heartRate: hrCurve(frac, t, 135),
      cadence: 70,
    });
  }
  return enc.close();
}

function buildB() {
  const enc = new Encoder();
  enc.onMesg(Profile.MesgNum.FILE_ID, { type: 'activity', timeCreated: new Date(T0) });
  const DUR = 3900;
  let dist = 0;
  for (let t = 0; t <= DUR; t += 1) {
    const frac = t / DUR;
    let sp = speedCurve(frac, t);
    if (t >= 1948 && t <= 1952) sp += 1.9; // a brief sprint -> higher max speed
    dist += sp;
    enc.onMesg(Profile.MesgNum.RECORD, {
      timestamp: new Date(T0 + t * 1000),
      positionLat: Math.round((lat(frac) + 0.0001 * Math.sin(t * 0.5)) * SEMI),
      positionLong: Math.round((lng(frac) + 0.0001 * Math.cos(t * 0.5)) * SEMI),
      speed: sp,
      enhancedAltitude: 230 + 250 * Math.sin(frac * Math.PI) + 8 * Math.sin(t * 0.07),
      gpsAccuracy: 3,
      distance: dist,
    });
  }
  for (let t = 0; t <= 3700; t += 1) { // HR-only records: separate stream, fewer than GPS
    const frac = t / 3960;
    enc.onMesg(Profile.MesgNum.RECORD, { timestamp: new Date(T0 + t * 1000), heartRate: hrCurve(frac, t, 133) });
  }
  return enc.close();
}

// stats exactly as the app computes them
function statsFor(bytes) {
  return new Promise((resolve, reject) => {
    new FitParser({ force: true, speedUnit: 'm/s', lengthUnit: 'm', mode: 'list' })
      .parse(bytes, (err, data) => {
        if (err) return reject(err);
        const recs = (data.records || []).filter(r => r.timestamp);
        const track = recs.filter(r => r.position_lat != null && r.position_long != null);
        const hr = recs.filter(r => r.heart_rate != null).map(r => r.heart_rate);
        const spd = recs.map(r => (r.enhanced_speed ?? r.speed)).filter(v => v != null).map(v => v * 3.6);
        const dist = recs.map(r => r.distance).filter(v => v != null);
        resolve({
          points: recs.length, track: track.length,
          hrAvg: +(hr.reduce((s, v) => s + v, 0) / hr.length).toFixed(1),
          hrMax: Math.max(...hr),
          spdMax: +Math.max(...spd).toFixed(2),
          distM: +dist[dist.length - 1].toFixed(2),
        });
      });
  });
}

const a = buildA(), b = buildB();
fs.writeFileSync(path.join(FIX, 'garmin_optical.fit'), Buffer.from(a));
fs.writeFileSync(path.join(FIX, 'strava_with_hrm.fit'), Buffer.from(b));
console.log('wrote fixtures to', FIX);
console.log('A (garmin_optical):', JSON.stringify(await statsFor(a)));
console.log('B (strava_with_hrm):', JSON.stringify(await statsFor(b)));
