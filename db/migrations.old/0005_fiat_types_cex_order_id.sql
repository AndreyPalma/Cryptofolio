-- Up Migration
-- REQ-001: Extend transaction_type enum with FIAT_IN and FIAT_OUT.
-- PostgreSQL >= 12 allows ALTER TYPE ADD VALUE inside a transaction.
-- Each ALTER TYPE must be a separate statement (PostgreSQL requirement).
ALTER TYPE transaction_type ADD VALUE 'FIAT_IN';
ALTER TYPE transaction_type ADD VALUE 'FIAT_OUT';

-- REQ-006: Add cex_order_id column for Binance fiat order deduplication.
-- Fiat orders use orderId (text), distinct from cex_trade_id (used by trades/converts).
ALTER TABLE transactions ADD COLUMN cex_order_id TEXT NULL;

-- Partial unique index: allows multiple NULL rows (on-chain txs) but enforces uniqueness
-- when cex_order_id is set (fiat orders). NULLs are excluded from the index.
CREATE UNIQUE INDEX transactions_cex_order_id_unique
  ON transactions (cex_order_id)
  WHERE cex_order_id IS NOT NULL;


-- Down Migration
-- NOTE: PostgreSQL does not support DROP VALUE on an ENUM type.
-- The values FIAT_IN and FIAT_OUT will remain in the type after rollback
-- but will be unused (no rows with those values if all fiat rows are removed).
-- Full enum reversion would require recreating the type (destructive) — intentionally skipped.
DROP INDEX IF EXISTS transactions_cex_order_id_unique;
ALTER TABLE transactions DROP COLUMN IF EXISTS cex_order_id;
