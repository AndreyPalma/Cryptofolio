# Design: US-006 — API REST: ingreso manual de transacciones

## Arquitectura

### Nuevos módulos

| Ruta | Responsabilidad |
|------|----------------|
| `apps/backend/src/types/transaction.ts` | Tipos TS: `Transaction`, `CreateTransactionInput`, `TransactionListQuery`, `CreateTransactionResult` |
| `apps/backend/src/services/transaction.ts` | `TransactionService` (funciones puras con Pool): `createTransaction`, `listTransactions` |
| `apps/backend/src/services/__tests__/transaction.test.ts` | Tests de integración del servicio contra DB real |
| `apps/backend/src/routes/transactions.ts` | Fastify plugin `/api/transactions` (POST + GET) |
| `tests/e2e/api/transactions.test.ts` | Tests e2e HTTP contra servidor real + DB de test |

### Módulos modificados

| Ruta | Cambio |
|------|--------|
| `apps/backend/src/index.ts` | Agregar `transactionRoutes` bajo `/api/transactions` (mismo patrón que `walletRoutes` y `tokenRoutes`) |

---

## Diagrama de secuencia: POST /api/transactions

```
Cliente
  │
  │  POST /api/transactions  { wallet_id, token_id, type, amount,
  │                            price_usd_at_time, block_timestamp, cost_source? }
  ▼
transactionRoutes (Fastify plugin)
  │
  ├─ 1. safeParse(CreateTransactionBodySchema)
  │       └─ falla → 400 { statusCode, error, message, issues }
  │
  ├─ 2. createTransaction(pool, userId, body)
  │       │
  │       ├─ 2a. Regla dominio: TRANSFER_IN + price_usd_at_time=null
  │       │       └─ lanza ValidationError('Price required for manual TRANSFER_IN',
  │       │                                'PRICE_REQUIRED_FOR_TRANSFER_IN')
  │       │
  │       ├─ 2b. findById(wallet_id) → null → lanza NotFoundError('WALLET_NOT_FOUND')
  │       │
  │       ├─ 2c. SELECT FROM tokens WHERE id = $token_id
  │       │       └─ null → lanza NotFoundError('TOKEN_NOT_FOUND')
  │       │
  │       ├─ 2d. client = pool.connect() → client.query('BEGIN')
  │       │
  │       ├─ 2e. SELECT * FROM positions
  │       │         WHERE wallet_id = $1 AND token_id = $2 AND status = 'OPEN'
  │       │         LIMIT 1
  │       │       → openPosition: PositionState | null
  │       │
  │       ├─ 2f. SELECT COUNT(*) FROM positions
  │       │         WHERE wallet_id = $1 AND token_id = $2 AND status = 'CLOSED'
  │       │       → priorClosedCycles: number
  │       │
  │       ├─ 2g. Si openPosition = null (primer inbound):
  │       │         positionIdentity = { id: crypto.randomUUID(),
  │       │                              walletId: wallet_id, tokenId: token_id }
  │       │       Si openPosition != null:
  │       │         positionIdentity = undefined
  │       │
  │       ├─ 2h. engineResult = processTransaction({
  │       │         position: openPosition,
  │       │         priorClosedCycles,
  │       │         transaction: { type, amount, priceUsd, source:'MANUAL',
  │       │                        blockTimestamp, costSource },
  │       │         positionIdentity
  │       │       })
  │       │       ├─ lanza InsufficientBalanceError → capturar AQUÍ → 400
  │       │       └─ lanza InvalidTransactionError  → capturar AQUÍ → 400
  │       │
  │       ├─ 2i. INSERT INTO transactions (
  │       │           wallet_id, token_id, position_id, type, source,
  │       │           tx_hash, cex_trade_id, block_timestamp, amount,
  │       │           price_usd, cost_source, created_at
  │       │         ) VALUES (
  │       │           $1, $2, $engineResult.position.id, $3, 'MANUAL',
  │       │           NULL, NULL, $4, $5, $6, $7, now()
  │       │         )
  │       │         RETURNING *
  │       │
  │       ├─ 2j. INSERT INTO positions (
  │       │           id, wallet_id, token_id, cycle_number, status,
  │       │           wac, balance, cost_basis, realized_pnl_usd,
  │       │           opened_at, closed_at
  │       │         ) VALUES (...)
  │       │         ON CONFLICT (wallet_id, token_id, cycle_number)
  │       │         DO UPDATE SET
  │       │           status           = EXCLUDED.status,
  │       │           wac              = EXCLUDED.wac,
  │       │           balance          = EXCLUDED.balance,
  │       │           cost_basis       = EXCLUDED.cost_basis,
  │       │           realized_pnl_usd = EXCLUDED.realized_pnl_usd,
  │       │           closed_at        = EXCLUDED.closed_at
  │       │         RETURNING *
  │       │
  │       ├─ 2k. client.query('COMMIT')
  │       │
  │       └─ 2l. return { transaction: txRow, position: positionRow }
  │               (en finally: client.release())
  │
  ├─ 3. Si InsufficientBalanceError:
  │       return reply.status(400).send({
  │         statusCode: 400, error: 'INSUFFICIENT_BALANCE',
  │         message: err.message,
  │         currentBalance: err.currentBalance,
  │         attempted: err.attempted
  │       })
  │
  ├─ 4. Si DomainError (ValidationError/NotFoundError):
  │       propagate al setErrorHandler global (ya tiene statusCode en la clase)
  │
  └─ 5. 201 { transaction, position: { position_id, cycle_number, status, wac, balance } }
```

---

## Diagrama de secuencia: GET /api/transactions

```
Cliente
  │
  │  GET /api/transactions?wallet_id=&token_id=&position_id=&limit=20&offset=0
  ▼
transactionRoutes (Fastify plugin)
  │
  ├─ 1. safeParse(ListTransactionsQuerySchema)
  │       └─ falla → 400
  │
  ├─ 2. listTransactions(pool, query)
  │       │
  │       ├─ 2a. Construir WHERE dinámico según filtros presentes:
  │       │         wallet_id  → AND wallet_id = $n
  │       │         token_id   → AND token_id = $n
  │       │         position_id → AND position_id = $n
  │       │
  │       ├─ 2b. SELECT *, COUNT(*) OVER() AS total_count
  │       │         FROM transactions
  │       │         WHERE <filtros>
  │       │         ORDER BY block_timestamp DESC
  │       │         LIMIT $limit OFFSET $offset
  │       │
  │       └─ 2c. return { data: rows, total: rows[0]?.total_count ?? 0, limit, offset }
  │
  └─ 3. 200 { data: Transaction[], total: number, limit: number, offset: number }
```

---

## Decisiones de arquitectura

### DA-1: ¿Cómo pasar el pool de DB al servicio?

**Contexto:** el patrón existente en `wallet.ts` y `token.ts` usa funciones exportadas que reciben `Pool` como primer argumento. El route plugin construye `new Pool(...)` internamente.

**Opción elegida:** Constructor injection implícito — funciones puras que reciben `pool: Pool` (igual que `WalletService`). El plugin de ruta instancia `new Pool({ connectionString: process.env.DATABASE_URL })` en el cuerpo del plugin.

**Alternativas consideradas:**
- Clase `TransactionService` con constructor que guarda `this.pool` → más OOP pero sin ventaja real; el patrón del proyecto es funciones puras.
- Pool compartido global → acopla los módulos y dificulta el testing en paralelo.

**Razón:** consistencia absoluta con los servicios existentes. Las funciones puras son más fáciles de testear con un pool mockeado o real.

---

### DA-2: ¿Cómo cargar el PositionState actual antes de llamar al motor?

**Contexto:** `processTransaction` necesita `PositionState | null`. Para obtenerlo, hay que leer la posición con `status = 'OPEN'` para el par `(wallet_id, token_id)`. La tabla `positions` tiene `UNIQUE(wallet_id, token_id, cycle_number)` pero no hay constraint que garantice un único OPEN por par — es una invariante de dominio.

**Opción elegida:** `SELECT * FROM positions WHERE wallet_id=$1 AND token_id=$2 AND status='OPEN' LIMIT 1`. El `LIMIT 1` es defensivo: si por algún bug existieran dos OPEN, no se rompe el servicio. El motor es el que mantiene la invariante a futuro.

**Alternativas consideradas:**
- `ORDER BY cycle_number DESC LIMIT 1` → necesario si hubiera múltiples OPEN; con la invariante correcta es equivalente, pero más explícito. Se puede agregar sin costo.

**Razón:** la carga debe ocurrir DENTRO de la transacción DB (después del `BEGIN`) para evitar que otra request concurrente cierre la posición entre el SELECT y el INSERT.

---

### DA-3: ¿Cómo manejar la primera transacción de un token (posición no existe aún)?

**Contexto:** cuando el SELECT de DA-2 retorna `null`, el motor necesita `positionIdentity` para crear el `PositionState` con un `id` nuevo. Si no se provee, lanza `InvalidTransactionError: MISSING_POSITION_IDENTITY`.

**Opción elegida:** En el servicio, si `openPosition === null`, se genera `positionIdentity = { id: crypto.randomUUID(), walletId, tokenId }` y se pasa al motor. El UUID generado se usa luego en el UPSERT de `positions`.

**Alternativas consideradas:**
- Generar el UUID dentro del motor → rompe la pureza del motor (side effect de generación de IDs).
- Usar `gen_random_uuid()` de Postgres → el id del UPSERT quedaría desacoplado del `PositionState` que retorna el motor; habría que unirlos con un SELECT extra.

**Razón:** DA-4 del proposal: el motor permanece puro. El servicio controla el ciclo de vida de IDs.

---

### DA-4: ¿Qué campos exactos de positions se almacenan y cuáles se derivan del motor?

**Contexto:** `PositionEngineResult.position` es un `PositionState` completo. Hay que mapear cada campo al schema SQL de `positions`.

**Mapeo directo:**

| `PositionState` (motor) | `positions` (DB) |
|------------------------|------------------|
| `id` | `id` |
| `walletId` | `wallet_id` |
| `tokenId` | `token_id` |
| `cycleNumber` | `cycle_number` |
| `status` | `status` |
| `wac` | `wac` |
| `balance` | `balance` |
| `costBasis` | `cost_basis` |
| `realizedPnlUsd` | `realized_pnl_usd` |
| `openedAt` | `opened_at` |
| `closedAt` | `closed_at` |

Todos los campos del motor tienen correspondencia exacta en el schema. Sin campos derivados post-persistencia.

**Razón:** el schema fue diseñado en US-002 para reflejar exactamente el output del motor.

---

### DA-5: ¿Cómo se diferencia la lógica de cierre de posición (balance=0) de la apertura de nuevo ciclo?

**Contexto:** el motor retorna `positionWasClosed: boolean` y `positionWasOpened: boolean`. La lógica de apertura de ciclo nuevo es responsabilidad del motor: si `openPosition === null` y es un inbound, el motor crea el `PositionState` con `cycleNumber = priorClosedCycles + 1`. El cierre (balance=0) se refleja en `position.status = 'CLOSED'`.

**Opción elegida:** el servicio NO necesita diferenciar los casos — en ambos hace exactamente el mismo UPSERT. El motor ya calculó el `PositionState` correcto (ciclo nuevo o actualización del existente). El UPSERT `ON CONFLICT (wallet_id, token_id, cycle_number) DO UPDATE` maneja ambos:
- Si es un ciclo nuevo → no hay conflicto → INSERT.
- Si es actualización de ciclo existente → hay conflicto → UPDATE SET.

**Alternativas consideradas:**
- `IF positionWasOpened THEN INSERT ELSE UPDATE` → dos queries distintas; introduce race condition si se usa SELECT-then-write. El UPSERT es atómico.

**Razón:** el UPSERT único elimina toda la lógica condicional en el servicio. La constraint `positions_unique_cycle` ya existe en el schema.

---

### DA-6: Estrategia de idempotencia para ingreso manual (sin tx_hash ni cex_trade_id)

**Contexto:** las transacciones manuales no tienen `tx_hash` ni `cex_trade_id`, por lo que los índices únicos parciales existentes (`transactions_unique_onchain`, `transactions_unique_cex`) no aplican. No existe constraint de unicidad para `source = 'MANUAL'`.

**Opción elegida:** no se implementa idempotencia automática para transacciones manuales en US-006. Cada `POST` crea una nueva fila. Si el usuario duplica, verá dos transacciones y podrá eliminarlas (delete en US-007+).

**Alternativas consideradas:**
- Agregar un campo `client_idempotency_key` opcional en el body → permite re-tries seguros desde el cliente. Candidato para US-007+ pero fuera del scope de US-006.
- Hash de `(wallet_id, token_id, type, amount, block_timestamp)` como deduplicación → frágil (dos compras legítimas del mismo token, misma cantidad, mismo timestamp son posibles en CEX).

**Razón:** el PRD no exige idempotencia para ingreso manual. La complejidad no está justificada en V1. Se documenta como gap conocido.

---

### DA-7: ¿Cómo exponer InsufficientBalanceError con el body extendido sin romper el setErrorHandler global?

**Contexto:** el `setErrorHandler` en `index.ts` mapea cualquier `Error` con `statusCode` a `{ statusCode, error: error.name, message }`. `InsufficientBalanceError` del motor no extiende `DomainError` (no tiene `statusCode`) y necesita un body con campos extra `currentBalance` y `attempted` que el handler global no conoce.

**Opción elegida:** capturar `InsufficientBalanceError` **en el route handler** (no en el servicio) y retornar directamente `reply.status(400).send({ statusCode: 400, error: 'INSUFFICIENT_BALANCE', message: err.message, currentBalance: err.currentBalance, attempted: err.attempted })`.

Para `InvalidTransactionError` e `InvalidPositionStateError` del motor: el servicio las captura y las re-lanza como `ValidationError` (que sí tiene `statusCode = 400`) con el `reason` del motor como `code`. El handler global las maneja correctamente.

**Alternativas consideradas:**
- Agregar `statusCode` a `InsufficientBalanceError` en types.ts → contamina el motor con concerns de HTTP. El motor es puro de dominio.
- Crear un `InsufficientBalanceHttpError extends DomainError` en errors.ts → duplica la clase; requiere que el servicio re-lance con los campos copiados.

**Razón:** la captura en el route handler es el único lugar donde el concern HTTP y los datos del motor se intersectan. Es la capa correcta para esa transformación, y no contamina el motor ni el servicio.

---

## Interfaces TypeScript clave

```typescript
// apps/backend/src/types/transaction.ts

import type { TransactionType, TransactionSource, CostSource } from '../db/types.js';

export interface Transaction {
  id: string;
  wallet_id: string;
  token_id: string;
  position_id: string | null;
  type: TransactionType;
  source: TransactionSource;
  tx_hash: string | null;
  tx_log_index: number | null;
  cex_trade_id: number | null;
  related_tx_id: string | null;
  block_timestamp: Date;
  amount: string;           // NUMERIC retornado como string por pg
  price_usd: string | null;
  cost_source: CostSource | null;
  commission_asset: string | null;
  commission_amount: string | null;
  from_address: string | null;
  to_address: string | null;
  created_at: Date;
}

export interface CreateTransactionInput {
  wallet_id: string;
  token_id: string;
  type: TransactionType;
  amount: string;
  price_usd_at_time: string | null;
  block_timestamp: Date;
  cost_source?: CostSource;
}

export interface CreateTransactionResult {
  transaction: Transaction;
  position: {
    position_id: string;
    cycle_number: number;
    status: 'OPEN' | 'CLOSED';
    wac: string;
    balance: string;
  };
}

export interface TransactionListQuery {
  wallet_id?: string;
  token_id?: string;
  position_id?: string;
  limit: number;
  offset: number;
}

export interface TransactionListResult {
  data: Transaction[];
  total: number;
  limit: number;
  offset: number;
}
```

```typescript
// apps/backend/src/services/transaction.ts — firma pública

import type { Pool } from 'pg';
import type {
  CreateTransactionInput,
  CreateTransactionResult,
  TransactionListQuery,
  TransactionListResult,
} from '../types/transaction.js';

export async function createTransaction(
  pool: Pool,
  input: CreateTransactionInput,
): Promise<CreateTransactionResult>

export async function listTransactions(
  pool: Pool,
  query: TransactionListQuery,
): Promise<TransactionListResult>
```

---

## Schema SQL esperado — verificación US-006

Se verificaron `0001_initial_schema.sql` y `0002_tokens_extra_fields.sql` contra los requerimientos de US-006.

### Tabla `transactions` — columnas necesarias

| Columna | Tipo SQL | Estado |
|---------|----------|--------|
| `id` | UUID PK | ✅ existe |
| `wallet_id` | UUID FK wallets | ✅ existe |
| `token_id` | UUID FK tokens | ✅ existe |
| `position_id` | UUID FK positions NULL | ✅ existe |
| `type` | transaction_type | ✅ existe |
| `source` | transaction_source (incluye 'MANUAL') | ✅ existe |
| `tx_hash` | VARCHAR(80) NULL | ✅ existe (NULL para MANUAL) |
| `cex_trade_id` | BIGINT NULL | ✅ existe (NULL para MANUAL) |
| `block_timestamp` | TIMESTAMPTZ NOT NULL | ✅ existe |
| `amount` | NUMERIC(38,18) | ✅ existe |
| `price_usd` | NUMERIC(38,18) NULL | ✅ existe |
| `cost_source` | cost_source NULL | ✅ existe |

### Tabla `positions` — columnas necesarias

| Columna | Tipo SQL | Estado |
|---------|----------|--------|
| `id` | UUID PK | ✅ existe |
| `wallet_id` | UUID FK | ✅ existe |
| `token_id` | UUID FK | ✅ existe |
| `cycle_number` | INTEGER DEFAULT 1 | ✅ existe |
| `status` | position_status | ✅ existe |
| `wac` | NUMERIC(38,18) | ✅ existe |
| `balance` | NUMERIC(38,18) | ✅ existe |
| `cost_basis` | NUMERIC(38,18) | ✅ existe |
| `realized_pnl_usd` | NUMERIC(38,18) | ✅ existe |
| `opened_at` | TIMESTAMPTZ | ✅ existe |
| `closed_at` | TIMESTAMPTZ NULL | ✅ existe |
| UNIQUE(wallet_id, token_id, cycle_number) | constraint `positions_unique_cycle` | ✅ existe |

### Schema gaps

**Ninguno.** El schema existente soporta completamente US-006. No se requiere una nueva migration.

**Nota:** `transactions.position_id` es `NULL REFERENCES positions(id) ON DELETE SET NULL`. El INSERT de transactions referencia el `position_id` del motor, pero la fila de `positions` aún no existe si es un ciclo nuevo. **Orden de operaciones correcto:** primero el UPSERT en `positions` (paso 2j), luego el INSERT en `transactions` (paso 2i). El diagrama de secuencia debe reflejar este orden — a diferencia del proposal que los lista al revés.

> **Corrección respecto al proposal:** el proposal lista INSERT transactions (paso 9) antes que UPSERT positions (paso 10). Esto viola la FK `transactions.position_id → positions.id`. El orden correcto es: **UPSERT positions primero**, luego INSERT transactions.

---

## Estrategia de tests (strict TDD)

### Niveles de test

| Nivel | Archivo | Runner | Descripción |
|-------|---------|--------|-------------|
| Integración servicio | `apps/backend/src/services/__tests__/transaction.test.ts` | `test:e2e` (vitest con DB real) | Prueba `createTransaction` y `listTransactions` contra Postgres real |
| E2E HTTP | `tests/e2e/api/transactions.test.ts` | `test:e2e` | Prueba el endpoint completo via HTTP con servidor real |
| Unit route handler | dentro de `transaction.test.ts` | `test:e2e` | Mock de `createTransaction`/`listTransactions`, verifica mapeo de errores |

**No se usan mocks para los tests del servicio** — se conecta a la DB de test real para verificar atomicidad, UPSERT y comportamiento de la FK.

### Casos de test obligatorios (por acceptance criteria del PRD)

**POST /api/transactions:**
- `[HAPPY] BUY en wallet ON_CHAIN → 201, position creada con ciclo 1`
- `[HAPPY] segundo BUY mismo token → WAC recalculado, mismo ciclo, balance acumulado`
- `[HAPPY] SELL parcial → balance reducido, realizedPnlUsd actualizado`
- `[HAPPY] SELL total (balance=0) → position CLOSED, realizedPnlUsd frozen`
- `[HAPPY] BUY post-cierre → ciclo 2 abierto, WAC fresh`
- `[HAPPY] wallet CEX → source='MANUAL', tx_hash=null, cex_trade_id=null`
- `[NEGATIVE] TRANSFER_IN con price_usd_at_time=null → 400 'Price required for manual TRANSFER_IN'`
- `[NEGATIVE] wallet_id inexistente → 404 WALLET_NOT_FOUND`
- `[NEGATIVE] token_id inexistente → 404 TOKEN_NOT_FOUND`
- `[NEGATIVE] SELL con amount > balance → 400 { error, currentBalance, attempted }`
- `[NEGATIVE] body inválido (amount negativo, type desconocido) → 400 Zod issues`

**GET /api/transactions:**
- `[HAPPY] sin filtros → 200 { data, total, limit, offset }`
- `[HAPPY] filtro wallet_id → solo transacciones de esa wallet`
- `[HAPPY] filtro position_id → solo transacciones de esa posición`
- `[HAPPY] paginación limit=2 offset=0 → total correcto aunque haya más rows`
- `[NEGATIVE] limit > 100 → 400`

### Mocks necesarios

- **Tests de servicio:** ninguno. Pool real de test DB.
- **Tests e2e HTTP:** ninguno. Servidor Fastify real + DB de test.
- **Tests unitarios del route handler** (si se añaden): mock de `createTransaction` con `vi.mock('../services/transaction.js')` para verificar el mapeo de `InsufficientBalanceError` → body extendido sin necesidad de DB.

### Orden de ejecución TDD

1. Escribir tipos en `types/transaction.ts`
2. Escribir tests del servicio (`transaction.test.ts`) — fallan (red)
3. Implementar `services/transaction.ts` — tests pasan (green)
4. Escribir tests e2e HTTP — fallan (red)
5. Implementar `routes/transactions.ts` + registrar en `index.ts` — tests pasan (green)
