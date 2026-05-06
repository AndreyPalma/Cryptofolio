-- Up Migration

-- US-008-A — block-cursor for on-chain sync.
-- 0 = "never synced, start from genesis"; sync window is `WHERE block_number > last_synced_block`.
-- Mirrored at runtime into wallet_sync_cursors(operation='block') for parity with the
-- Binance per-operation cursor model (US-008-B), but `wallets.last_synced_block` is
-- the authoritative read (AC-8).

ALTER TABLE wallets
  ADD COLUMN last_synced_block INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN wallets.last_synced_block IS
  'Last on-chain block synced for this wallet. 0 = unsynced. Only meaningful for wallet_type=ON_CHAIN.';


-- Down Migration

ALTER TABLE wallets DROP COLUMN IF EXISTS last_synced_block;
