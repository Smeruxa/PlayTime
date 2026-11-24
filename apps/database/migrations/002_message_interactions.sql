ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id INT REFERENCES messages(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS room_read_state (
    room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_message_id INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_room_read_state_room ON room_read_state(room_id);
