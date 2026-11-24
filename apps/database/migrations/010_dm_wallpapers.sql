CREATE TABLE IF NOT EXISTS dm_wallpapers (
    user_a_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    user_b_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
    PRIMARY KEY (user_a_id, user_b_id),
    CONSTRAINT dm_wallpapers_ordered CHECK (user_a_id < user_b_id)
);

CREATE INDEX IF NOT EXISTS dm_wallpapers_updated_at ON dm_wallpapers (updated_at DESC);
