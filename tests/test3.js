const { chromium } = require('playwright');
const { BASE_URL: PAGE, FILE_A, FILE_B, shot } = require('./config');
let failures = 0;
const check = (n, c, d) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d != null ? '  (' + d + ')' : ''}`); if (!c) failures++; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(PAGE, { waitUntil: 'load' });
  check('zoom plugin global', await page.evaluate(() => typeof window.ChartZoom !== 'undefined'));
  check('Hammer loaded (for pan)', await page.evaluate(() => typeof Hammer !== 'undefined'));
  check('custom xAll interaction mode', await page.evaluate(() => typeof Chart.Interaction.modes.xAll === 'function'));

  await page.setInputFiles('.slot[data-slot="a"] input[data-role="file"]', FILE_A);
  await page.setInputFiles('.slot[data-slot="b"] input[data-role="file"]', FILE_B);
  await page.waitForFunction(() => state && state.data.a && state.data.b && charts.hr, null, { timeout: 15000 });

  // distance series present
  const distLens = await page.evaluate(() => [state.data.a.series.dist.length, state.data.b.series.dist.length]);
  check('distance series populated', distLens[0] > 0 && distLens[1] > 0, distLens.join('/'));

  // zoom config + functional zoom/reset
  check('zoom configured on chart', await page.evaluate(() => !!(charts.hr.options.plugins.zoom && charts.hr.options.plugins.zoom.zoom.wheel.enabled)));
  const zoomResult = await page.evaluate(() => {
    const c = charts.hr;
    const before = c.scales.x.max - c.scales.x.min;
    c.zoom(2.0);
    const during = c.scales.x.max - c.scales.x.min;
    c.resetZoom();
    const after = c.scales.x.max - c.scales.x.min;
    return { before, during, after };
  });
  check('zoom shrinks x range', zoomResult.during < zoomResult.before * 0.85, JSON.stringify(zoomResult.during.toFixed(1) + '<' + zoomResult.before.toFixed(1)));
  check('resetZoom restores range', Math.abs(zoomResult.after - zoomResult.before) < 0.01, `${zoomResult.after.toFixed(2)} vs ${zoomResult.before.toFixed(2)}`);

  // tooltip shows BOTH series at hovered x (the fix). Hover over the elevation chart.
  await page.locator('#chart-elev').scrollIntoViewIfNeeded();
  const box = await page.locator('#chart-elev').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5); // nudge to trigger
  await page.waitForTimeout(80);
  const activeCount = await page.evaluate(() => charts.elev.tooltip.getActiveElements().length);
  check('elevation tooltip shows both series', activeCount === 2, `active=${activeCount}`);

  // agreement table has all four metrics with finite numbers
  const table = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#agreement-table tbody tr')];
    return rows.map(tr => [...tr.children].map(td => td.textContent));
  });
  console.log('\n--- agreement table ---');
  table.forEach(r => console.log(r.join(' | ')));
  const metrics = table.map(r => r[0]);
  check('table has Heart rate', metrics.some(m => /Heart rate/.test(m)));
  check('table has Speed', metrics.some(m => /Speed/.test(m)));
  check('table has Elevation', metrics.some(m => /Elevation/.test(m)));
  check('table has Distance', metrics.some(m => /Distance/.test(m)));
  // every metric row: bias (col 1) is a finite signed number
  const biasOk = table.every(r => /^[+-]?\d/.test(r[1].trim()));
  check('every row has a numeric mean diff', biasOk);
  // HR hero has 95% limits of agreement card
  check('agreement table has 95% limits column', /95% limits/.test(await page.textContent('#agreement-table')));

  // real gestures on the HR chart: Shift+drag zooms, plain drag pans
  await page.locator('#chart-hr').scrollIntoViewIfNeeded();
  const hb = await page.locator('#chart-hr').boundingBox();
  const yy = hb.y + hb.height * 0.5;
  await page.evaluate(() => charts.hr.resetZoom());
  const beforeR = await page.evaluate(() => charts.hr.scales.x.max - charts.hr.scales.x.min);
  await page.keyboard.down('Shift');
  await page.mouse.move(hb.x + hb.width * 0.35, yy);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width * 0.65, yy, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(100);
  const afterR = await page.evaluate(() => charts.hr.scales.x.max - charts.hr.scales.x.min);
  check('shift-drag zooms a range', afterR < beforeR * 0.7, `${afterR.toFixed(1)} < ${beforeR.toFixed(1)}`);

  // plain drag should now pan: x.min shifts, range stays ~constant
  const beforeMin = await page.evaluate(() => charts.hr.scales.x.min);
  await page.mouse.move(hb.x + hb.width * 0.6, yy);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width * 0.35, yy, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const afterMin = await page.evaluate(() => charts.hr.scales.x.min);
  const afterR2 = await page.evaluate(() => charts.hr.scales.x.max - charts.hr.scales.x.min);
  check('drag pans (min shifts, range ~constant)',
    Math.abs(afterMin - beforeMin) > 0.5 && Math.abs(afterR2 - afterR) < afterR * 0.15,
    `min ${beforeMin.toFixed(1)}->${afterMin.toFixed(1)}, range ${afterR.toFixed(1)}->${afterR2.toFixed(1)}`);
  await page.evaluate(() => charts.hr.resetZoom());

  check('no page errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: shot('full2.png'), fullPage: true });
  await browser.close();
  console.log(`\n==== ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILED'} ====`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
