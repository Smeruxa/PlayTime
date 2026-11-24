ALTER TABLE dm_thread_operations ADD COLUMN IF NOT EXISTS call_instance_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS dm_thread_operations_call_instance_key
    ON dm_thread_operations (call_instance_key)
    WHERE call_instance_key IS NOT NULL;
