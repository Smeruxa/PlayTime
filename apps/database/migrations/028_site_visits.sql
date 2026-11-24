CREATE TABLE IF NOT EXISTS site_visit_days (
    day DATE PRIMARY KEY,
    visits BIGINT NOT NULL DEFAULT 0 CHECK (visits >= 0)
);

CREATE TABLE IF NOT EXISTS site_visit_sessions (
    session_hash CHAR(64) PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_site_visit_sessions_expiry ON site_visit_sessions(expires_at);

CREATE TABLE IF NOT EXISTS site_visit_settings (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    enabled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO site_visit_settings(id) VALUES (1) ON CONFLICT DO NOTHING;
