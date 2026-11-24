CREATE TABLE IF NOT EXISTS message_send_receipts (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_message_id UUID NOT NULL,
    message_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, client_message_id)
);
CREATE INDEX IF NOT EXISTS idx_message_receipts_expiry ON message_send_receipts(created_at);
