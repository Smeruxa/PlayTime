CREATE TABLE IF NOT EXISTS dm_thread_operations (
    id SERIAL PRIMARY KEY,
    user_a_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    user_b_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    actor_username TEXT NOT NULL,
    op_kind TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT dm_thread_operations_ordered CHECK (user_a_id < user_b_id)
);

CREATE INDEX IF NOT EXISTS dm_thread_operations_pair_time ON dm_thread_operations (user_a_id, user_b_id, created_at ASC);
