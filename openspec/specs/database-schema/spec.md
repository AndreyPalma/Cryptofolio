# database-schema Specification

## Purpose

Define el schema híbrido on-chain/CEX en Postgres para CryptoLedger: tablas, ENUMs, constraints, índices y migraciones reversibles. Soporta el motor WAC (US-004), sync (US-006/007/008) y APIs (US-005+).

## Invariants (PRD v5, preservar verbatim)

1. `service_name` ENUM MUST contener `BINANCE_API_KEY` y `BINANCE_SECRET_KEY`. SHALL NOT contener `BINANCE_API_SECRET` (legacy v4).
2. La identidad de un token es **por fuente**: on-chain = `(contract_address, network ∈ {ETH,BSC})`, CEX = `(symbol_lower, 'CEX_BINANCE')`. ETH on-chain y ETH en Binance MUST poder coexistir como dos rows distintas.
3. Convert / swap se almacenan como **dos rows** linkeadas por `related_tx_id` con `tx_log_index` 0 (out) y 1 (in). El UNIQUE CEX MUST incluir `tx_log_index`, no solo `cex_trade_id`.

## Requirements

### Requirement: Migración inicial reversible

`db/migrations/0001_initial_schema.sql` MUST crear el schema completo y MUST proveer `down()` que revierte sin huérfanos.

#### Scenario: Up sobre DB limpia

- GIVEN una DB Postgres vacía con `DATABASE_URL_TEST` apuntando a ella
- WHEN se ejecuta `npm run db:migrate`
- THEN exit code MUST ser 0
- AND `pg_tables` MUST contener `users`, `wallets`, `tokens`, `positions`, `transactions`, `wallet_sync_cursors`, `api_credentials`

#### Scenario: Up → down → up es idempotente

- GIVEN migración aplicada
- WHEN se corre `npm run db:migrate -- down` y luego `npm run db:migrate` otra vez
- THEN ambos exit codes MUST ser 0
- AND el schema final MUST ser idéntico (mismas columnas, mismos índices, mismos constraints) al inicial

### Requirement: Tabla `wallets` con CHECK por tipo

`wallets` MUST enforced por CHECK constraint que el tipo y la network sean consistentes.

#### Scenario: Wallet ON_CHAIN válida

- GIVEN tabla `wallets` con CHECK `(wallet_type='ON_CHAIN' AND address IS NOT NULL AND network IN ('ETH','BSC')) OR (wallet_type='CEX' AND address IS NULL AND network='CEX_BINANCE')`
- WHEN se inserta `(wallet_type='ON_CHAIN', address='0xabc...', network='ETH')`
- THEN el INSERT MUST tener éxito

#### Scenario: ON_CHAIN sin address falla

- GIVEN el mismo CHECK
- WHEN se inserta `(wallet_type='ON_CHAIN', address=NULL, network='ETH')`
- THEN el INSERT MUST fallar con violation del CHECK constraint

#### Scenario: CEX con address falla

- WHEN se inserta `(wallet_type='CEX', address='0xabc...', network='CEX_BINANCE')`
- THEN el INSERT MUST fallar con violation del CHECK constraint

### Requirement: Wallet `last_synced_at` nullable

`wallets.last_synced_at` MUST ser `TIMESTAMPTZ NULL` por default — wallets recién creadas no tienen sync previo.

#### Scenario: Wallet nueva sin sync

- WHEN se inserta una wallet sin especificar `last_synced_at`
- THEN el row MUST tener `last_synced_at = NULL`

### Requirement: `wallet_sync_cursors` UNIQUE compuesto

`wallet_sync_cursors` MUST tener `UNIQUE(wallet_id, operation)` donde `operation` es `VARCHAR` libre (`'trades:ETHUSDT'`, `'converts'`, `'withdrawals'`, `'deposits'`).

#### Scenario: Cursor por símbolo coexiste con cursor genérico

- WHEN se insertan dos cursors para la misma wallet con `operation='trades:ETHUSDT'` y `operation='converts'`
- THEN ambos INSERTs MUST tener éxito

#### Scenario: Cursor duplicado falla

- GIVEN un cursor `(wallet_id=W, operation='converts')` ya insertado
- WHEN se intenta insertar otro `(wallet_id=W, operation='converts')`
- THEN el INSERT MUST fallar con violation del UNIQUE

### Requirement: Tabla `tokens` soporta on-chain y CEX

`tokens` MUST tener `network` ENUM incluyendo `'CEX_BINANCE'` y `binance_symbol VARCHAR(20) NULL`.

#### Scenario: Token on-chain

- WHEN se inserta `(symbol='USDC', network='ETH', contract_address='0xa0b...', binance_symbol=NULL)`
- THEN INSERT MUST tener éxito

#### Scenario: Token CEX

- WHEN se inserta `(symbol='ETH', network='CEX_BINANCE', contract_address=NULL, binance_symbol='ETH')`
- THEN INSERT MUST tener éxito

### Requirement: Tabla `transactions` soporta on-chain + CEX + swap decomposition

`transactions` MUST tener `tx_hash VARCHAR NULL`, `tx_log_index INTEGER NULL`, `cex_trade_id BIGINT NULL`, `commission_asset VARCHAR(20) NULL`, `commission_amount NUMERIC NULL`, `source` ENUM con `'ETHERSCAN','BSCTRACE','BINANCE','MANUAL'`, y `related_tx_id` FK self-reference NULLABLE para linkear `SWAP_OUT`↔`SWAP_IN`.

#### Scenario: BUY on-chain

- WHEN se inserta `(source='ETHERSCAN', tx_hash='0xabc', tx_log_index=0, type='BUY', cex_trade_id=NULL, ...)`
- THEN INSERT MUST tener éxito

#### Scenario: Convert Binance (dos rows mismo cex_trade_id)

- WHEN se insertan `(source='BINANCE', cex_trade_id=12345, tx_log_index=0, type='SWAP_OUT')` y `(source='BINANCE', cex_trade_id=12345, tx_log_index=1, type='SWAP_IN', related_tx_id=<id del SWAP_OUT>)`
- THEN ambos INSERTs MUST tener éxito

### Requirement: Partial UNIQUE on-chain

Las transacciones on-chain MUST ser únicas por `(tx_hash, tx_log_index)` solo cuando `tx_hash IS NOT NULL AND source IN ('ETHERSCAN','BSCTRACE')`.

#### Scenario: Mismo tx_hash con distinto log_index permitido

- WHEN se insertan dos rows on-chain con mismo `tx_hash` y `tx_log_index` 0 y 1
- THEN ambos INSERTs MUST tener éxito

#### Scenario: Duplicado on-chain falla

- GIVEN un row `(tx_hash='0xabc', tx_log_index=0, source='ETHERSCAN')`
- WHEN se intenta insertar otro `(tx_hash='0xabc', tx_log_index=0, source='ETHERSCAN')`
- THEN el INSERT MUST fallar con violation del UNIQUE parcial

### Requirement: Partial UNIQUE CEX (NEGATIVE PRD)

Las transacciones CEX MUST ser únicas por `(cex_trade_id, tx_log_index) WHERE cex_trade_id IS NOT NULL`.

#### Scenario: Convert válido — mismo cex_trade_id, distinto tx_log_index

- WHEN se insertan `(cex_trade_id=999, tx_log_index=0)` y `(cex_trade_id=999, tx_log_index=1)`
- THEN ambos INSERTs MUST tener éxito

#### Scenario: Duplicado CEX falla (NEGATIVE)

- GIVEN un row `(cex_trade_id=999, tx_log_index=0)`
- WHEN se intenta insertar otro `(cex_trade_id=999, tx_log_index=0)`
- THEN el INSERT MUST fallar con violation del UNIQUE parcial

### Requirement: `transaction_type` ENUM incluye FIAT_IN y FIAT_OUT (US-013)

El ENUM `transaction_type` MUST contener 8 valores tras la migración `0005_fiat_types_cex_order_id.sql`: los 6 originales más `FIAT_IN` y `FIAT_OUT`. `FIAT_IN` actúa como `BUY` en el position engine (recalcula WAC + incrementa balance); `FIAT_OUT` actúa como `SELL` (reduce balance, genera P&L, no modifica WAC). No se requieren cambios en `engine.ts` — el flujo `isInbound → appendToOpenPosition` / `isOutbound → reduceOpenPosition` cubre los nuevos tipos automáticamente.

#### Scenario: Enum extendido acepta FIAT_IN y FIAT_OUT

- GIVEN schema actualizado con la migración `0005` aplicada
- WHEN se inserta una transacción con `type = 'FIAT_IN'`
- THEN el INSERT MUST tener éxito
- AND lo mismo MUST aplicar para `type = 'FIAT_OUT'`

#### Scenario: El enum mantiene los 8 valores tras la migración

- GIVEN schema con `0005` aplicada
- WHEN se consulta `pg_enum WHERE enumtypid = 'transaction_type'::regtype`
- THEN el resultado MUST incluir exactamente 8 valores: `BUY`, `SELL`, `SWAP_IN`, `SWAP_OUT`, `TRANSFER_IN`, `TRANSFER_OUT`, `FIAT_IN`, `FIAT_OUT`

#### Scenario: Migración down no elimina enum values (limitación PostgreSQL conocida)

- GIVEN migración `0005` aplicada y luego revertida (down)
- WHEN se consulta `pg_enum` por el tipo `transaction_type`
- THEN `FIAT_IN` y `FIAT_OUT` MUST permanecer en el tipo — PostgreSQL no soporta `DROP VALUE`
- AND el archivo de migración MUST documentar explícitamente esta limitación con comentario

### Requirement: Columna `transactions.cex_order_id` con unicidad parcial (US-013)

`transactions` MUST soportar una columna `cex_order_id TEXT NULL` introducida por la migración `0005`. El índice parcial `transactions_cex_order_id_unique` MUST garantizar unicidad `WHERE cex_order_id IS NOT NULL`. `cex_trade_id` (BIGINT, para trades y converts de Binance) y `cex_order_id` (TEXT, para fiat orders de Binance) son columnas separadas e independientes; ambas pueden ser NULL en filas on-chain o MANUAL.

#### Scenario: Dos filas fiat con cex_order_id distintos coexisten

- GIVEN migración `0005` aplicada
- WHEN se insertan dos transacciones con `cex_order_id='order-001'` y `cex_order_id='order-002'`
- THEN ambos INSERTs MUST tener éxito

#### Scenario: Múltiples filas con cex_order_id = NULL coexisten (índice parcial ignora NULLs)

- GIVEN migración `0005` aplicada
- WHEN se insertan múltiples transacciones on-chain con `cex_order_id = NULL`
- THEN todos los INSERTs MUST tener éxito

#### Scenario: Filas pre-existentes de trades/converts no se ven afectadas

- GIVEN filas con `cex_trade_id NOT NULL` y `cex_order_id = NULL` pre-existentes
- WHEN se ejecuta la migración `0005`
- THEN las filas existentes MUST mantener `cex_order_id = NULL` sin error

#### Scenario: cex_order_id duplicado falla (NEGATIVE)

- GIVEN una fila con `cex_order_id = 'order-dup-123'` ya insertada
- WHEN se intenta insertar otra fila con `cex_order_id = 'order-dup-123'`
- THEN el INSERT MUST fallar con violación del índice único `transactions_cex_order_id_unique`

### Requirement: `api_credentials.service_name` ENUM con nombres canónicos

`service_name` ENUM MUST incluir `'ETHERSCAN'`, `'BSCTRACE'`, `'BINANCE_API_KEY'`, `'BINANCE_SECRET_KEY'`, `'TELEGRAM'`. SHALL NOT incluir `'BINANCE_API_SECRET'`.

#### Scenario: Insertar BINANCE_SECRET_KEY OK

- WHEN se inserta `(service_name='BINANCE_SECRET_KEY', credential_encrypted='...')`
- THEN INSERT MUST tener éxito

#### Scenario: Insertar BINANCE_API_SECRET falla

- WHEN se inserta `(service_name='BINANCE_API_SECRET', ...)`
- THEN el INSERT MUST fallar con error de tipo ENUM inválido

### Requirement: `positions` UNIQUE por ciclo

`positions` MUST tener `UNIQUE(wallet_id, token_id, cycle_number)` para soportar la lifecycle "OPEN → CLOSED → nuevo ciclo".

#### Scenario: Dos ciclos misma wallet+token

- WHEN se insertan `(wallet=W, token=T, cycle_number=1, status='CLOSED')` y `(wallet=W, token=T, cycle_number=2, status='OPEN')`
- THEN ambos INSERTs MUST tener éxito

#### Scenario: Mismo ciclo duplicado falla

- WHEN se intenta insertar dos rows con `(wallet=W, token=T, cycle_number=1)`
- THEN el segundo INSERT MUST fallar

### Requirement: Índices de consulta

El schema MUST declarar índices B-tree en: `transactions(position_id)`, `transactions(wallet_id, token_id)`, `transactions(block_timestamp DESC)`, `transactions(tx_hash) WHERE tx_hash IS NOT NULL`, `wallet_sync_cursors(wallet_id, operation)`.

#### Scenario: Índices presentes en pg_indexes

- WHEN se consulta `pg_indexes WHERE tablename IN ('transactions','wallet_sync_cursors')`
- THEN el resultado MUST incluir los 5 índices listados arriba con sus definiciones literales

### Requirement: Seed reproducible

`npm run db:seed` MUST insertar fixtures determinísticos: 1 user, 1 wallet ON_CHAIN ETH (SafePal), 1 wallet ON_CHAIN BSC (SafePal), 1 wallet CEX_BINANCE, tokens on-chain y CEX, transacciones BUY/SELL/Convert/withdrawal de prueba, y posiciones derivadas.

#### Scenario: Seed exitoso desde DB migrada

- GIVEN schema migrado en DB vacía
- WHEN se ejecuta `npm run db:seed`
- THEN exit code MUST ser 0
- AND `SELECT COUNT(*) FROM wallets` MUST devolver `3`
- AND `SELECT COUNT(*) FROM transactions` MUST devolver `>= 4` (al menos 1 BUY, 1 SELL, 2 rows de Convert)

#### Scenario: Seed idempotente

- GIVEN seed ya aplicado
- WHEN se ejecuta `npm run db:seed` una segunda vez sobre la misma DB sin truncate previo
- THEN el comando MUST fallar limpiamente (con mensaje "DB already seeded — drop schema first") O MUST hacer upsert sin duplicar rows. La elección queda al implementador pero MUST ser una de las dos.

### Requirement: Pool pg compartido

`apps/backend/src/db/pool.ts` MUST exportar un singleton pool de `pg` configurado desde `EnvSchema.DATABASE_URL`, con SSL habilitado cuando la URL incluye `sslmode=require`.

#### Scenario: Pool reusable entre requests

- WHEN cualquier módulo backend importa `{ pool } from './db/pool'`
- THEN MUST recibir la misma instancia (referencial equality)
- AND el pool MUST estar configurado con `max: 10` (por defecto, override-able vía env opcional)

#### Scenario: Pool falla rápido si DATABASE_URL inválido

- GIVEN `DATABASE_URL` no parseable como URI
- WHEN el backend arranca
- THEN MUST fallar al startup vía Zod (ya cubierto por scaffold) — no llega a crear el pool
