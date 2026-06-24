const { chromium } = require('playwright');
const { BASE_URL: PAGE, FILE_A, FILE_B, shot } = require('./config');
let failures = 0;
const check = (n, c, d) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d != null ? '  (' + d + ')' : ''}`); if (!c) failures++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(PAGE, { waitUntil: 'load' });
  await page.setInputFiles('.slot[data-slot="a"] input[data-role="file"]', FILE_A);
  await page.setInputFiles('.slot[data-slot="b"] input[data-role="file"]', FILE_B);
  await page.waitForFunction(() => state && state.data.a && state.data.b && charts.hr && charts.speed && charts.elev, null, { timeout: 15000 });

  const ranges = () => page.evaluate(() => {
    const r = c => ({ min: c.scales.x.min, max: c.scales.x.max });
    return { hr: r(charts.hr), speed: r(charts.speed), elev: r(charts.elev) };
  });

  async function shiftDragZoom(sel, x1, x2) {
    await page.locator(sel).scrollIntoViewIfNeeded();
    const b = await page.locator(sel).boundingBox();
    const y = b.y + b.height * 0.5;
    await page.keyboard.down('Shift');
    await page.mouse.move(b.x + b.width * x1, y);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * x2, y, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(150);
  }

  // zoom HR -> speed & elev should follow
  await shiftDragZoom('#chart-hr', 0.35, 0.62);
  let r = await ranges();
  console.log('after zoom HR:', JSON.stringify(r));
  check('HR actually zoomed', (r.hr.max - r.hr.min) < 60, `range=${(r.hr.max - r.hr.min).toFixed(1)}`);
  check('speed synced to HR', near(r.speed.min, r.hr.min, 0.6) && near(r.speed.max, r.hr.max, 0.6));
  check('elev synced to HR', near(r.elev.min, r.hr.min, 0.6) && near(r.elev.max, r.hr.max, 0.6));

  // map highlight active + base dimmed
  const mapState = await page.evaluate(() => ({
    hl: highlightLayers.length,
    opA: baseLines.a ? baseLines.a.options.opacity : null,
    opB: baseLines.b ? baseLines.b.options.opacity : null,
  }));
  console.log('map state while zoomed:', JSON.stringify(mapState));
  check('map highlight segments drawn', mapState.hl > 0, `${mapState.hl} layers`);
  check('base tracks dimmed', mapState.opA < 0.5 && mapState.opB < 0.5, `${mapState.opA}/${mapState.opB}`);

  await page.screenshot({ path: shot('full3.png'), fullPage: true });

  // double-click HR resets ALL charts + map
  await page.dblclick('#chart-hr');
  await page.waitForTimeout(150);
  r = await ranges();
  const after = await page.evaluate(() => ({ hl: highlightLayers.length, opA: baseLines.a.options.opacity }));
  check('all charts reset to full', (r.hr.max - r.hr.min) > 60 && (r.speed.max - r.speed.min) > 60 && (r.elev.max - r.elev.min) > 60,
    `hr=${(r.hr.max - r.hr.min).toFixed(0)} sp=${(r.speed.max - r.speed.min).toFixed(0)} el=${(r.elev.max - r.elev.min).toFixed(0)}`);
  check('map highlight cleared', after.hl === 0);
  check('base tracks un-dimmed', after.opA > 0.5, `${after.opA}`);

  // reverse direction: zoom ELEV -> HR should follow
  await shiftDragZoom('#chart-elev', 0.5, 0.7);
  r = await ranges();
  check('zoom on elev syncs HR', near(r.hr.min, r.elev.min, 0.6) && near(r.hr.max, r.elev.max, 0.6));

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(`\n==== ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILED'} ====`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
