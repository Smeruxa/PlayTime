CREATE TABLE IF NOT EXISTS auth_guest_receipts (
    request_key_hash CHAR(64) PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    session_id UUID NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_guest_receipts_session_idx ON auth_guest_receipts(session_id);
CREATE INDEX IF NOT EXISTS auth_guest_receipts_expiry_idx ON auth_guest_receipts(expires_at);

CREATE TABLE IF NOT EXISTS auth_refresh_receipts (
    previous_token_hash CHAR(64) PRIMARY KEY,
    request_key_hash CHAR(64) NOT NULL,
    next_token_hash CHAR(64) NOT NULL,
    session_id UUID NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_refresh_receipts_session_idx ON auth_refresh_receipts(session_id);
CREATE INDEX IF NOT EXISTS auth_refresh_receipts_expiry_idx ON auth_refresh_receipts(expires_at);
