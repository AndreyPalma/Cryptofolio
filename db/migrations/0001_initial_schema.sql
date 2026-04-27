-- Up Migration

-- ────────────────────────────────────────────────────────────────────────
-- Extensions
-- ────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- for gen_random_uuid()

-- ────────────────────────────────────────────────────────────────────────
-- ENUMs (members must match db/enums.ts — drift validated by enums.test.ts)
-- ────────────────────────────────────────────────────────────────────────
CREATE TYPE wallet_type AS ENUM ('ON_CHAIN', 'CEX');

CREATE TYPE network AS ENUM ('ETH', 'BSC', 'CEX_BINANCE');

CREATE TYPE transaction_type AS ENUM (
  'BUY',
  'SELL',
  'SWAP_IN',
  'SWAP_OUT',
  'TRANSFER_IN',
  'TRANSFER_OUT'
);

CREATE TYPE transaction_source AS ENUM ('ETHERSCAN', 'BSCTRACE', 'BINANCE', 'MANUAL');

CREATE TYPE position_status AS ENUM ('OPEN', 'CLOSED');

CREATE TYPE cost_source AS ENUM ('MARKET', 'INHERITED', 'MANUAL');

-- service_name uses BINANCE_SECRET_KEY (canonical v5 name); the legacy v4 alias is intentionally absent.
CREATE TYPE service_name AS ENUM (
  'ETHERSCAN',
  'BSCTRACE',
  'BINANCE_API_KEY',
  'BINANCE_SECRET_KEY',
  'TELEGRAM'
);

-- ────────────────────────────────────────────────────────────────────────
-- users — single-user app, but kept as a row for FK ergonomics
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  password_hash TEXT         NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────────────
-- wallets — hybrid on-chain + CEX. CHECK enforces address/network coherence.
-- Single CEX_BINANCE wallet rule is service-layer (US-005), not DB-enforced.
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE wallets (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_type     wallet_type  NOT NULL,
  address         TEXT         NULL,
  network         network      NOT NULL,
  label           TEXT         NULL,
  last_synced_at  TIMESTAMPTZ  NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT wallets_type_coherence CHECK (
    (wallet_type = 'ON_CHAIN' AND address IS NOT NULL AND network IN ('ETH', 'BSC'))
    OR
    (wallet_type = 'CEX'      AND address IS NULL     AND network = 'CEX_BINANCE')
  )
);

-- ────────────────────────────────────────────────────────────────────────
-- tokens — identity is per source. ETH on-chain ≠ ETH on Binance.
--   on-chain: (contract_address, network ∈ {ETH,BSC})
--   CEX:      (lower(symbol), network = CEX_BINANCE)
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE tokens (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol            VARCHAR(32)  NOT NULL,
  name              TEXT         NULL,
  network           network      NOT NULL,
  contract_address  TEXT         NULL,
  decimals          SMALLINT     NOT NULL DEFAULT 18,
  binance_symbol    VARCHAR(20)  NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT tokens_source_coherence CHECK (
    (network IN ('ETH', 'BSC') AND contract_address IS NOT NULL)
    OR
    (network = 'CEX_BINANCE'   AND contract_address IS NULL)
  )
);

CREATE UNIQUE INDEX tokens_unique_onchain
  ON tokens (network, lower(contract_address))
  WHERE contract_address IS NOT NULL;

CREATE UNIQUE INDEX tokens_unique_cex
  ON tokens (network, lower(symbol))
  WHERE network = 'CEX_BINANCE';

-- ────────────────────────────────────────────────────────────────────────
-- positions — one row per (wallet, token, cycle). Closed cycles persist
-- with frozen realized_pnl_usd; new inbound event opens cycle_number = max+1.
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE positions (
  id                UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id         UUID             NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  token_id          UUID             NOT NULL REFERENCES tokens(id)  ON DELETE RESTRICT,
  cycle_number      INTEGER          NOT NULL DEFAULT 1,
  status            position_status  NOT NULL DEFAULT 'OPEN',
  wac               NUMERIC(38, 18)  NOT NULL DEFAULT 0,
  balance           NUMERIC(38, 18)  NOT NULL DEFAULT 0,
  cost_basis        NUMERIC(38, 18)  NOT NULL DEFAULT 0,
  realized_pnl_usd  NUMERIC(38, 18)  NOT NULL DEFAULT 0,
  opened_at         TIMESTAMPTZ      NOT NULL DEFAULT now(),
  closed_at         TIMESTAMPTZ      NULL,

  CONSTRAINT positions_unique_cycle UNIQUE (wallet_id, token_id, cycle_number)
);

-- ────────────────────────────────────────────────────────────────────────
-- transactions — covers BUY/SELL/SWAP/TRANSFER for both on-chain and CEX.
-- Swaps decompose into two rows linked by related_tx_id with tx_log_index 0/1.
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE transactions (
  id                UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id         UUID                NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  token_id          UUID                NOT NULL REFERENCES tokens(id)  ON DELETE RESTRICT,
  position_id       UUID                NULL     REFERENCES positions(id) ON DELETE SET NULL,
  type              transaction_type    NOT NULL,
  source            transaction_source  NOT NULL,
  tx_hash           VARCHAR(80)         NULL,
  tx_log_index      INTEGER             NULL,
  cex_trade_id      BIGINT              NULL,
  related_tx_id     UUID                NULL     REFERENCES transactions(id) ON DELETE SET NULL,
  block_timestamp   TIMESTAMPTZ         NOT NULL,
  amount            NUMERIC(38, 18)     NOT NULL,
  price_usd         NUMERIC(38, 18)     NULL,
  cost_source       cost_source         NULL,
  commission_asset  VARCHAR(20)         NULL,
  commission_amount NUMERIC(38, 18)     NULL,
  from_address      TEXT                NULL,
  to_address        TEXT                NULL,
  created_at        TIMESTAMPTZ         NOT NULL DEFAULT now()
);

-- Partial UNIQUE on-chain: same tx_hash with distinct tx_log_index allowed
-- (handles router swaps emitting multiple log indexes per tx).
CREATE UNIQUE INDEX transactions_unique_onchain
  ON transactions (tx_hash, tx_log_index)
  WHERE tx_hash IS NOT NULL AND source IN ('ETHERSCAN', 'BSCTRACE');

-- Partial UNIQUE CEX: same cex_trade_id with tx_log_index 0 (SWAP_OUT) and 1
-- (SWAP_IN) allowed for Binance Convert. NEGATIVE PRD: duplicate (id, log_index) MUST fail.
CREATE UNIQUE INDEX transactions_unique_cex
  ON transactions (cex_trade_id, tx_log_index)
  WHERE cex_trade_id IS NOT NULL;

-- Query indexes (per US-002 acceptance criteria)
CREATE INDEX transactions_position_id_idx
  ON transactions (position_id);

CREATE INDEX transactions_wallet_token_idx
  ON transactions (wallet_id, token_id);

CREATE INDEX transactions_block_timestamp_idx
  ON transactions (block_timestamp DESC);

CREATE INDEX transactions_tx_hash_idx
  ON transactions (tx_hash)
  WHERE tx_hash IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────
-- wallet_sync_cursors — per-wallet, per-operation cursor.
-- operation is a free string: 'trades:ETHUSDT', 'converts', 'withdrawals', 'deposits'.
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE wallet_sync_cursors (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id       UUID         NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  operation       VARCHAR(80)  NOT NULL,
  last_value      VARCHAR(255) NULL,
  last_synced_at  TIMESTAMPTZ  NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT wallet_sync_cursors_unique UNIQUE (wallet_id, operation)
);

CREATE INDEX wallet_sync_cursors_wallet_op_idx
  ON wallet_sync_cursors (wallet_id, operation);

-- ────────────────────────────────────────────────────────────────────────
-- api_credentials — encrypted at rest (AES-256, key from ENCRYPTION_KEY env).
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE api_credentials (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_name          service_name  NOT NULL,
  credential_encrypted  TEXT          NOT NULL,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT api_credentials_unique_service UNIQUE (user_id, service_name)
);


-- Down Migration

DROP TABLE IF EXISTS api_credentials       CASCADE;
DROP TABLE IF EXISTS wallet_sync_cursors   CASCADE;
DROP TABLE IF EXISTS transactions          CASCADE;
DROP TABLE IF EXISTS positions             CASCADE;
DROP TABLE IF EXISTS tokens                CASCADE;
DROP TABLE IF EXISTS wallets               CASCADE;
DROP TABLE IF EXISTS users                 CASCADE;

DROP TYPE IF EXISTS service_name;
DROP TYPE IF EXISTS cost_source;
DROP TYPE IF EXISTS position_status;
DROP TYPE IF EXISTS transaction_source;
DROP TYPE IF EXISTS transaction_type;
DROP TYPE IF EXISTS network;
DROP TYPE IF EXISTS wallet_type;
