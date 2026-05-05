# Tasks — US-006 · API REST: ingreso manual de transacciones

> **Change:** `US-006-manual-transactions`
> **Artifact store:** openspec
> **Strict TDD:** ACTIVO — escribir test fallido PRIMERO, luego implementar
> **Última actualización:** 2026-04-28

---

## Resumen

| Fase | Descripción | Tareas |
|------|-------------|--------|
| 1 | Tipos e interfaces | 1 |
| 2 | TransactionService (TDD) | 2 |
| 3 | Route plugin (TDD) | 3 |
| 4 | Verificación final | 3 |
| **Total** | | **9** |

---

## Fase 1 — Tipos e interfaces

### 1.1 Crear `apps/backend/src/types/transaction.ts`

**Archivo:** `apps/backend/src/types/transaction.ts`
**Acción:** NUEVO

Definir los tipos TypeScript que necesita el servicio y las rutas:

```typescript
// Importar los enums del módulo de DB
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
  block_timestamp: string;   // ISO-8601 string del caller
  cost_source?: CostSource;
}

export interface CreateTransactionResult {
  transaction_id: string;
  position_id: string;
  cycle_number: number;
  status: 'OPEN' | 'CLOSED';
  wac: string;
  balance: string;
}

export interface TransactionListQuery {
  wallet_id: string;
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

**Criterio de completitud:** `npm run typecheck` en `apps/backend` no reporta errores en este archivo.

---

## Fase 2 — TransactionService (TDD)

> Orden TDD obligatorio: escribir 2.1 primero (tests fallan en RED), luego 2.2 (tests pasan en GREEN).

### 2.1 Crear tests del servicio — `apps/backend/src/services/__tests__/transaction.test.ts`

**Archivo:** `apps/backend/src/services/__tests__/transaction.test.ts`
**Acción:** NUEVO
**Runner:** `npm run test:e2e` (vitest con DB real — `describe.skipIf(!testUrl)`)

Seguir el patrón de `wallet.test.ts`: los tests usan `Pool` real conectado a `DATABASE_URL_TEST`. Importar factories desde `tests/e2e/db/factories.ts`.

**Tests a implementar (en este orden):**

#### createTransaction — casos happy path

- **SC-TX-CREATE-01** `[HAPPY]` BUY exitoso — posición nueva (ciclo 1)
  - Setup: `resetDb()`, crear wallet + token via factories
  - Assert: retorna `{ transaction_id, position_id, cycle_number: 1, status: 'OPEN', wac: '3000', balance: '1' }`
  - Assert: fila en `transactions` tiene `source='MANUAL'`, `tx_hash=null`, `cex_trade_id=null`
  - Assert: fila en `positions` tiene `status='OPEN'`, `wac='3000.00'`, `balance='1.0'`

- **SC-TX-CREATE-02** `[HAPPY]` segundo BUY mismo token — WAC recalculado, mismo ciclo, balance acumulado
  - Setup: posición OPEN preexistente con `balance='1.0'`, `wac='3000.00'`
  - BUY amount='1.0', price='4000.00'
  - Assert: `cycle_number=1`, `balance='2.0'`, WAC recalculado (promedio ponderado: 3500)

- **SC-TX-CREATE-03** `[HAPPY]` SELL parcial — balance reducido, WAC sin cambio (INV-1)
  - Setup: posición OPEN con `balance='1.0'`, `wac='3000.00'`
  - SELL amount='0.5', price='4000.00'
  - Assert: `balance='0.5'`, `status='OPEN'`, `wac` igual al previo (SELL no toca WAC)

- **SC-TX-CREATE-04** `[HAPPY]` SELL total (balance=0) — posición CLOSED, realized_pnl congelado
  - Setup: posición OPEN con `balance='1.0'`
  - SELL amount='1.0', price='3000.00'
  - Assert: `status='CLOSED'`, `balance='0.0'`
  - Assert: fila en `positions` tiene `status='CLOSED'`, `closed_at IS NOT NULL`

- **SC-TX-LIFECYCLE-01** `[HAPPY]` BUY post-cierre — ciclo 2 abierto, WAC fresh (INV-2)
  - Setup: posición CLOSED del ciclo 1 (balance='0')
  - BUY amount='0.5', price='2500.00'
  - Assert: `cycle_number=2`, `status='OPEN'`, `wac='2500'` (no hereda WAC del ciclo 1)
  - Assert: fila del ciclo 1 sigue en DB con `status='CLOSED'`

- **SC-TX-CREATE-05** `[HAPPY]` TRANSFER_IN con `price_usd_at_time` explícito y `cost_source='MANUAL'`
  - Setup: wallet + token sin posición
  - TRANSFER_IN amount='2.0', price='1500.00', cost_source='MANUAL'
  - Assert: `status='OPEN'`, `wac='1500'`, `balance='2.0'`
  - Assert: fila en `transactions` tiene `cost_source='MANUAL'`

#### createTransaction — casos NEGATIVOS (obligatorios del PRD)

- **NEGATIVE-TX-01** `[NEGATIVE]` SELL con amount > balance → lanza `InsufficientBalanceError`
  - Setup: posición OPEN con `balance='0.5'`
  - SELL amount='1.0'
  - Assert: lanza `InsufficientBalanceError` con `currentBalance='0.5'` y `attempted='1.0'`
  - Assert: NO se insertó ninguna fila en `transactions` ni se modificó `positions`

- **NEGATIVE-TX-02** `[NEGATIVE]` TRANSFER_IN sin `price_usd_at_time` → lanza `ValidationError` ANTES del motor
  - Assert: código `'PRICE_REQUIRED_FOR_TRANSFER_IN'`, mensaje exacto `'Price required for manual TRANSFER_IN'`
  - Assert: el error se lanza sin ninguna query a DB (verificar con spy si necesario)

- **NEGATIVE-TX-03** `[NEGATIVE]` `wallet_id` inexistente → lanza `NotFoundError` con código `'WALLET_NOT_FOUND'`

- **NEGATIVE-TX-04** `[NEGATIVE]` `token_id` inexistente → lanza `NotFoundError` con código `'TOKEN_NOT_FOUND'`

- **NEGATIVE-TX-05** `[NEGATIVE]` SELL sin posición OPEN → lanza `InvalidTransactionError` con `reason='OUTBOUND_WITHOUT_POSITION'`
  - Setup: wallet + token sin ninguna posición
  - Assert: NO se persiste nada en DB

- **NEGATIVE-TX-06** `[NEGATIVE]` SWAP_OUT sin posición OPEN → mismo comportamiento que NEGATIVE-TX-05

#### listTransactions — happy path

- **SC-TX-LIST-01** `[HAPPY]` filtro `wallet_id` → retorna solo las de esa wallet, ordenadas `block_timestamp DESC`

- **SC-TX-LIST-02** `[HAPPY]` filtro `token_id` → retorna solo las del par `(wallet_id, token_id)`

- **SC-TX-LIST-03** `[HAPPY]` paginación `limit=2, offset=2` sobre 5 filas → `{ data: [2], total: 5, limit: 2, offset: 2 }`

- **SC-TX-LIST-04** `[HAPPY]` wallet sin transacciones → `{ data: [], total: 0, limit: 20, offset: 0 }`

**Criterio de completitud:** todos los tests están en RED (fallan con "cannot find module" o assertion failures) antes de escribir el servicio.

---

### 2.2 Implementar `apps/backend/src/services/transaction.ts`

**Archivo:** `apps/backend/src/services/transaction.ts`
**Acción:** NUEVO

Implementar las dos funciones exportadas hasta que todos los tests de 2.1 pasen en GREEN.

#### Firma pública

```typescript
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

#### Flujo exacto de `createTransaction(pool, input)`

1. **Validar dominio — TRANSFER_IN sin precio** (antes de cualquier DB call):
   ```typescript
   if (input.type === 'TRANSFER_IN' && input.price_usd_at_time === null) {
     throw new ValidationError(
       'Price required for manual TRANSFER_IN',
       'PRICE_REQUIRED_FOR_TRANSFER_IN',
     );
   }
   ```

2. **Verificar wallet**: `SELECT id FROM wallets WHERE id = $1` → si null → `throw new NotFoundError('Wallet not found', 'WALLET_NOT_FOUND')`

3. **Verificar token**: `SELECT id FROM tokens WHERE id = $1` → si null → `throw new NotFoundError('Token not found', 'TOKEN_NOT_FOUND')`

4. **`client = await pool.connect()` → `client.query('BEGIN')`**

5. **Cargar posición OPEN activa**:
   ```sql
   SELECT * FROM positions
   WHERE wallet_id = $1 AND token_id = $2 AND status = 'OPEN'
   ORDER BY cycle_number DESC
   LIMIT 1
   ```
   → `openPosition: PositionState | null`

6. **Contar ciclos cerrados**:
   ```sql
   SELECT COUNT(*)::int AS count FROM positions
   WHERE wallet_id = $1 AND token_id = $2 AND status = 'CLOSED'
   ```
   → `priorClosedCycles: number`

7. **Construir `positionIdentity`** (solo cuando `openPosition === null`):
   ```typescript
   const positionIdentity = openPosition === null
     ? { id: crypto.randomUUID(), walletId: input.wallet_id, tokenId: input.token_id }
     : undefined;
   ```

8. **Construir `TransactionInput`** para el motor:
   ```typescript
   const txInput: TransactionInput = {
     type: input.type,
     amount: input.amount,
     priceUsd: input.price_usd_at_time,
     costSource: input.cost_source,
     source: 'MANUAL',
     blockTimestamp: new Date(input.block_timestamp),
   };
   ```

9. **Llamar al motor** (pueden lanzar — dejar que propaguen):
   ```typescript
   const engineResult = processTransaction({
     position: openPosition,
     priorClosedCycles,
     transaction: txInput,
     positionIdentity,
   });
   ```
   - `InsufficientBalanceError` → propagar al route handler (no capturar aquí)
   - `InvalidTransactionError` → capturar y re-lanzar como `ValidationError` con el `reason` del motor como `code`
   - `InvalidPositionStateError` → capturar y re-lanzar como `ValidationError`

10. **UPSERT positions PRIMERO** (FK constraint: transactions → positions):
    ```sql
    INSERT INTO positions (
      id, wallet_id, token_id, cycle_number, status,
      wac, balance, cost_basis, realized_pnl_usd,
      opened_at, closed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (wallet_id, token_id, cycle_number)
    DO UPDATE SET
      status           = EXCLUDED.status,
      wac              = EXCLUDED.wac,
      balance          = EXCLUDED.balance,
      cost_basis       = EXCLUDED.cost_basis,
      realized_pnl_usd = EXCLUDED.realized_pnl_usd,
      closed_at        = EXCLUDED.closed_at
    RETURNING *
    ```
    Mapear desde `engineResult.position` (camelCase → snake_case).

11. **INSERT transactions DESPUÉS** (la posición ya existe para satisfacer la FK):
    ```sql
    INSERT INTO transactions (
      wallet_id, token_id, position_id, type, source,
      tx_hash, cex_trade_id, block_timestamp, amount,
      price_usd, cost_source, created_at
    ) VALUES (
      $1, $2, $3, $4, 'MANUAL',
      NULL, NULL, $5, $6, $7, $8, now()
    )
    RETURNING *
    ```
    `position_id` = `engineResult.position.id`

12. **`client.query('COMMIT')`**

13. En bloque `finally`: **`client.release()`** (SIEMPRE, incluso en error)

14. En bloque `catch` (antes de re-lanzar): **`client.query('ROLLBACK')`** si el error no es `InsufficientBalanceError` ni `ValidationError` que ya hicieron rollback implícito.

    > Patrón correcto (igual que `createCexWallet` en `wallet.ts`): ROLLBACK en catch, release en finally.

15. **Retornar**:
    ```typescript
    return {
      transaction_id: txRow.id,
      position_id: positionRow.id,
      cycle_number: positionRow.cycle_number,
      status: positionRow.status,
      wac: positionRow.wac,
      balance: positionRow.balance,
    };
    ```

#### Flujo exacto de `listTransactions(pool, query)`

```sql
SELECT *, COUNT(*) OVER() AS total_count
FROM transactions
WHERE wallet_id = $1
  [AND token_id = $n]     -- solo si query.token_id está definido
  [AND position_id = $n]  -- solo si query.position_id está definido
ORDER BY block_timestamp DESC
LIMIT $n OFFSET $n
```

Retornar:
```typescript
{
  data: rows,
  total: rows[0]?.total_count ?? 0,
  limit: query.limit,
  offset: query.offset,
}
```

**Criterio de completitud:** todos los tests de 2.1 pasan en GREEN (`npm run test:e2e`).

---

## Fase 3 — Route plugin (TDD)

> Orden TDD obligatorio: escribir 3.1 primero (RED), luego 3.2 + 3.3 (GREEN).

### 3.1 Crear tests e2e HTTP — `tests/e2e/api/transactions.test.ts`

**Archivo:** `tests/e2e/api/transactions.test.ts`
**Acción:** NUEVO
**Runner:** `npm run test:e2e`

Seguir exactamente el patrón de `tests/e2e/api/wallets.test.ts`:
- `describe.skipIf(!testUrl)` para saltar sin DB
- `buildServer({ jwtSecret: JWT_SECRET })` + `getAuthCookie(server)`
- `resetDb()` en `beforeEach`, `server.close()` en `afterAll`
- `server.inject(...)` para todas las requests

**Tests a implementar:**

#### POST /api/transactions — happy path

- **SC-ROUTE-POST-01** `[HAPPY]` BUY exitoso → 201 `{ transaction_id, position_id, cycle_number: 1, status: 'OPEN', wac, balance }`
  - Setup: wallet ON_CHAIN + token ETH via factories

- **SC-ROUTE-POST-02** `[HAPPY]` SELL exitoso (balance suficiente) → 201 `{ status: 'OPEN', balance: '0.5' }`
  - WAC en response es igual al previo (INV-1)

- **SC-ROUTE-POST-03** `[HAPPY]` SELL total → 201 `{ status: 'CLOSED', balance: '0' }` (o equivalente decimal cero)

- **SC-ROUTE-POST-04** `[HAPPY]` BUY post-cierre → 201 `{ cycle_number: 2, status: 'OPEN' }`

- **SC-ROUTE-POST-05** `[HAPPY]` wallet CEX → 201 con `source='MANUAL'`, fila en DB tiene `tx_hash=null`, `cex_trade_id=null`
  - Setup: wallet CEX + token CEX_BINANCE via factories

#### POST /api/transactions — NEGATIVOS (obligatorios del PRD)

- **NEGATIVE-ROUTE-01** `[NEGATIVE]` SELL > balance → 400 con body `{ error: 'INSUFFICIENT_BALANCE', currentBalance: '0.5', attempted: '1.0' }`
  - Assert: fila NO insertada en `transactions`

- **NEGATIVE-ROUTE-02** `[NEGATIVE]` TRANSFER_IN con `price_usd_at_time: null` → 400 `{ code: 'PRICE_REQUIRED_FOR_TRANSFER_IN' }`

- **NEGATIVE-ROUTE-03** `[NEGATIVE]` `wallet_id` inexistente → 404 `{ code: 'WALLET_NOT_FOUND' }`

- **NEGATIVE-ROUTE-04** `[NEGATIVE]` `token_id` inexistente → 404 `{ code: 'TOKEN_NOT_FOUND' }`

- **NEGATIVE-ROUTE-05** `[NEGATIVE]` sin JWT (sin cookie `token`) → 401 `{ error: 'Unauthorized' }`
  - Probar tanto POST como GET

- **NEGATIVE-ROUTE-06** `[NEGATIVE]` body inválido (`amount` negativo, `type` desconocido) → 400 con `issues` array de Zod

#### GET /api/transactions — happy path

- **SC-ROUTE-GET-01** `[HAPPY]` listado con `wallet_id` → 200 `{ data: [3 items], total: 3, limit: 20, offset: 0 }`

- **SC-ROUTE-GET-02** `[HAPPY]` filtro `token_id` → solo transacciones del par `(wallet_id, token_id)`

- **SC-ROUTE-GET-03** `[HAPPY]` paginación `limit=2&offset=2` → `{ data: [2], total: 5, limit: 2, offset: 2 }`

- **SC-ROUTE-GET-04** `[HAPPY]` wallet sin transacciones → 200 `{ data: [], total: 0 }`

#### GET /api/transactions — NEGATIVOS

- **NEGATIVE-ROUTE-07** `[NEGATIVE]` `limit > 100` → 400 con Zod issues

- **NEGATIVE-ROUTE-08** `[NEGATIVE]` GET sin `wallet_id` → 400 con Zod issues indicando campo requerido

**Criterio de completitud:** todos los tests están en RED antes de avanzar a 3.2.

---

### 3.2 Implementar `apps/backend/src/routes/transactions.ts`

**Archivo:** `apps/backend/src/routes/transactions.ts`
**Acción:** NUEVO

Seguir exactamente el patrón de `apps/backend/src/routes/wallets.ts`.

#### Schemas Zod

```typescript
const CreateTransactionBodySchema = z.object({
  wallet_id:         z.string().uuid(),
  token_id:          z.string().uuid(),
  type:              z.enum(['BUY', 'SELL', 'SWAP_IN', 'SWAP_OUT', 'TRANSFER_IN', 'TRANSFER_OUT']),
  amount:            z.string().regex(/^\d+(\.\d+)?$/).refine(v => parseFloat(v) > 0, {
                       message: 'amount must be positive',
                     }),
  price_usd_at_time: z.string().regex(/^\d+(\.\d+)?$/).nullable(),
  block_timestamp:   z.string().datetime(),
  cost_source:       z.enum(['MARKET', 'INHERITED', 'MANUAL']).optional(),
});

const ListTransactionsQuerySchema = z.object({
  wallet_id:   z.string().uuid(),
  token_id:    z.string().uuid().optional(),
  position_id: z.string().uuid().optional(),
  limit:       z.coerce.number().int().min(1).max(100).default(20),
  offset:      z.coerce.number().int().min(0).default(0),
});
```

#### Handler POST `/`

```typescript
fastify.post('/', async (request, reply) => {
  const parseResult = CreateTransactionBodySchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.status(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      issues: parseResult.error.issues,
    });
  }

  try {
    const result = await createTransaction(pool, parseResult.data);
    return reply.status(201).send(result);
  } catch (err) {
    // Captura explícita: InsufficientBalanceError necesita body extendido
    if (err instanceof InsufficientBalanceError) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'INSUFFICIENT_BALANCE',
        message: err.message,
        currentBalance: err.currentBalance,
        attempted: err.attempted,
      });
    }
    // DomainError (ValidationError, NotFoundError) → propagar al setErrorHandler global
    throw err;
  }
});
```

#### Handler GET `/`

```typescript
fastify.get('/', async (request, reply) => {
  const parseResult = ListTransactionsQuerySchema.safeParse(request.query);
  if (!parseResult.success) {
    return reply.status(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      issues: parseResult.error.issues,
    });
  }

  const result = await listTransactions(pool, parseResult.data);
  return reply.status(200).send(result);
});
```

**Importante:** `InsufficientBalanceError` se importa desde `'../position-engine/types.js'`. NO se agrega `statusCode` a esa clase — se maneja en el route handler.

**Criterio de completitud:** el plugin compila sin errores de TypeScript.

---

### 3.3 Modificar `apps/backend/src/index.ts` — registrar transactionRoutes

**Archivo:** `apps/backend/src/index.ts`
**Acción:** MODIFICADO

Agregar después del registro de `tokenRoutes`:

```typescript
const { transactionRoutes } = await import('./routes/transactions.js');
await fastify.register(transactionRoutes, { prefix: '/api/transactions' });
```

El orden de registro es: `walletRoutes` → `tokenRoutes` → `transactionRoutes`. Mantener el comentario existente `// Domain route plugins`.

**Criterio de completitud:** todos los tests de 3.1 pasan en GREEN (`npm run test:e2e`).

---

## Fase 4 — Verificación final

### 4.1 Correr typecheck

```bash
cd apps/backend && npm run typecheck
```

**Criterio de completitud:** salida con 0 errores. Si hay errores, corregirlos antes de continuar.

---

### 4.2 Correr lint

```bash
cd apps/backend && npm run lint
```

**Criterio de completitud:** salida sin errores ni warnings de ESLint. Si hay warnings sobre `no-non-null-assertion` en el INSERT RETURNING, agregar el comentario de supresión con su justificación (igual que en `wallet.ts`).

---

### 4.3 Correr tests e2e completos

```bash
npm run test:e2e
```

**Criterio de completitud:** todos los tests pasan o son skipped por ausencia de `DATABASE_URL_TEST`. No debe haber ningún test en estado FAIL.

---

## Notas de implementación

### Orden de operaciones en transacción DB (CRÍTICO)

El orden correcto es **UPSERT positions PRIMERO**, luego INSERT transactions. La columna `transactions.position_id` tiene una FK `→ positions.id`. Si se inserta la transaction antes de que exista la posición, Postgres lanzará un error de FK constraint.

```
BEGIN
  ↓
UPSERT positions  ← FK target debe existir primero
  ↓
INSERT transactions  ← FK source referencia el id de la posición
  ↓
COMMIT
```

### Manejo de errores del motor

| Error del motor | Acción en el servicio | Resultado HTTP |
|---|---|---|
| `InsufficientBalanceError` | Propagar sin capturar | Capturar en route handler → 400 con body extendido |
| `InvalidTransactionError` | Capturar, re-lanzar como `ValidationError(reason, reason)` | Handler global → 400 |
| `InvalidPositionStateError` | Capturar, re-lanzar como `ValidationError(reason, reason)` | Handler global → 400 |

### Mapeo `PositionState` (motor) → `positions` (DB)

| Campo motor | Columna DB |
|---|---|
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

### Factories necesarias para los tests

Los tests e2e usan las factories existentes de `tests/e2e/db/factories.ts`:
- `resetDb()` — truncar todas las tablas en orden FK
- `createUser()` → `userId`
- `createOnChainWallet({ userId })` → `walletId`
- `createCexWallet(userId)` → `walletId`
- `createToken({ symbol, network, contractAddress?, binanceSymbol? })` → `tokenId`

No se necesita crear una factory para `positions` o `transactions` — se crean via el endpoint POST.

### Valor exacto de WAC en assertions

El motor opera con aritmética de strings/decimales. El valor devuelto por Postgres para columnas `NUMERIC` llega como string en `pg`. Las assertions deben comparar strings, no números flotantes:

```typescript
// Correcto
expect(result.wac).toBe('3000.00000000000000000000');
// o usar toMatch(/^3000/)

// Evitar
expect(parseFloat(result.wac)).toBeCloseTo(3000);
```

Verificar el formato exacto con el primer test real — el motor puede retornar `'3000'` o `'3000.000000000000000000'` según la precisión de Decimal.js.
