CREATE TABLE IF NOT EXISTS app_releases (
    id SERIAL PRIMARY KEY,
    version VARCHAR(32) NOT NULL,
    platform VARCHAR(16) NOT NULL CHECK (platform IN ('darwin', 'win32')),
    filename VARCHAR(255) NOT NULL,
    update_filename VARCHAR(255) NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    update_file_size BIGINT NULL,
    sha512 VARCHAR(128) NOT NULL,
    update_sha512 VARCHAR(128) NULL,
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    is_latest BOOLEAN NOT NULL DEFAULT FALSE,
    release_notes TEXT NULL,
    published_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    uploaded_by INT NULL REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (version, platform)
);

CREATE INDEX IF NOT EXISTS idx_app_releases_platform_latest
    ON app_releases (platform, is_latest)
    WHERE is_published = TRUE;

CREATE INDEX IF NOT EXISTS idx_app_releases_created ON app_releases (created_at DESC);
