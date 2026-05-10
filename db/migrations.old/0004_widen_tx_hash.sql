-- Up Migration

-- Widen tx_hash from VARCHAR(80) to VARCHAR(256).
-- ETH/BSC tx hashes are 66 chars (0x + 64 hex), but non-EVM chains (Solana, TON, etc.)
-- use base58/base64 hashes up to 88+ chars. VARCHAR(80) was insufficient for CEX deposits
-- from those chains (Binance deposit history includes cross-chain txIds).

ALTER TABLE transactions
  ALTER COLUMN tx_hash TYPE VARCHAR(256);


-- Down Migration

ALTER TABLE transactions
  ALTER COLUMN tx_hash TYPE VARCHAR(80);
