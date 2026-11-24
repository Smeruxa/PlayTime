ARG PLAYTIME_REDIS_BASE=ubuntu:26.04@sha256:d66b366dac61b575bee2aef07e9c26e8070096fbe84a3d4d3eb0da069b5d76db
FROM ${PLAYTIME_REDIS_BASE}
ARG PLAYTIME_REDIS_PACKAGE=5:8.0.5-1ubuntu0.1
RUN apt-get update \
    && apt-get install -y --no-install-recommends "redis-server=${PLAYTIME_REDIS_PACKAGE}" "redis-tools=${PLAYTIME_REDIS_PACKAGE}" \
    && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["/bin/sh", "-ec", "exec setpriv --reuid=12001 --regid=12001 --clear-groups /usr/bin/redis-server - < /run/playtime/redis.conf"]
