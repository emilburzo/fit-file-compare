// Runs every browser regression suite in its own process (each suite calls
// process.exit, so they can't share one) and fails if any suite fails.
const { spawnSync } = require('child_process');

const SUITES = [
  'test.js',        // core parsing + ground-truth values
  'test2.js',       // label persistence + time-axis alignment
  'test3.js',       // zoom/pan gestures, both-series tooltip, agreement table
  'test4_sync.js',  // chart-to-chart + map highlight sync
  'test5_theme.js', // light/dark/auto theming
];

let failed = 0;
for (const suite of SUITES) {
  console.log(`\n========================= ${suite} =========================`);
  const r = spawnSync(process.execPath, [suite], { stdio: 'inherit', cwd: __dirname });
  if (r.status !== 0) { failed++; console.log(`>>> ${suite} FAILED (exit ${r.status})`); }
}

console.log(`\n=========================================================`);
console.log(failed ? `${failed}/${SUITES.length} suite(s) FAILED` : `All ${SUITES.length} suites passed`);
process.exit(failed ? 1 : 0);
