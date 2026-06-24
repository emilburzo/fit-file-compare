#!/usr/bin/env bash
# Build the image, run it, and execute the browser regression suites against it
# locally — the same thing CI does. Usage: tests/run-local.sh
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=fit-file-compare:test
NAME=fit-file-compare-localtest
PORT=8080

docker build -t "$IMAGE" .
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -p "$PORT:8080" "$IMAGE" >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

cd tests
[ -d node_modules ] || npm install
npx playwright install chromium >/dev/null 2>&1 || npx playwright install --with-deps chromium

for _ in $(seq 1 30); do curl -fsS "http://localhost:$PORT/" >/dev/null 2>&1 && break; sleep 1; done

BASE_URL="http://localhost:$PORT/" npm test
