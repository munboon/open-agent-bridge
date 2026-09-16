ALTER TABLE bridge_offers ADD COLUMN cleanup_state text NOT NULL DEFAULT 'pending'
  CHECK(cleanup_state IN ('pending','confirmed','unknown'));
ALTER TABLE bridge_transfers ADD COLUMN current_offer_id uuid REFERENCES bridge_offers(id) ON DELETE SET NULL;
UPDATE bridge_transfers t SET current_offer_id=(
  SELECT o.id FROM bridge_offers o WHERE o.transfer_id=t.id ORDER BY o.created_at DESC,o.id DESC LIMIT 1
);
UPDATE bridge_offers o SET cleanup_state=t.cleanup_state FROM bridge_transfers t WHERE t.current_offer_id=o.id;
