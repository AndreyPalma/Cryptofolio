-- Up Migration
CREATE TABLE sync_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id      UUID        NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  type           VARCHAR(20) NOT NULL CHECK (type IN ('CEX', 'ON_CHAIN')),
  status         VARCHAR(20) NOT NULL CHECK (status IN ('running', 'completed')),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ NULL,
  txs_persisted  INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX sync_runs_wallet_status_idx
  ON sync_runs (wallet_id, status);

ALTER TABLE transactions
  ADD COLUMN sync_run_id UUID NULL REFERENCES sync_runs(id) ON DELETE CASCADE;

CREATE INDEX transactions_sync_run_id_idx
  ON transactions (sync_run_id)
  WHERE sync_run_id IS NOT NULL;


-- Down Migration
-- Note: data persistida antes del rollback queda con sync_run_id=NULL (la columna
-- se elimina, pero los rows de transactions mantienen sus IDs primarios intactos).
DROP INDEX IF EXISTS transactions_sync_run_id_idx;
ALTER TABLE transactions DROP COLUMN IF EXISTS sync_run_id;
DROP INDEX IF EXISTS sync_runs_wallet_status_idx;
DROP TABLE IF EXISTS sync_runs;
