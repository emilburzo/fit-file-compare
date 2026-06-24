const { chromium } = require('playwright');
const { BASE_URL: PAGE, FILE_A, FILE_B, shot } = require('./config');
let failures = 0;
const check = (n, c, d) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); if (!c) failures++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(PAGE, { waitUntil: 'load' });

  // labels start empty now (no Optical/Chest strap defaults)
  check('default label A empty', await page.inputValue('.slot[data-slot="a"] [data-role="label"]') === '');
  check('default label B empty', await page.inputValue('.slot[data-slot="b"] [data-role="label"]') === '');

  // edit a label -> should persist to localStorage
  await page.fill('.slot[data-slot="a"] [data-role="label"]', 'Polar OH1');
  await page.waitForTimeout(50);
  const ls1 = await page.evaluate(() => localStorage.getItem('fitcompare.settings.v2'));
  check('label saved to localStorage', /Polar OH1/.test(ls1 || ''), ls1);

  // reload (same context keeps localStorage) -> label restored
  await page.reload({ waitUntil: 'load' });
  check('label restored after reload', await page.inputValue('.slot[data-slot="a"] [data-role="label"]') === 'Polar OH1');

  // upload files and test alignment toggle
  await page.setInputFiles('.slot[data-slot="a"] input[data-role="file"]', FILE_A);
  await page.setInputFiles('.slot[data-slot="b"] input[data-role="file"]', FILE_B);
  await page.waitForFunction(() => state && state.data.a && state.data.b && charts.hr, null, { timeout: 15000 });

  const xTitleClock = await page.evaluate(() => charts.hr.options.scales.x.title.text);
  check('clock x-axis title', /shared clock/.test(xTitleClock), xTitleClock);
  // legend label reflects custom label
  check('chart uses custom label', await page.evaluate(() => charts.hr.data.datasets[0].label) === 'Polar OH1');

  // switch to "from each start"
  await page.check('input[name="align"][value="zero"]');
  await page.waitForTimeout(100);
  const xTitleZero = await page.evaluate(() => charts.hr.options.scales.x.title.text);
  check('zero x-axis title', /from each start/.test(xTitleZero), xTitleZero);
  // slot B was left unlabeled -> its chart series should fall back to the file name
  check('unlabeled track uses file name', await page.evaluate(() => charts.hr.data.datasets[1].label) === 'strava_with_hrm', await page.evaluate(() => charts.hr.data.datasets[1].label));

  // in zero mode both series should start at x=0
  const firstXs = await page.evaluate(() => charts.hr.data.datasets.map(d => d.data[0].x));
  check('both series start at 0 in zero mode', firstXs.every(x => Math.abs(x) < 0.001), JSON.stringify(firstXs));

  check('no errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(`\n==== ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILED'} ====`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
