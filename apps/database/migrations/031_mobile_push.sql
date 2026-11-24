CREATE TABLE IF NOT EXISTS push_devices (
    id UUID PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
    provider VARCHAR(16) NOT NULL CHECK (provider = 'rustore'),
    token VARCHAR(4096) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    muted_chats JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(muted_chats) = 'array'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, token_hash),
    UNIQUE (session_id, provider)
);
CREATE INDEX IF NOT EXISTS push_devices_user_idx ON push_devices(user_id) WHERE enabled;

CREATE TABLE IF NOT EXISTS push_outbox (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
    event_key VARCHAR(160) NOT NULL,
    chat_key VARCHAR(100) NOT NULL,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
    message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
    call_room_id VARCHAR(160),
    target JSONB NOT NULL,
    title VARCHAR(120) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (device_id, event_key)
);
CREATE INDEX IF NOT EXISTS push_outbox_available_idx ON push_outbox(available_at);
