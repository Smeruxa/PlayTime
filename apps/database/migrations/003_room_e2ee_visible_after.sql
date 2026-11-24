ALTER TABLE room_e2ee_wraps
    ADD COLUMN IF NOT EXISTS e2ee_visible_after_id INT NOT NULL DEFAULT 0;
