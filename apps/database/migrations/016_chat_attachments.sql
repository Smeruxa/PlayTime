ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_storage_key TEXT NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_mime TEXT NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_filename TEXT NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_size INT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_attachment_storage_key_unique
    ON messages (attachment_storage_key) WHERE attachment_storage_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS attachment_staging (
    attachment_key VARCHAR(40) PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mime TEXT NOT NULL,
    filename TEXT NOT NULL,
    size_bytes INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachment_staging_user ON attachment_staging(user_id);
