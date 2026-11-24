CREATE TABLE IF NOT EXISTS dm_pinned_messages (
    user_a_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pinned_message_id INT NULL REFERENCES messages(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_a_id, user_b_id),
    CONSTRAINT dm_pinned_messages_pair_ordered CHECK (user_a_id < user_b_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_pinned_messages_message ON dm_pinned_messages (pinned_message_id)
    WHERE pinned_message_id IS NOT NULL;
