CREATE INDEX IF NOT EXISTS idx_messages_dm_pair_latest ON messages(sender_id, receiver_id, id DESC) WHERE room_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_room_latest ON messages(room_id, id DESC) WHERE room_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_dm_unread ON messages(receiver_id, sender_id) WHERE read = FALSE AND room_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_room_members_user_room ON room_members(user_id, room_id);
CREATE INDEX IF NOT EXISTS idx_users_email_normalized ON users(lower(email));
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM users GROUP BY lower(trim(email)) HAVING COUNT(*) > 1) THEN
        RAISE EXCEPTION 'Duplicate email addresses must be resolved before normalization';
    END IF;
END $$;
UPDATE users SET email = lower(trim(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique_normalized ON users(lower(email));
