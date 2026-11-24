ALTER TABLE rooms ADD COLUMN IF NOT EXISTS pinned_message_id INT REFERENCES messages(id) ON DELETE SET NULL;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS voice_storage_key TEXT NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS voice_duration_sec REAL NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_voice_storage_key_unique ON messages(voice_storage_key) WHERE voice_storage_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_voice_created ON messages(created_at ASC) WHERE voice_storage_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS voice_staging (
    voice_key VARCHAR(40) PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    duration_sec REAL NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_staging_user ON voice_staging(user_id);
