// Shared config for the browser regression suites.
// Tests run against a served instance of the app (the Docker container in CI),
// not file://, so they exercise the real artifact.
const fs = require('fs');
const path = require('path');

const ARTIFACTS = path.join(__dirname, 'artifacts');
fs.mkdirSync(ARTIFACTS, { recursive: true });

module.exports = {
  BASE_URL: (process.env.BASE_URL || 'http://localhost:8080/').replace(/\/?$/, '/'),
  FILE_A: path.join(__dirname, 'fixtures', 'garmin_optical.fit'),
  FILE_B: path.join(__dirname, 'fixtures', 'strava_with_hrm.fit'),
  shot: name => path.join(ARTIFACTS, name),
};
