/* FIT Compare — no backend. Parses two .fit files in the browser and overlays
   their tracks, time-series charts and stats. Designed for sensor-vs-sensor
   comparison (e.g. optical vs chest-strap heart rate). */
'use strict';

/* ------------------------------------------------------------------ state */

const SLOT_IDS = ['a', 'b'];
const DEFAULTS = {
  a: { label: '', color: '#e8590c' },  // orange
  b: { label: '', color: '#1f6feb' },  // blue
};
const LS_KEY = 'fitcompare.settings.v2'; // v2: labels no longer default to Optical/Chest strap

const state = {
  align: 'clock',                 // 'clock' = shared real-time axis, 'zero' = each from 0:00
  theme: 'auto',                  // 'auto' = follow OS, else 'light' | 'dark'
  slots: { a: { ...DEFAULTS.a }, b: { ...DEFAULTS.b } },
  data: { a: null, b: null },     // parsed result per slot (see computeSeries)
};

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY));
    if (!s) return;
    if (s.align) state.align = s.align;
    if (s.theme) state.theme = s.theme;
    for (const id of SLOT_IDS) {
      if (s.slots && s.slots[id]) {
        if (typeof s.slots[id].label === 'string') state.slots[id].label = s.slots[id].label;
        if (typeof s.slots[id].color === 'string') state.slots[id].color = s.slots[id].color;
      }
    }
  } catch (_) { /* ignore corrupt storage */ }
}

function saveSettings() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ align: state.align, theme: state.theme, slots: state.slots }));
  } catch (_) { /* storage may be unavailable */ }
}

// Whether dark colours should be used right now (resolving 'auto' against the OS).
function isDarkResolved() {
  if (state.theme === 'dark') return true;
  if (state.theme === 'light') return false;
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

// Chart.js draws to canvas, so its text/grid colours can't come from CSS vars.
function applyChartColors() {
  const dark = isDarkResolved();
  Chart.defaults.color = dark ? '#c9d1d9' : '#666';
  Chart.defaults.borderColor = dark ? 'rgba(240,246,252,0.10)' : 'rgba(0,0,0,0.10)';
}

function applyTheme(theme) {
  state.theme = theme;
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  applyChartColors();
  for (const m of METRICS) if (charts[m.key]) charts[m.key].update('none');
}

// Name shown for a slot: the user's label, else the file name (without .fit), else A/B.
function displayLabel(id) {
  const custom = (state.slots[id].label || '').trim();
  if (custom) return custom;
  const d = state.data[id];
  if (d && d.fileName) return d.fileName.replace(/\.fit$/i, '');
  return id.toUpperCase();
}

/* ------------------------------------------------------------- fit parsing */

function parseFit(arrayBuffer) {
  return new Promise((resolve, reject) => {
    const parser = new FitParser({
      force: true,
      speedUnit: 'm/s',
      lengthUnit: 'm',
      mode: 'list',
    });
    parser.parse(arrayBuffer, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

const firstNum = (...vals) => { for (const v of vals) if (v != null && !Number.isNaN(v)) return v; return null; };

/* Turn raw records into independent per-metric time-series. FIT records can be
   sparse (Strava stores HR and GPS in separate records), so each metric is
   extracted on its own rather than assuming one row holds every field. */
function computeSeries(data, fileName) {
  const records = (data.records || []).filter(r => r.timestamp);
  records.sort((p, q) => p.timestamp - q.timestamp);

  const track = [];                 // [lat, lng]
  const trackPts = [];              // {t, lat, lng} — same points with timestamps, for map highlight
  const hr = [], speed = [], elev = [], dist = []; // {t: ms, y}
  let distance = null;

  for (const r of records) {
    const t = r.timestamp.getTime();
    if (r.position_lat != null && r.position_long != null) {
      track.push([r.position_lat, r.position_long]);
      trackPts.push({ t, lat: r.position_lat, lng: r.position_long });
    }
    if (r.heart_rate != null) hr.push({ t, y: r.heart_rate });
    const sp = firstNum(r.enhanced_speed, r.speed);
    if (sp != null) speed.push({ t, y: sp * 3.6 }); // m/s -> km/h
    const al = firstNum(r.enhanced_altitude, r.altitude);
    if (al != null) elev.push({ t, y: al });
    const d = firstNum(r.distance);
    if (d != null) { distance = d; dist.push({ t, y: d }); }
  }

  const firstT = records.length ? records[0].timestamp.getTime() : null;
  const lastT = records.length ? records[records.length - 1].timestamp.getTime() : null;

  return {
    fileName,
    track,
    trackPts,
    series: { hr, speed, elev, dist },
    firstT, lastT,
    distance,
    stats: {
      points: records.length,
      durationS: firstT != null ? (lastT - firstT) / 1000 : null,
      distanceM: distance,
      hr: summarize(hr),
      speed: summarize(speed),
      elev: summarize(elev),
      ascentM: ascent(elev),
    },
  };
}

function summarize(pts) {
  if (!pts.length) return null;
  let sum = 0, min = Infinity, max = -Infinity;
  for (const p of pts) { sum += p.y; if (p.y < min) min = p.y; if (p.y > max) max = p.y; }
  return { n: pts.length, avg: sum / pts.length, min, max };
}

/* Cumulative ascent with a small hysteresis so GPS/baro noise isn't counted. */
function ascent(elev) {
  if (elev.length < 2) return null;
  const THRESH = 2; // metres
  let total = 0, ref = elev[0].y;
  for (let i = 1; i < elev.length; i++) {
    const v = elev[i].y;
    if (v - ref >= THRESH) { total += v - ref; ref = v; }
    else if (v < ref) { ref = v; }
  }
  return total;
}

/* ------------------------------------------------------- time-axis helpers */

function globalStart() {
  const starts = SLOT_IDS.map(id => state.data[id] && state.data[id].firstT).filter(v => v != null);
  return starts.length ? Math.min(...starts) : 0;
}

// Convert an absolute timestamp (ms) to an x value in minutes for the chosen alignment.
function xOf(tMs, fileStart, gStart) {
  const base = state.align === 'clock' ? gStart : fileStart;
  return (tMs - base) / 60000;
}

/* ----------------------------------------------------------------- the map */

let map = null;
let mapLayers = [];
let baseLines = { a: null, b: null }; // full-track polylines, kept so we can dim them
let highlightLayers = [];             // segment overlays for the zoomed time window
let isSyncing = false;                // guards against zoom-sync feedback loops

function ensureMap() {
  if (map) return;
  map = L.map('map', { zoomControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
}

function renderMap() {
  const haveTrack = SLOT_IDS.some(id => state.data[id] && state.data[id].track.length);
  document.getElementById('map-empty').hidden = haveTrack;
  document.getElementById('map').style.display = haveTrack ? 'block' : 'none';
  if (!haveTrack) return;

  ensureMap();
  mapLayers.forEach(l => map.removeLayer(l));
  mapLayers = [];
  highlightLayers.forEach(l => map.removeLayer(l));
  highlightLayers = [];
  baseLines = { a: null, b: null };

  const allBounds = [];
  for (const id of SLOT_IDS) {
    const d = state.data[id];
    if (!d || !d.track.length) continue;
    const color = state.slots[id].color;
    const line = L.polyline(d.track, { color, weight: 3.5, opacity: 0.85 }).addTo(map);
    mapLayers.push(line);
    baseLines[id] = line;
    const start = d.track[0], end = d.track[d.track.length - 1];
    mapLayers.push(L.circleMarker(start, { radius: 5, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(map).bindTooltip(displayLabel(id) + ' — start'));
    mapLayers.push(L.circleMarker(end, { radius: 5, color: color, weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(map).bindTooltip(displayLabel(id) + ' — end'));
    allBounds.push(...d.track);
  }
  if (allBounds.length) map.fitBounds(L.latLngBounds(allBounds), { padding: [24, 24] });

  // legend
  if (map._legend) map.removeControl(map._legend);
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'leaflet-legend');
    for (const id of SLOT_IDS) {
      const d = state.data[id];
      if (!d || !d.track.length) continue;
      div.innerHTML += `<div><span class="line" style="background:${state.slots[id].color}"></span>${escapeHtml(displayLabel(id))}</div>`;
    }
    return div;
  };
  legend.addTo(map);
  map._legend = legend;
  setTimeout(() => map.invalidateSize(), 0);
}

/* Zoom/pan on one chart drives the others (they share the time axis), and the
   map highlights the track segment for the visible time window. */
function syncOtherCharts(source) {
  if (isSyncing) return;
  isSyncing = true;
  const { min, max } = source.scales.x;
  for (const m of METRICS) {
    const c = charts[m.key];
    if (c && c !== source) c.zoomScale('x', { min, max }, 'none');
  }
  isSyncing = false;
}

function updateMapHighlight(range) {
  if (!map) return;
  highlightLayers.forEach(l => map.removeLayer(l));
  highlightLayers = [];
  const active = !!range;
  for (const id of SLOT_IDS) if (baseLines[id]) baseLines[id].setStyle({ opacity: active ? 0.22 : 0.85 });
  if (!active) return;
  const gStart = globalStart();
  for (const id of SLOT_IDS) {
    const d = state.data[id];
    if (!d || !d.trackPts.length) continue;
    const seg = [];
    for (const p of d.trackPts) {
      const x = xOf(p.t, d.firstT, gStart);
      if (x >= range.min && x <= range.max) seg.push([p.lat, p.lng]);
    }
    if (seg.length > 1) highlightLayers.push(L.polyline(seg, { color: state.slots[id].color, weight: 6, opacity: 1 }).addTo(map));
  }
}

function syncMapFromChart(chart) {
  const zoomed = chart.isZoomedOrPanned && chart.isZoomedOrPanned();
  updateMapHighlight(zoomed ? { min: chart.scales.x.min, max: chart.scales.x.max } : null);
}

function resetAllZoom() {
  isSyncing = true;
  for (const m of METRICS) if (charts[m.key]) charts[m.key].resetZoom('none');
  isSyncing = false;
  updateMapHighlight(null);
}

/* --------------------------------------------------------------- the stats */

function fmt(v, digits = 0, unit = '') {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toFixed(digits) + (unit ? ' ' + unit : '');
}
function fmtDuration(s) {
  if (s == null) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}

function renderStats() {
  const loaded = SLOT_IDS.filter(id => state.data[id]);
  const panel = document.getElementById('stats-panel');
  panel.hidden = loaded.length === 0;
  if (!loaded.length) return;

  const head = ['<thead><tr><th>Metric</th>'];
  for (const id of loaded) {
    head.push(`<th><span class="swatch" style="background:${state.slots[id].color}"></span>${escapeHtml(displayLabel(id))}</th>`);
  }
  head.push('</tr></thead>');

  const rows = [
    ['Duration', d => fmtDuration(d.stats.durationS)],
    ['Distance', d => d.stats.distanceM != null ? fmt(d.stats.distanceM / 1000, 2, 'km') : '—'],
    ['Data points', d => fmt(d.stats.points)],
    ['Avg HR', d => d.stats.hr ? fmt(d.stats.hr.avg, 0, 'bpm') : '—'],
    ['Max HR', d => d.stats.hr ? fmt(d.stats.hr.max, 0, 'bpm') : '—'],
    ['Min HR', d => d.stats.hr ? fmt(d.stats.hr.min, 0, 'bpm') : '—'],
    ['Avg speed', d => d.stats.speed ? fmt(d.stats.speed.avg, 1, 'km/h') : '—'],
    ['Max speed', d => d.stats.speed ? fmt(d.stats.speed.max, 1, 'km/h') : '—'],
    ['Elev min / max', d => d.stats.elev ? `${fmt(d.stats.elev.min, 0)} / ${fmt(d.stats.elev.max, 0, 'm')}` : '—'],
    ['Ascent', d => d.stats.ascentM != null ? fmt(d.stats.ascentM, 0, 'm') : '—'],
  ];

  const body = ['<tbody>'];
  for (const [name, fn] of rows) {
    body.push('<tr><td>' + name + '</td>');
    for (const id of loaded) body.push('<td>' + fn(state.data[id]) + '</td>');
    body.push('</tr>');
  }
  body.push('</tbody>');

  document.getElementById('stats-table').innerHTML = head.join('') + body.join('');
}

/* ---------------------------------------------------- HR agreement (A vs B) */

// Linear interpolation of a {t,y} series (sorted by t) at absolute time tMs.
function sampleAt(series, tMs) {
  if (!series.length || tMs < series[0].t || tMs > series[series.length - 1].t) return null;
  let lo = 0, hi = series.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t < tMs) lo = mid + 1; else hi = mid - 1;
  }
  // lo is first index with t >= tMs
  if (series[lo].t === tMs) return series[lo].y;
  const a = series[lo - 1], b = series[lo];
  const f = (tMs - a.t) / (b.t - a.t);
  return a.y + f * (b.y - a.y);
}

/* Resample two {t,y} series onto a shared 1-second grid over their overlapping
   time window and compute difference / agreement statistics (A − B). */
function computeAgreement(serA, serB, band) {
  if (!serA.length || !serB.length) return null;
  const t0 = Math.max(serA[0].t, serB[0].t);
  const t1 = Math.min(serA[serA.length - 1].t, serB[serB.length - 1].t);
  if (t1 <= t0) return null;

  const va = [], vb = [], diffs = [];
  for (let t = t0; t <= t1; t += 1000) {
    const a = sampleAt(serA, t), b = sampleAt(serB, t);
    if (a == null || b == null) continue;
    va.push(a); vb.push(b); diffs.push(a - b);
  }
  const n = diffs.length;
  if (!n) return null;

  const mean = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
  const bias = mean(diffs);
  const sd = Math.sqrt(mean(diffs.map(d => (d - bias) ** 2)));
  return {
    n, overlapS: (t1 - t0) / 1000,
    bias,
    meanAbs: mean(diffs.map(Math.abs)),
    rmse: Math.sqrt(mean(diffs.map(d => d * d))),
    maxAbs: diffs.reduce((m, d) => Math.max(m, Math.abs(d)), 0),
    sd, loaLo: bias - 1.96 * sd, loaHi: bias + 1.96 * sd,
    r: pearson(va, vb),
    within: band != null ? diffs.filter(d => Math.abs(d) <= band).length / n : null,
    band,
  };
}

const AGREE_METRICS = [
  { key: 'hr', label: 'Heart rate', unit: 'bpm', band: 5, digits: 1, corr: true },
  { key: 'speed', label: 'Speed', unit: 'km/h', band: 1, digits: 1, corr: true },
  { key: 'elev', label: 'Elevation', unit: 'm', band: 5, digits: 0, corr: true },
  { key: 'dist', label: 'Distance', unit: 'm', band: 50, digits: 0, corr: false }, // cumulative: r is not meaningful
];

const signed = (v, digits) => (v >= 0 ? '+' : '') + v.toFixed(digits);

function renderAgreement() {
  const panel = document.getElementById('agreement-panel');
  const A = state.data.a, B = state.data.b;
  panel.hidden = !(A && B);
  if (!(A && B)) return;

  const labA = displayLabel('a'), labB = displayLabel('b');

  // Agreement table — one row per metric (heart rate included, like the rest)
  const cols = ['Metric', 'Mean diff (A−B)', 'Mean abs', 'RMSE', 'Max diff', 'r', '95% limits', 'Within'];
  const head = '<thead><tr>' + cols.map(c => `<th>${escapeHtml(c)}</th>`).join('') + '</tr></thead>';
  const rows = [];
  for (const m of AGREE_METRICS) {
    const name = `${m.label} (${m.unit})`;
    const ag = computeAgreement(A.series[m.key], B.series[m.key], m.band);
    if (!ag) { rows.push(`<tr><td>${name}</td><td colspan="7">no overlap</td></tr>`); continue; }
    const cells = [
      signed(ag.bias, m.digits),
      ag.meanAbs.toFixed(m.digits),
      ag.rmse.toFixed(m.digits),
      ag.maxAbs.toFixed(m.digits),
      m.corr && ag.r != null ? ag.r.toFixed(3) : '—',
      `${signed(ag.loaLo, m.digits)} … ${signed(ag.loaHi, m.digits)}`,
      ag.within != null ? `${(100 * ag.within).toFixed(0)}% (±${ag.band})` : '—',
    ];
    rows.push(`<tr><td>${name}</td>` + cells.map(c => `<td>${c}</td>`).join('') + '</tr>');
  }
  document.getElementById('agreement-table').innerHTML = head + '<tbody>' + rows.join('') + '</tbody>';

  const ov = computeAgreement(A.series.hr, B.series.hr, 5) || computeAgreement(A.series.elev, B.series.elev, 5);
  document.getElementById('agreement-note').innerHTML =
    `“Mean diff (A−B)” is ${escapeHtml(labA)} minus ${escapeHtml(labB)}; positive means ${escapeHtml(labA)} reads higher. ` +
    `Computed on a 1-second grid over the overlapping window` +
    (ov ? ` (${fmtDuration(ov.overlapS)})` : '') + `. ` +
    `“95% limits of agreement” = mean ± 1.96·SD of the differences (Bland–Altman). ` +
    `A constant offset (common for elevation/distance) shows as a large mean diff even when correlation is high.`;
}

function pearson(a, b) {
  const n = a.length;
  if (n < 2) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    cov += x * y; da += x * x; db += y * y;
  }
  if (da === 0 || db === 0) return null;
  return cov / Math.sqrt(da * db);
}

/* -------------------------------------------------------------- the charts */

const charts = {};
const METRICS = [
  { key: 'hr', canvas: 'chart-hr', yLabel: 'bpm' },
  { key: 'speed', canvas: 'chart-speed', yLabel: 'km/h' },
  { key: 'elev', canvas: 'chart-elev', yLabel: 'm' },
];

function registerChartExtras() {
  if (window.ChartZoom) Chart.register(window.ChartZoom);

  // Custom interaction mode: the point nearest the cursor's x within EACH dataset.
  // This makes the tooltip show both series at the hovered time, instead of the
  // built-in 'nearest'+axis:'x' which ignores vertical distance and always
  // favours one dataset on ties.
  Chart.Interaction.modes.xAll = function (chart, e, options, useFinalPosition) {
    const pos = Chart.helpers.getRelativePosition(e, chart);
    const items = [];
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;
      const els = meta.data;
      let best = -1, bestD = Infinity;
      for (let i = 0; i < els.length; i++) {
        const d = Math.abs(els[i].getProps(['x'], useFinalPosition).x - pos.x);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) items.push({ element: els[best], datasetIndex: di, index: best });
    });
    return items;
  };
}

function datasetsFor(metricKey, gStart) {
  const out = [];
  for (const id of SLOT_IDS) {
    const d = state.data[id];
    if (!d) continue;
    const pts = d.series[metricKey];
    if (!pts.length) continue;
    out.push({
      label: displayLabel(id),
      borderColor: state.slots[id].color,
      backgroundColor: state.slots[id].color,
      data: pts.map(p => ({ x: xOf(p.t, d.firstT, gStart), y: p.y })),
      borderWidth: 1.6,
      pointRadius: 0,
      pointHitRadius: 6,
      tension: 0,
      spanGaps: true,
    });
  }
  return out;
}

function renderCharts() {
  const anyData = SLOT_IDS.some(id => state.data[id]);
  document.getElementById('charts-panel').hidden = !anyData;
  if (!anyData) return;

  applyChartColors();
  const gStart = globalStart();
  const xTitle = state.align === 'clock' ? 'Elapsed time (min, shared clock)' : 'Time from each start (min)';

  for (const m of METRICS) {
    const datasets = datasetsFor(m.key, gStart);
    const container = document.querySelector(`[data-metric="${m.key}"]`);
    container.hidden = datasets.length === 0;
    if (charts[m.key]) { charts[m.key].destroy(); charts[m.key] = null; }
    if (!datasets.length) continue;

    charts[m.key] = new Chart(document.getElementById(m.canvas), {
      type: 'line',
      data: { datasets },
      options: {
        parsing: false,
        normalized: true,
        animation: false,
        maintainAspectRatio: false,
        interaction: { mode: 'xAll', intersect: false },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: xTitle },
            ticks: { maxTicksLimit: 12, callback: v => Number(v).toFixed(0) },
          },
          y: { title: { display: true, text: m.yLabel } },
        },
        plugins: {
          legend: { display: true, position: 'top', labels: { boxWidth: 14, boxHeight: 3 } },
          zoom: {
            // Pan needs Hammer.js (loaded before this plugin). Drag = pan,
            // Shift+drag = zoom a range, Ctrl+scroll = zoom in/out.
            zoom: {
              drag: { enabled: true, modifierKey: 'shift', backgroundColor: 'rgba(31,111,235,0.15)', borderColor: 'rgba(31,111,235,0.6)', borderWidth: 1 },
              wheel: { enabled: true, modifierKey: 'ctrl' }, // ctrl so plain scroll still scrolls the page
              pinch: { enabled: true },
              mode: 'x',
              onZoom: ({ chart }) => syncOtherCharts(chart),
              onZoomComplete: ({ chart }) => { syncOtherCharts(chart); syncMapFromChart(chart); },
            },
            pan: { // plain drag pans (requires Hammer)
              enabled: true, mode: 'x',
              onPan: ({ chart }) => syncOtherCharts(chart),
              onPanComplete: ({ chart }) => { syncOtherCharts(chart); syncMapFromChart(chart); },
            },
            limits: { x: { min: 'original', max: 'original' } }, // can't pan/zoom past the data
          },
          tooltip: {
            callbacks: {
              title: items => items.length ? `${Number(items[0].parsed.x).toFixed(1)} min` : '',
              label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(m.key === 'hr' ? 0 : 1)} ${m.yLabel}`,
            },
          },
        },
      },
    });

    document.getElementById(m.canvas).ondblclick = resetAllZoom;
  }
}

/* --------------------------------------------------------------- rendering */

function renderAll() {
  renderMap();
  renderStats();
  renderAgreement();
  renderCharts();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* --------------------------------------------------------------- wiring up */

async function handleFile(slotId, file) {
  const slotEl = document.querySelector(`.slot[data-slot="${slotId}"]`);
  const nameEl = slotEl.querySelector('[data-role="filename"]');
  const errEl = slotEl.querySelector('[data-role="err"]');
  errEl.hidden = true;
  nameEl.textContent = 'Reading ' + file.name + '…';
  nameEl.classList.remove('empty');
  try {
    const buf = await file.arrayBuffer();
    const data = await parseFit(buf);
    const result = computeSeries(data, file.name);
    if (!result.stats.points) throw new Error('No record data found in this file.');
    state.data[slotId] = result;
    nameEl.textContent = `${file.name} — ${result.stats.points.toLocaleString()} points`;
    renderAll();
  } catch (e) {
    state.data[slotId] = null;
    nameEl.textContent = 'No file loaded';
    nameEl.classList.add('empty');
    errEl.textContent = 'Could not read this file: ' + (e && e.message ? e.message : e);
    errEl.hidden = false;
    renderAll();
  }
}

function wireSlot(slotId) {
  const slotEl = document.querySelector(`.slot[data-slot="${slotId}"]`);
  const colorEl = slotEl.querySelector('[data-role="color"]');
  const labelEl = slotEl.querySelector('[data-role="label"]');
  const fileEl = slotEl.querySelector('[data-role="file"]');
  const dropEl = slotEl.querySelector('[data-role="dropzone"]');

  colorEl.value = state.slots[slotId].color;
  labelEl.value = state.slots[slotId].label;

  colorEl.addEventListener('input', () => { state.slots[slotId].color = colorEl.value; saveSettings(); renderAll(); });
  labelEl.addEventListener('input', () => { state.slots[slotId].label = labelEl.value.trim() || DEFAULTS[slotId].label; saveSettings(); renderAll(); });

  dropEl.addEventListener('click', () => fileEl.click());
  fileEl.addEventListener('change', () => { if (fileEl.files[0]) handleFile(slotId, fileEl.files[0]); });

  ['dragenter', 'dragover'].forEach(ev => dropEl.addEventListener(ev, e => { e.preventDefault(); slotEl.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(ev => dropEl.addEventListener(ev, e => { e.preventDefault(); slotEl.classList.remove('dragover'); }));
  dropEl.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) handleFile(slotId, f); });
}

function init() {
  if (typeof FitParser !== 'function') {
    document.querySelector('main').innerHTML = '<p style="color:var(--danger)">Failed to load the FIT parser (vendor/fit-parser.js). Make sure the vendor/ folder is next to this page.</p>';
    return;
  }
  registerChartExtras();
  loadSettings();

  applyTheme(state.theme);
  const themeSel = document.getElementById('theme-select');
  themeSel.value = state.theme;
  themeSel.addEventListener('change', () => { applyTheme(themeSel.value); saveSettings(); });
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (state.theme === 'auto') applyTheme('auto'); // re-tint charts when OS theme flips
    });
  }

  SLOT_IDS.forEach(wireSlot);
  document.querySelectorAll('input[name="align"]').forEach(el => {
    el.checked = el.value === state.align;
    el.addEventListener('change', () => { if (el.checked) { state.align = el.value; saveSettings(); renderAll(); } });
  });
}

document.addEventListener('DOMContentLoaded', init);
