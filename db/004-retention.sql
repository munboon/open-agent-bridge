ALTER TABLE bridge_idempotency ADD COLUMN IF NOT EXISTS retired boolean NOT NULL DEFAULT false;
UPDATE bridge_tasks SET cancellation_requested=true WHERE state='cancel_requested' AND NOT cancellation_requested;
CREATE INDEX IF NOT EXISTS bridge_audit_retention ON bridge_audit(owner_id,created_at);
CREATE INDEX IF NOT EXISTS bridge_offer_expiry ON bridge_offers(expires_at) WHERE envelope IS NOT NULL;
