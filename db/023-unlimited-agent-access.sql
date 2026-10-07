-- Unlimited access is explicit. Existing expiry dates are preserved.
ALTER TABLE bridge_credentials ALTER COLUMN expires_at DROP NOT NULL;
COMMENT ON COLUMN bridge_credentials.expires_at IS 'Access expiry; NULL means unlimited until revoked. Enrollment deadlines remain separate.';
