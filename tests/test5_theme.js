const { chromium } = require('playwright');
const { BASE_URL: PAGE, FILE_A, FILE_B, shot } = require('./config');
let failures = 0;
const check = (n, c, d) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d != null ? '  (' + d + ')' : ''}`); if (!c) failures++; };

const cssVar = (page, name) => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const attr = page => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const chartColor = page => page.evaluate(() => Chart.defaults.color);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
  await page.emulateMedia({ colorScheme: 'light' });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(PAGE, { waitUntil: 'load' });
  check('default theme = auto', await page.inputValue('#theme-select') === 'auto');
  check('no data-theme attr in auto', await attr(page) === null);
  check('auto+light OS -> light vars', await cssVar(page, '--bg') === '#f6f7f9', await cssVar(page, '--bg'));

  await page.setInputFiles('.slot[data-slot="a"] input[data-role="file"]', FILE_A);
  await page.setInputFiles('.slot[data-slot="b"] input[data-role="file"]', FILE_B);
  await page.waitForFunction(() => state && state.data.a && state.data.b && charts.hr, null, { timeout: 15000 });

  // switch to DARK
  await page.selectOption('#theme-select', 'dark');
  await page.waitForTimeout(80);
  check('dark: data-theme=dark', await attr(page) === 'dark');
  check('dark: --bg is dark', await cssVar(page, '--bg') === '#0d1117', await cssVar(page, '--bg'));
  check('dark: body bg applied', /13, 17, 23/.test(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)));
  check('dark: chart text light', await chartColor(page) === '#c9d1d9', await chartColor(page));
  check('dark: tile filter set', (await cssVar(page, '--tile-filter')).includes('invert'));
  check('dark: persisted', /"theme":"dark"/.test(await page.evaluate(() => localStorage.getItem('fitcompare.settings.v2'))));
  await page.screenshot({ path: shot('full4.png'), fullPage: true });

  // switch to LIGHT
  await page.selectOption('#theme-select', 'light');
  await page.waitForTimeout(80);
  check('light: data-theme=light', await attr(page) === 'light');
  check('light: --bg light', await cssVar(page, '--bg') === '#f6f7f9', await cssVar(page, '--bg'));
  check('light: chart text dark', await chartColor(page) === '#666');

  // AUTO follows OS: flip emulated OS to dark
  await page.selectOption('#theme-select', 'auto');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(80);
  check('auto+dark OS -> dark vars', await cssVar(page, '--bg') === '#0d1117', await cssVar(page, '--bg'));
  check('auto+dark OS -> chart text light', await chartColor(page) === '#c9d1d9', await chartColor(page));

  // persistence across reload
  await page.emulateMedia({ colorScheme: 'light' });
  await page.selectOption('#theme-select', 'dark');
  await page.waitForTimeout(50);
  await page.reload({ waitUntil: 'load' });
  check('theme persists after reload', await page.inputValue('#theme-select') === 'dark' && await attr(page) === 'dark');

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(`\n==== ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILED'} ====`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
