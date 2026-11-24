CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_guest BOOLEAN NOT NULL DEFAULT FALSE,
    guest_registration_pending BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    profile_status VARCHAR(120) NOT NULL DEFAULT '',
    profile_bio VARCHAR(1000) NOT NULL DEFAULT '',
    profile_avatar TEXT,
    profile_banner TEXT,
    profile_avatar_effect VARCHAR(32) NOT NULL DEFAULT 'none',
    profile_banner_effect VARCHAR(32) NOT NULL DEFAULT 'none',
    profile_banner_sticker VARCHAR(32) NOT NULL DEFAULT 'none',
    dm_public_key TEXT,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS friendships (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_user_friend ON friendships(user_id, friend_id);
CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships(status);

CREATE TABLE IF NOT EXISTS rooms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_by INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    pinned_message_id INT NULL
);
CREATE INDEX IF NOT EXISTS idx_rooms_created_at ON rooms(created_at DESC);

CREATE TABLE IF NOT EXISTS room_members (
    room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    sender_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INT REFERENCES users(id) ON DELETE CASCADE,
    room_id INT REFERENCES rooms(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    is_dm_e2ee BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    read BOOLEAN DEFAULT false,
    reply_to_id INT REFERENCES messages(id) ON DELETE SET NULL,
    edited_at TIMESTAMPTZ NULL,
    voice_storage_key TEXT NULL,
    voice_duration_sec REAL NULL,
    CONSTRAINT chk_message_target CHECK (
        (receiver_id IS NOT NULL AND room_id IS NULL) OR
        (receiver_id IS NULL AND room_id IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver ON messages(sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_voice_storage_key_unique ON messages(voice_storage_key) WHERE voice_storage_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_voice_created ON messages(created_at ASC) WHERE voice_storage_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS voice_staging (
    voice_key VARCHAR(40) PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    duration_sec REAL NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_voice_staging_user ON voice_staging(user_id);

CREATE TABLE IF NOT EXISTS room_read_state (
    room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_message_id INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_room_read_state_room ON room_read_state(room_id);

CREATE TABLE IF NOT EXISTS room_e2ee_wraps (
    room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wrapper_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ciphertext TEXT NOT NULL,
    e2ee_visible_after_id INT NOT NULL DEFAULT 0,
    PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_room_e2ee_wraps_room ON room_e2ee_wraps(room_id);

CREATE TABLE IF NOT EXISTS message_reactions (
    message_id INT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);

CREATE TABLE IF NOT EXISTS dm_pinned_messages (
    user_a_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pinned_message_id INT NULL REFERENCES messages(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_a_id, user_b_id),
    CONSTRAINT dm_pinned_messages_pair_ordered CHECK (user_a_id < user_b_id)
);
CREATE INDEX IF NOT EXISTS idx_dm_pinned_messages_message ON dm_pinned_messages (pinned_message_id)
    WHERE pinned_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_subscriptions (
    user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    plan_slug VARCHAR(32) NOT NULL CHECK (plan_slug IN ('free', 'medium', 'pro', 'enterprise')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by INT NULL REFERENCES users(id) ON DELETE SET NULL,
    note TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_plan ON user_subscriptions(plan_slug);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_pinned_message_id_fkey;
ALTER TABLE rooms ADD CONSTRAINT rooms_pinned_message_id_fkey FOREIGN KEY (pinned_message_id) REFERENCES messages(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS billing_orders (
    id UUID PRIMARY KEY,
    request_id UUID NOT NULL UNIQUE,
    capability_hash CHAR(64) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    request_ip_hash CHAR(64) NOT NULL,
    user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    username_snapshot VARCHAR(50) NOT NULL,
    mode VARCHAR(8) NOT NULL CHECK (mode IN ('test', 'live')),
    shop_id VARCHAR(32) NOT NULL,
    plan_slug VARCHAR(32) NOT NULL CHECK (plan_slug IN ('medium', 'pro', 'enterprise')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency CHAR(3) NOT NULL CHECK (currency = 'RUB'),
    provider_request JSONB NOT NULL,
    provider_id UUID NULL UNIQUE,
    confirmation_url TEXT NULL,
    state VARCHAR(16) NOT NULL DEFAULT 'creating' CHECK (state IN ('creating', 'pending', 'succeeded', 'canceled', 'review')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    access_expires_at TIMESTAMPTZ NOT NULL,
    create_deadline TIMESTAMPTZ NOT NULL,
    next_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_token UUID NULL,
    lease_until TIMESTAMPTZ NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error_code VARCHAR(48) NULL
);
CREATE INDEX IF NOT EXISTS idx_billing_orders_due ON billing_orders(next_check_at) WHERE state IN ('creating', 'pending');
CREATE INDEX IF NOT EXISTS idx_billing_orders_ip_created ON billing_orders(request_ip_hash, created_at);

CREATE TABLE IF NOT EXISTS billing_entitlements (
    order_id UUID PRIMARY KEY REFERENCES billing_orders(id),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode VARCHAR(8) NOT NULL CHECK (mode IN ('test', 'live')),
    shop_id VARCHAR(32) NOT NULL,
    plan_slug VARCHAR(32) NOT NULL CHECK (plan_slug IN ('medium', 'pro', 'enterprise')),
    valid_from TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (valid_until > valid_from)
);
CREATE INDEX IF NOT EXISTS idx_billing_entitlements_active ON billing_entitlements(user_id, mode, shop_id, valid_until);

ALTER TABLE users ADD COLUMN IF NOT EXISTS guest_archived_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guest_original_username VARCHAR(50);
CREATE TABLE IF NOT EXISTS username_reclaims (
    username VARCHAR(50) PRIMARY KEY,
    former_user_id INTEGER NOT NULL REFERENCES users(id),
    released_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_guest_expiry ON users(id)
    WHERE is_guest=TRUE AND guest_registration_pending=FALSE AND guest_archived_at IS NULL;
