ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_dm_public_key_at_send TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS receiver_dm_public_key_at_send TEXT;
