ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guest_registration_pending BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE email_verification_codes ADD COLUMN IF NOT EXISTS email VARCHAR(255);
UPDATE email_verification_codes c SET email=u.email FROM users u WHERE c.user_id=u.id AND c.email IS NULL;
ALTER TABLE email_verification_codes ALTER COLUMN email SET NOT NULL;
ALTER TABLE password_recovery ADD COLUMN IF NOT EXISTS email VARCHAR(255);
UPDATE password_recovery r SET email=u.email FROM users u WHERE r.user_id=u.id AND r.email IS NULL;
ALTER TABLE password_recovery ALTER COLUMN email SET NOT NULL;
