CREATE TABLE IF NOT EXISTS feedback_tickets (
    id BIGSERIAL PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('feature', 'bug')),
    title VARCHAR(120) NOT NULL,
    description VARCHAR(6000) NOT NULL,
    contact VARCHAR(160) NOT NULL DEFAULT '',
    app_version VARCHAR(40) NOT NULL DEFAULT '',
    platform VARCHAR(40) NOT NULL DEFAULT '',
    ip_hash CHAR(64) NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'planned', 'in_progress', 'done', 'declined', 'spam')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
    internal_note VARCHAR(4000) NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_ip ON feedback_tickets(ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback_tickets(status, id DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_kind ON feedback_tickets(kind, id DESC);
