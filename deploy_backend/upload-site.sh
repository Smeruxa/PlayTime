#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" != "--legacy" ]]; then
    echo "Production использует npm run deploy:backend. Для отдельной старой среды передайте --legacy." >&2
    exit 2
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
set -a
source "$SCRIPT_DIR/.env"
set +a
: "${DEPLOY_HOST:?DEPLOY_HOST is required}"
: "${DEPLOY_USER:?DEPLOY_USER is required}"
: "${DEPLOY_REMOTE_PATH:?DEPLOY_REMOTE_PATH is required}"
: "${DEPLOY_KNOWN_HOSTS:?DEPLOY_KNOWN_HOSTS is required}"
[[ -f "$DEPLOY_KNOWN_HOSTS" && -r "$DEPLOY_KNOWN_HOSTS" ]] || { echo "DEPLOY_KNOWN_HOSTS is unreadable." >&2; exit 1; }
SSH=(ssh -F /dev/null -p "${DEPLOY_PORT:-22}" -o BatchMode=yes -o StrictHostKeyChecking=yes
    -o GlobalKnownHostsFile=none -o "UserKnownHostsFile=\"$DEPLOY_KNOWN_HOSTS\"" -o UpdateHostKeys=no -o ConnectTimeout=30)
if [[ -n "${DEPLOY_SSH_KEY:-}" ]]; then
    SSH+=(-i "$DEPLOY_SSH_KEY" -o IdentitiesOnly=yes)
fi
"${SSH[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" 'test ! -d /etc/playtime-cluster || { echo "Legacy publication is unavailable on the Kubernetes production nodes." >&2; exit 1; }'
npm run build:web-site --prefix "$REPO_ROOT"
for asset in "$REPO_ROOT/apps/site/dist/assets/"*.js; do
    if grep -qE 'VITE_ADMIN_BOOTSTRAP_SECRET|X-Admin-Bootstrap-Secret' "$asset"; then
        echo "Refusing to publish a build containing the retired admin bootstrap mechanism." >&2
        exit 1
    fi
done
STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
REMOTE_STAGE_Q=$(printf '%q' "${DEPLOY_REMOTE_PATH}/site/.upload-${STAMP}")
REMOTE_DIST_Q=$(printf '%q' "${DEPLOY_REMOTE_PATH}/site/dist")
REMOTE_BACKUP_Q=$(printf '%q' "${DEPLOY_REMOTE_PATH}/site/dist-backup-${STAMP}")
COPYFILE_DISABLE=1 tar -czf - -C "$REPO_ROOT/apps/site/dist" . | "${SSH[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" \
    "mkdir -p ${REMOTE_STAGE_Q} && tar xzf - -C ${REMOTE_STAGE_Q}"
"${SSH[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" "bash -s -- ${REMOTE_STAGE_Q} ${REMOTE_DIST_Q} ${REMOTE_BACKUP_Q}" <<'REMOTE'
set -euo pipefail
stage="$1"
dist="$2"
backup="$3"
test -s "$stage/index.html"
test -s "$stage/app/index.html"
test -s "$dist/index.html"
cp -a "$dist" "$backup"
find "$stage" -mindepth 1 -maxdepth 1 ! -name index.html ! -name app -exec cp -a -t "$dist" {} +
mkdir -p "$dist/app"
find "$stage/app" -mindepth 1 -maxdepth 1 ! -name index.html -exec cp -a -t "$dist/app" {} +
cp "$stage/app/index.html" "$dist/app/.index-next.html"
mv -f "$dist/app/.index-next.html" "$dist/app/index.html"
cp "$stage/index.html" "$dist/.index-next.html"
mv -f "$dist/.index-next.html" "$dist/index.html"
mkdir -p "$backup/retired-public-assets"
while IFS= read -r -d '' asset; do
    if grep -q 'X-Admin-Bootstrap-Secret' "$asset"; then
        mv "$asset" "$backup/retired-public-assets/"
    fi
done < <(find "$dist/assets" -maxdepth 1 -type f -name '*.js' -print0)
rm -rf -- "$stage"
echo "Site backup: $backup"
REMOTE
echo "Published: https://smeruxa.ru/playtime/"
