ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS message_reactions (
    message_id INT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);
