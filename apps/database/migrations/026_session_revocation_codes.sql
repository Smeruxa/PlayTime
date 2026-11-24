CREATE TABLE IF NOT EXISTS session_revocation_codes (
    id UUID PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requester_session_id UUID NOT NULL UNIQUE REFERENCES auth_sessions(id) ON DELETE CASCADE,
    target_session_id UUID REFERENCES auth_sessions(id) ON DELETE CASCADE,
    code_hash VARCHAR(64) NOT NULL,
    attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS session_revocation_codes_expiry_idx ON session_revocation_codes(expires_at);
