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
