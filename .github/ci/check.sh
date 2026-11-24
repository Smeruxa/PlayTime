#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

lane="${1:?Expected a CI lane}"
case "$lane" in
    services|frontend|site|mobile|android|archive) ;;
    *)
        echo "Unknown CI lane: $lane" >&2
        exit 2
        ;;
esac

if [[ "$lane" == services ]]; then
    IFS=' ' read -r -a service_scopes <<< "${CI_SERVICE_SCOPES-auth-api chat-api room-api gateway shared database}"
    if ((${#service_scopes[@]} == 0)); then
        echo 'Expected at least one server scope' >&2
        exit 2
    fi
    service_lint_paths=()
    for scope in "${service_scopes[@]}"; do
        case "$scope" in
            auth-api|chat-api|room-api|gateway|shared|database)
                service_lint_paths+=("apps/$scope/**/*.ts")
                ;;
            *)
                echo "Unknown server scope: $scope" >&2
                exit 2
                ;;
        esac
    done
fi

export DOTENV_CONFIG_PATH=/dev/null
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
export VITE_API_BASE=/playtime
export VITE_PROXY_TARGET=http://127.0.0.1:1501
unset DOCKER_HOST DOCKER_CONTEXT

android_setting() {
    local value
    value=$(sed -nE "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\"?([0-9.]+)\"?[[:space:]]*$/\1/p" mobile/android/build.gradle)
    if [[ ! "$value" =~ ^[0-9]+(\.[0-9]+)*$ ]]; then
        echo "Missing Android SDK setting: $1" >&2
        return 1
    fi
    printf '%s\n' "$value"
}

has_service() {
    [[ " ${service_scopes[*]} " == *" $1 "* ]]
}

test_service_security() {
    if has_service auth-api && has_service chat-api && has_service room-api && has_service gateway; then
        npm run test:security
        return
    fi

    local tests=(scripts/tests/security.test.cjs)
    if has_service auth-api; then
        tests+=(scripts/tests/login-security.test.cjs scripts/tests/logout-security.test.cjs)
    fi
    if has_service chat-api; then
        tests+=(scripts/tests/room-wrap-security.test.cjs)
    fi
    if has_service room-api || has_service gateway; then
        tests+=(scripts/tests/voice-packet-security.test.ts)
    fi
    if has_service chat-api || has_service room-api || has_service gateway; then
        tests+=(scripts/tests/peer-block-security.test.cjs)
    fi
    node --import tsx --test --test-timeout=15000 "${tests[@]}"
}

test_direct_calls() (
    password=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')
    redis=$(docker run --rm -d -p 127.0.0.1:16389:6379 redis:7-alpine \
        redis-server --save '' --appendonly no --requirepass "$password")
    trap 'docker rm -f "$redis" >/dev/null' EXIT
    for ((attempt = 0; attempt < 80; attempt++)); do
        if [[ "$(docker exec -e "REDISCLI_AUTH=$password" "$redis" redis-cli ping)" == PONG ]]; then
            url="redis://:$password@127.0.0.1:16389"
            PLAYTIME_TEST_REDIS_URL="$url/0" npm run test:direct-calls
            CALL_OWNERSHIP_TEST_REDIS_URL="$url/1" node --import tsx --test scripts/tests/call-ownership.test.cjs
            exit 0
        fi
        sleep 0.25
    done
    echo 'Direct call Redis did not become ready' >&2
    exit 1
)

if [[ "${PLAYTIME_CI_USE_INSTALLED:-0}" != 1 ]]; then
    if [[ "$lane" != android ]]; then
        npm ci
        (cd apps && npm ci)
    fi
    case "$lane" in
        site|archive) npm ci --prefix apps/site ;;
        mobile|android) npm ci --prefix mobile ;;
    esac
    case "$lane" in
        services|frontend|site) ./node_modules/.bin/playwright install --with-deps chromium ;;
    esac
fi

case "$lane" in
    services)
        printf 'Server scopes: %s\n' "${service_scopes[*]}"
        npm run typecheck:services
        ./node_modules/.bin/eslint "${service_lint_paths[@]}"
        test_service_security
        if has_service auth-api && has_service gateway; then
            npm run test:account-security
            npm run test:web:server
        elif has_service auth-api; then
            node --import tsx --test scripts/tests/key-backup.test.ts
            node --test scripts/tests/guest-auth.test.cjs scripts/tests/retryable-auth.test.cjs \
                scripts/tests/email-code-races.test.cjs scripts/tests/smtp-transport.test.cjs
        elif has_service gateway; then
            node --import tsx --test scripts/tests/admin-whitelist.test.ts scripts/tests/site-admin-auth.test.ts
            node --test scripts/tests/web-delivery.test.cjs
        fi
        if has_service gateway; then
            npm run test:push
        fi
        docker context inspect --format '{{.Endpoints.docker.Host}}' | grep -q '^unix://'
        if [[ "${PLAYTIME_CI_USE_INSTALLED:-0}" != 1 ]]; then
            docker pull postgres:15-alpine
            docker pull redis:7-alpine
            docker pull coturn/coturn:4.6.3
        fi
        if has_service room-api; then
            test_direct_calls
        fi
        if has_service auth-api; then
            npm run test:web:integration
            bash .github/ci/guest-lifecycle.sh
        fi
        if has_service gateway; then
            npm run test:push:integration
            node --test scripts/tests/billing-integration.test.cjs
        fi
        npm run test:services
        ;;
    frontend)
        ./node_modules/.bin/tsc --noEmit
        ./node_modules/.bin/eslint "apps/frontend/src/**/*.{ts,tsx,js,jsx}" "apps/frontend/public/*.js"
        npm run react-test -- --ci --runInBand
        npm run test:screen-capture
        npm run web:build
        export WEB_APP_SCREENSHOT_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/playtime-web-app"
        export WEB_PLATFORM_SCREENSHOT_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/playtime-web-platform"
        WEB_APP_UI_BUILD=1 npm run test:web:ui
        npm run test:web:platform
        npm run test:web:keys
        ;;
    site)
        npm run lint --prefix apps/site
        npm run build:web-site
        export WEB_SCREENSHOT_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/playtime-web-landing"
        export SITE_VISITS_SCREENSHOT_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/playtime-site-visits"
        npm run test:web:landing
        node scripts/tests/site-visits-ui.cjs
        ;;
    mobile)
        npm run check --prefix mobile
        npm test --prefix mobile
        ;;
    android)
        export JAVA_HOME="${JAVA_HOME_17_X64:-${JAVA_HOME:?JDK 17 is required}}"
        export PATH="$JAVA_HOME/bin:$PATH"
        export ANDROID_HOME="${ANDROID_HOME:?Android SDK is required}"
        sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
        compile_sdk=$(android_setting compileSdkVersion)
        if [[ "$compile_sdk" =~ ^[0-9]+$ ]] && (( compile_sdk >= 37 )); then
            compile_sdk="$compile_sdk.0"
        fi
        build_tools=$(android_setting buildToolsVersion)
        ndk_version=$(android_setting ndkVersion)
        "$sdkmanager" "platforms;android-$compile_sdk" "build-tools;$build_tools" "ndk;$ndk_version" 'cmake;3.22.1'
        npm run format:android:check --prefix mobile
        npm run lint:android --prefix mobile -- \
            -PplaytimeApiBase=http://127.0.0.1:1501/playtime -PplaytimeSocketUrl=http://127.0.0.1:1501
        ;;
    archive)
        for script in deploy_backend/*.sh; do bash -n "$script"; done
        npm run test:release
        npm run build:web-site
        stage="$(mktemp -d)"
        trap 'rm -rf -- "$stage"' EXIT
        PYTHONPYCACHEPREFIX="$stage/pycache" python3 -m py_compile \
            deploy_backend/*.py deploy_backend/disaster-recovery/*.py deploy_backend/standby-redis/*.py
        PYTHONPYCACHEPREFIX="$stage/pycache" python3 -m unittest discover -s deploy_backend -p 'test_*.py'
        kubectl kustomize deploy/k8s/base > "$stage/k8s-base.yaml"
        kubectl kustomize deploy/k8s/migrations > "$stage/k8s-migrations.yaml"
        kubectl kustomize deploy/k8s/two-vps > "$stage/k8s-two-vps.yaml"
        kubectl kustomize deploy/k8s/two-vps/migrations > "$stage/k8s-two-vps-migrations.yaml"
        test -s "$stage/k8s-base.yaml"
        test -s "$stage/k8s-migrations.yaml"
        test -s "$stage/k8s-two-vps.yaml"
        test -s "$stage/k8s-two-vps-migrations.yaml"
        node scripts/package-backend.cjs "$stage/runtime"
        COPYFILE_DISABLE=1 tar --no-xattrs -czf "$stage/backend.tar.gz" -C "$stage/runtime" .
        mkdir "$stage/unpacked"
        tar -xzf "$stage/backend.tar.gz" -C "$stage/unpacked"
        for file in server.ts database/schema.sql scripts/runMigrations.ts scripts/grantRuntimePrivileges.ts site/dist/index.html site/dist/app/index.html; do
            test -s "$stage/unpacked/$file"
        done
        cmp apps/package-lock.json "$stage/unpacked/package-lock.json"
        (
            cd "$stage/unpacked"
            npm ci
            node --import tsx scripts/configureAdminAccess.ts --help
        )
        ;;
esac
