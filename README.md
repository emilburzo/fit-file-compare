# fit-file-compare

A single, no-backend web page for overlaying two `.fit` recordings — built to
compare one sensor against another (e.g. **optical vs chest-strap heart rate**).

## Use it

Open `index.html` in a browser (double-click works, no server needed).

1. Pick a `.fit` file for each slot (or drag-and-drop onto a slot).
2. Optionally rename the labels and pick colors — these are remembered on this
   device, so for the next comparison you just swap the files.

The **Theme** switcher (top-right) offers Auto / Light / Dark (Auto follows your
OS); the choice is remembered too.

You get:

- a **map** with both GPS tracks overlaid in each slot's color,
- **zoomable charts** for heart rate, speed and elevation on a shared axis —
  Shift-drag (or Ctrl-scroll) to zoom into a time range, drag to pan,
  double-click to reset; the tooltip shows *both* series at the hovered time.
  Zoom/pan on any chart syncs the other two and highlights that time window on
  the map (dimming the rest of the track),
- a **stats** table, and
- an **agreement** panel with Bland–Altman style statistics (mean difference /
  bias, mean absolute difference, RMSE, max difference, correlation, 95% limits
  of agreement and % within tolerance) for heart rate, speed, elevation and
  distance — each computed by resampling both streams onto a common 1-second grid.

### Time axis

- **Wall clock** (default): both files share one real-time axis — correct when
  the two devices recorded the *same* outing simultaneously.
- **From each start**: each file starts at 0:00 — use this to compare the
  *shape* of two separate activities.

## Offline / privacy

Files are parsed entirely in your browser; nothing is uploaded. Leaflet,
Chart.js and the FIT parser are vendored in `vendor/`, so the only network use
is the OpenStreetMap map tiles.

## Files

- `index.html`, `app.js` — the app
- `vendor/` — Leaflet, Chart.js, and the bundled `fit-file-parser`
  (`vendor/fit-parser.js`, an esbuild IIFE that exposes `window.FitParser`)

