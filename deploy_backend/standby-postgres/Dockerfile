FROM ubuntu:26.04
ARG POSTGRES_VERSION
RUN mkdir -p /etc/postgresql-common \
    && printf '%s\n' 'create_main_cluster = false' > /etc/postgresql-common/createcluster.conf \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        "postgresql-18=${POSTGRES_VERSION}" "postgresql-client-18=${POSTGRES_VERSION}" \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 playtime \
    && useradd --uid 10001 --gid playtime --no-create-home playtime
ENV PATH="/usr/lib/postgresql/18/bin:${PATH}"
USER 10001:10001
CMD ["postgres", "-D", "/var/lib/playtime-postgres", "-c", "config_file=/etc/playtime-postgres/postgresql.conf"]
