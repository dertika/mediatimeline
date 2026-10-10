#!/usr/bin/env bash
# Starts the Immich mock and the real backend (built with `npm run build -w backend`)
# and creates two links: a public one and one with the password "fjord".
# Prints PUBLIC_LINK=… and PASSWORD_LINK=… for $GITHUB_ENV.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$here/../.."
data="$(mktemp -d)"

node "$here/immich-mock.mjs" >"$data/immich.log" 2>&1 &
MEDIATIMELINE_CONFIG="$here/config.yaml" MEDIATIMELINE_DATA_DIR="$data" \
  node --disable-warning=ExperimentalWarning "$root/backend/dist/index.js" >"$data/backend.log" 2>&1 &

base=http://127.0.0.1:8080
for _ in $(seq 1 50); do
  curl -sf "$base/api/admin/me" -H "Remote-User: e2e" >/dev/null && break
  sleep 0.2
done

admin() { curl -sf -H "Remote-User: e2e" -H "content-type: application/json" "$@"; }
share() { admin -X POST "$base/api/admin/shares" -d '{"albumId":"album-1"}'; }
field() { node -e "const s=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(s.$1)"; }

public="$(share)"
admin -X PATCH "$base/api/admin/shares/$(echo "$public" | field id)" \
  -d '{"accent":"ozean","showComments":true,"captionSource":"descriptionOrFirstComment","tripStart":{"name":"Hamburg","lat":53.55,"lng":9.99}}' >/dev/null
protected="$(share)"
admin -X PATCH "$base/api/admin/shares/$(echo "$protected" | field id)" -d '{"password":"fjord"}' >/dev/null

# The simulator reaches the Mac as localhost; plain http is allowed there (NSAllowsLocalNetworking).
echo "PUBLIC_LINK=http://localhost:8080/t/$(echo "$public" | field "url.split('/t/')[1]")"
echo "PASSWORD_LINK=http://localhost:8080/t/$(echo "$protected" | field "url.split('/t/')[1]")"
echo "E2E_LOGS=$data"
