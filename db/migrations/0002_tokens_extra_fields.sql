-- Up Migration

ALTER TABLE tokens ADD COLUMN is_hidden BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tokens ADD COLUMN target_exit_price NUMERIC(18,8) NULL;


-- Down Migration

ALTER TABLE tokens DROP COLUMN IF EXISTS target_exit_price;
ALTER TABLE tokens DROP COLUMN IF EXISTS is_hidden;
