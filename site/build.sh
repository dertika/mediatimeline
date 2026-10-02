#!/usr/bin/env bash
# Builds the GitHub Pages site: project page, live demo and tour videos.
#
#   site/build.sh [output dir]          (default: _site)
#
# Env: BASE_PATH (default /mediatimeline), SITE_URL, DEMO_OFFLINE=1 for
# placeholder photos, plus the variables of scripts/record-tour.mjs.
# Needs Node.js, ffmpeg and Playwright.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$(realpath -m "${1:-_site}")"
export BASE_PATH="${BASE_PATH:-/mediatimeline}"
export SITE_URL="${SITE_URL:-https://dertika.github.io${BASE_PATH}}"

echo "== Demo-App bauen (${BASE_PATH})"
BASE_PATH="$BASE_PATH" SPA_FALLBACK=404.html VITE_DEMO=1 npm run build -w frontend --prefix "$root"
rm -rf "$out"
cp -r "$root/frontend/build" "$out"
# GitHub Pages answers unknown paths with 404.html, the SPA entry point;
# the demo gets a real page so that it loads with status 200.
mkdir -p "$out/demo"
cp "$out/404.html" "$out/demo/index.html"
touch "$out/.nojekyll"

echo "== Demo-Daten"
node "$root/site/scripts/demo-data.mjs" "$out/demo-data"

echo "== Tour aufnehmen"
node "$root/site/scripts/record-tour.mjs" "$out"

echo "== Projektseite"
node "$root/site/scripts/render-page.mjs" "$out"
du -sh "$out"
