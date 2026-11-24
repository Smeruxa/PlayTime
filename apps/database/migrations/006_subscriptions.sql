
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_banner TEXT NULL;

CREATE TABLE IF NOT EXISTS user_subscriptions (
    user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    plan_slug VARCHAR(32) NOT NULL CHECK (plan_slug IN ('free', 'medium', 'pro', 'enterprise')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by INT NULL REFERENCES users(id) ON DELETE SET NULL,
    note TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_plan ON user_subscriptions(plan_slug);
