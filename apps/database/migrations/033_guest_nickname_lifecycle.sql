ALTER TABLE users ADD COLUMN IF NOT EXISTS guest_archived_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guest_original_username VARCHAR(50);
CREATE TABLE IF NOT EXISTS username_reclaims (
    username VARCHAR(50) PRIMARY KEY,
    former_user_id INTEGER NOT NULL REFERENCES users(id),
    released_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_guest_expiry ON users(id)
    WHERE is_guest=TRUE AND guest_registration_pending=FALSE AND guest_archived_at IS NULL;
