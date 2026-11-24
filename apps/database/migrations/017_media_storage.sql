CREATE TABLE IF NOT EXISTS media_objects (
    storage_key VARCHAR(40) PRIMARY KEY,
    user_id INT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('attachment', 'voice')),
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    encrypted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finalized_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_media_objects_user ON media_objects(user_id, kind);

INSERT INTO media_objects(storage_key, user_id, kind, size_bytes, created_at, finalized_at)
SELECT attachment_storage_key, sender_id, 'attachment', COALESCE(attachment_size, 12582912), created_at, created_at
FROM messages WHERE attachment_storage_key IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO media_objects(storage_key, user_id, kind, size_bytes, created_at, finalized_at)
SELECT voice_storage_key, sender_id, 'voice', 6291456, created_at, created_at
FROM messages WHERE voice_storage_key IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO media_objects(storage_key, user_id, kind, size_bytes, created_at)
SELECT attachment_key, user_id, 'attachment', size_bytes, created_at
FROM attachment_staging ON CONFLICT DO NOTHING;
INSERT INTO media_objects(storage_key, user_id, kind, size_bytes, created_at)
SELECT voice_key, user_id, 'voice', 6291456, created_at
FROM voice_staging ON CONFLICT DO NOTHING;
