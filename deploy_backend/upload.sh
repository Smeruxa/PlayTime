#!/usr/bin/env bash

set -euo pipefail
if [[ "${1:-}" != "--legacy" && "${DEPLOY_DRY_RUN:-0}" != "1" ]]; then
    echo "Production использует npm run deploy:backend. Для отдельной старой среды передайте --legacy." >&2
    exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SITE_DIR="$REPO_ROOT/apps/site"
ENV_FILE="$SCRIPT_DIR/.env"

if [[ "${DEPLOY_DRY_RUN:-0}" != "1" ]]; then
    if [[ ! -f "$ENV_FILE" ]]; then
        echo "Нет файла $ENV_FILE. Скопируйте deploy_backend/env.example в deploy_backend/.env и заполните." >&2
        exit 1
    fi
    set -a
    source "$ENV_FILE"
    set +a
fi

DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_DRY_RUN="${DEPLOY_DRY_RUN:-0}"
DEPLOY_METHOD="${DEPLOY_METHOD:-tar}"
DEPLOY_SERVICE_MANAGER="${DEPLOY_SERVICE_MANAGER:-pm2}"
DEPLOY_PM2_RESTART="${DEPLOY_PM2_RESTART:-1}"

case "$DEPLOY_METHOD" in
    tar|rsync) ;;
    *)
        echo "Неизвестный DEPLOY_METHOD=$DEPLOY_METHOD. Допустимо: tar или rsync." >&2
        exit 1
        ;;
esac

if [[ "$DEPLOY_DRY_RUN" != "1" ]]; then
    : "${DEPLOY_HOST:?В .env не задана переменная DEPLOY_HOST}"
    : "${DEPLOY_USER:?В .env не задана переменная DEPLOY_USER}"
    : "${DEPLOY_REMOTE_PATH:?В .env не задана переменная DEPLOY_REMOTE_PATH}"
    : "${DEPLOY_KNOWN_HOSTS:?Укажите DEPLOY_KNOWN_HOSTS}"
    [[ -f "$DEPLOY_KNOWN_HOSTS" && -r "$DEPLOY_KNOWN_HOSTS" ]] || { echo "Файл DEPLOY_KNOWN_HOSTS недоступен." >&2; exit 1; }
    SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
    SSH_BASE=(ssh -F /dev/null -p "$DEPLOY_PORT" -o BatchMode=yes -o StrictHostKeyChecking=yes
        -o GlobalKnownHostsFile=none -o "UserKnownHostsFile=\"$DEPLOY_KNOWN_HOSTS\"" -o UpdateHostKeys=no)
    if [[ -n "${DEPLOY_SSH_KEY:-}" ]]; then
        SSH_BASE+=(-i "$DEPLOY_SSH_KEY" -o IdentitiesOnly=yes)
    fi
    "${SSH_BASE[@]}" "$SSH_TARGET" 'test ! -d /etc/playtime-cluster || { echo "Legacy deployment is unavailable on the Kubernetes production nodes." >&2; exit 1; }'
    if [[ "$DEPLOY_METHOD" == "rsync" ]] && ! command -v rsync >/dev/null 2>&1; then
        echo "Не найден rsync. Установите его или задайте DEPLOY_METHOD=tar." >&2
        exit 1
    fi
fi

if [[ "${DEPLOY_SKIP_SITE_BUILD:-0}" != "1" ]]; then
    if [[ "${DEPLOY_SITE_NPM_CI:-0}" == "1" ]]; then
        npm ci --prefix "$SITE_DIR"
    fi
    npm run build:web-site --prefix "$REPO_ROOT"
fi

STAGING_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/playtime-backend.XXXXXXXX")
STAGING_DIR="$STAGING_ROOT/runtime"
ARCHIVE="$STAGING_ROOT/backend.tar.gz"
SERVICE_STOPPED=0

cleanup() {
    if [[ "$SERVICE_STOPPED" == "1" ]]; then
        "${SSH_BASE[@]}" "$SSH_TARGET" "systemctl start playtime" || true
    fi
    if [[ "${DEPLOY_KEEP_SITE_STAGING:-0}" == "1" ]]; then
        echo "Локальная сборка: $STAGING_ROOT"
    else
        rm -rf -- "$STAGING_ROOT"
    fi
}
trap cleanup EXIT

node "$REPO_ROOT/scripts/package-backend.cjs" "$STAGING_DIR"
if [[ "$DEPLOY_METHOD" == "tar" || "$DEPLOY_DRY_RUN" == "1" ]]; then
    COPYFILE_DISABLE=1 tar --no-xattrs -czf "$ARCHIVE" -C "$STAGING_DIR" .
fi

if [[ "$DEPLOY_DRY_RUN" == "1" ]]; then
    echo "Состав локального архива (первые 120 записей):"
    tar -tzf "$ARCHIVE" | sed -n '1,120p'
    exit 0
fi

REMOTE_PATH_Q=$(printf "%q" "$DEPLOY_REMOTE_PATH")
echo "Цель: $SSH_TARGET:$DEPLOY_REMOTE_PATH/"
echo "Способ: $DEPLOY_METHOD"

if [[ "$DEPLOY_SERVICE_MANAGER" == "systemd" && "$DEPLOY_PM2_RESTART" == "1" ]]; then
    "${SSH_BASE[@]}" "$SSH_TARGET" "systemctl stop playtime"
    SERVICE_STOPPED=1
fi

if [[ "$DEPLOY_METHOD" == "rsync" ]]; then
    RSYNC_FLAGS=(
        -avz
        "--exclude=node_modules"
        "--exclude=/data/"
        "--exclude=.git"
        "--exclude=.env*"
        "--exclude=.secrets"
        "--exclude=/site/dist-backup-*/"
        "--exclude=/site/.upload-*/"
        "--exclude=*.log"
        "--exclude=.DS_Store"
        "--exclude=._*"
        "--filter=P *.key"
        "--filter=P *.pem"
    )
    if [[ "${DEPLOY_RSYNC_DELETE:-0}" == "1" ]]; then
        RSYNC_FLAGS+=(--delete)
    fi
    printf -v RSYNC_RSH '%q ' "${SSH_BASE[@]}"
    rsync "${RSYNC_FLAGS[@]}" -e "$RSYNC_RSH" "$STAGING_DIR/" "$SSH_TARGET:$DEPLOY_REMOTE_PATH/"
else
    REMOTE_SCRIPT="umask 022 && mkdir -p ${REMOTE_PATH_Q} && cd ${REMOTE_PATH_Q} && tar --no-same-owner --no-same-permissions -xzf -"
    "${SSH_BASE[@]}" "$SSH_TARGET" "$REMOTE_SCRIPT" < "$ARCHIVE"
fi

if [[ "$DEPLOY_PM2_RESTART" == "1" ]]; then
    echo "Установка зависимостей и перезапуск сервиса…"
    "${SSH_BASE[@]}" "$SSH_TARGET" "bash -s" <<REMOTE
set -euo pipefail
export NVM_DIR="\$HOME/.nvm"
[ -s "\$NVM_DIR/nvm.sh" ] && . "\$NVM_DIR/nvm.sh"
if [[ "$DEPLOY_SERVICE_MANAGER" == "systemd" ]]; then
    export PATH="/opt/playtime/bin:\$PATH"
fi
cd ${REMOTE_PATH_Q}
npm ci --include=dev
if [[ "$DEPLOY_SERVICE_MANAGER" == "systemd" ]]; then
    set -a
    . /etc/playtime/migrations.env
    set +a
    npm run migrate
    node --import tsx scripts/grantRuntimePrivileges.ts
    systemctl restart playtime
    ready=0
    for attempt in \$(seq 1 20); do
        if curl --fail --silent http://127.0.0.1:1501/playtime/health >/dev/null; then
            ready=1
            break
        fi
        sleep 1
    done
    if [[ "\$ready" != "1" ]]; then
        systemctl status playtime --no-pager
        exit 1
    fi
    exit 0
fi
if ! command -v pm2 >/dev/null 2>&1; then
    npm install -g pm2
fi
pm2 startOrRestart ecosystem.config.cjs --update-env
pm2 save
REMOTE
fi

SERVICE_STOPPED=0
echo "Готово. Лендинг: https://smeruxa.ru/playtime/"
