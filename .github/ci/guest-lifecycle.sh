#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
unset DOCKER_HOST DOCKER_CONTEXT
docker context inspect --format '{{.Endpoints.docker.Host}}' | grep -q '^unix://'

password=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')
cleanup() {
    local containers=()
    if [[ -n "${redis:-}" ]]; then containers+=("$redis"); fi
    if [[ -n "${postgres:-}" ]]; then containers+=("$postgres"); fi
    if ((${#containers[@]})); then docker rm -f "${containers[@]}" >/dev/null; fi
}
trap cleanup EXIT

postgres=$(docker run --rm -d -p 127.0.0.1::5432 \
    -e POSTGRES_USER=playtime_test -e POSTGRES_DB=guest_lifecycle_test \
    -e "POSTGRES_PASSWORD=$password" postgres:15-alpine)
redis=$(docker run --rm -d -p 127.0.0.1::6379 redis:7-alpine \
    redis-server --save '' --appendonly no --requirepass "$password")

for ((attempt = 0; attempt < 80; attempt++)); do
    if docker exec "$postgres" pg_isready -h 127.0.0.1 -U playtime_test -d guest_lifecycle_test >/dev/null &&
        [[ "$(docker exec -e "REDISCLI_AUTH=$password" "$redis" redis-cli ping)" == PONG ]]; then
        pg_address=$(docker port "$postgres" 5432/tcp)
        redis_address=$(docker port "$redis" 6379/tcp)
        NODE_ENV=test DOTENV_CONFIG_PATH=/dev/null GUEST_LIFECYCLE_TEST_DATABASE=isolated \
            PG_HOST=127.0.0.1 PG_PORT="${pg_address##*:}" PG_USER=playtime_test \
            PG_DATABASE=guest_lifecycle_test PG_PASSWORD="$password" \
            REDIS_URL="redis://:$password@$redis_address/0" JWT_SECRET_ENV=isolated-guest-lifecycle-ci \
            node --import tsx --test scripts/tests/guest-lifecycle.test.cjs
        exit 0
    fi
    sleep 0.25
done

echo 'Guest lifecycle PostgreSQL or Redis did not become ready' >&2
exit 1
