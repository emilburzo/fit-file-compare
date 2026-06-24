const { chromium } = require('playwright');

const { BASE_URL: PAGE, FILE_A, FILE_B, shot } = require('./config');

// Ground truth for the synthetic fixtures in tests/fixtures
// (regenerate both with: npm run gen:fixtures — see generate-fixtures.mjs).
const expected = {
  a: { points: 991, track: 991, hrAvg: 162, hrMax: 189, distM: 11209 },
  b: { hrAvg: 161.4, hrMax: 187, spdMax: 21.45, distM: 11085, track: 3901 },
};

let failures = 0;
function check(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) failures++;
}
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

  await page.goto(PAGE, { waitUntil: 'load' });

  // libraries present
  check('Leaflet loaded', await page.evaluate(() => typeof L !== 'undefined'));
  check('Chart.js loaded', await page.evaluate(() => typeof Chart !== 'undefined'));
  check('FitParser global', await page.evaluate(() => typeof FitParser === 'function'));

  // upload both files
  await page.setInputFiles('.slot[data-slot="a"] input[data-role="file"]', FILE_A);
  await page.setInputFiles('.slot[data-slot="b"] input[data-role="file"]', FILE_B);

  // wait for both parsed + charts built
  await page.waitForFunction(() => state && state.data.a && state.data.b && charts.hr, null, { timeout: 15000 });

  const s = await page.evaluate(() => ({
    a: state.data.a.stats,
    b: state.data.b.stats,
    trackA: state.data.a.track.length,
    trackB: state.data.b.track.length,
    hrDsA: charts.hr.data.datasets.length,
    speedDs: charts.speed ? charts.speed.data.datasets.length : 0,
    elevDs: charts.elev ? charts.elev.data.datasets.length : 0,
    align: state.align,
    labels: [state.slots.a.label, state.slots.b.label],
  }));

  console.log('\n--- extracted ---');
  console.log('A:', JSON.stringify(s.a));
  console.log('B:', JSON.stringify(s.b));
  console.log('tracks A/B:', s.trackA, s.trackB, '| chart datasets hr/speed/elev:', s.hrDsA, s.speedDs, s.elevDs);

  console.log('\n--- validation ---');
  check('A points', s.a.points === expected.a.points, `${s.a.points}`);
  check('A avg HR', near(s.a.hr.avg, expected.a.hrAvg, 0.6), `${s.a.hr.avg.toFixed(1)} vs ${expected.a.hrAvg}`);
  check('A max HR', s.a.hr.max === expected.a.hrMax, `${s.a.hr.max}`);
  check('A distance', near(s.a.distanceM, expected.a.distM, 5), `${s.a.distanceM}`);
  check('A has GPS track', s.trackA === expected.a.track, `${s.trackA}`);

  check('B avg HR', near(s.b.hr.avg, expected.b.hrAvg, 0.6), `${s.b.hr.avg.toFixed(1)} vs ${expected.b.hrAvg}`);
  check('B max HR', s.b.hr.max === expected.b.hrMax, `${s.b.hr.max}`);
  check('B max speed', near(s.b.speed.max, expected.b.spdMax, 0.2), `${s.b.speed.max.toFixed(2)}`);
  check('B distance', near(s.b.distanceM, expected.b.distM, 5), `${s.b.distanceM}`);
  check('B GPS track pts', s.trackB === expected.b.track, `${s.trackB}`);

  check('HR chart has 2 series', s.hrDsA === 2);
  check('elevation chart has 2 series', s.elevDs === 2);

  // agreement panel populated
  const agText = await page.textContent('#agreement-table');
  const agVisible = await page.isVisible('#agreement-panel');
  check('agreement panel visible', agVisible);
  check('agreement table has HR row + limits column', /Heart rate/.test(agText) && /95% limits/.test(agText), agText.replace(/\s+/g, ' ').slice(0, 160));

  // stats panel populated
  check('stats panel visible', await page.isVisible('#stats-panel'));
  // map shown
  check('map visible (not empty placeholder)', await page.isHidden('#map-empty'));

  console.log('\n--- console/page errors ---');
  console.log(errors.length ? errors.join('\n') : '(none)');
  check('no page errors', errors.length === 0);

  await page.screenshot({ path: shot('full.png'), fullPage: true });
  console.log('\nscreenshot saved');

  await browser.close();
  console.log(`\n==== ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ====`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST CRASHED:', e); process.exit(2); });
