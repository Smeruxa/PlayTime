ALTER TABLE room_e2ee_wraps ADD COLUMN IF NOT EXISTS wrapper_public_key TEXT;
UPDATE room_e2ee_wraps rw SET wrapper_public_key = u.dm_public_key
FROM users u WHERE rw.wrapper_user_id = u.id AND rw.wrapper_public_key IS NULL;
ALTER TABLE room_e2ee_wraps ALTER COLUMN wrapper_user_id DROP NOT NULL;
ALTER TABLE room_e2ee_wraps DROP CONSTRAINT IF EXISTS room_e2ee_wraps_wrapper_user_id_fkey;
ALTER TABLE room_e2ee_wraps ADD CONSTRAINT room_e2ee_wraps_wrapper_user_id_fkey
    FOREIGN KEY (wrapper_user_id) REFERENCES users(id) ON DELETE SET NULL;
