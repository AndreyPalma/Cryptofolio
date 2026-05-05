# Proposal: US-006 — API REST: ingreso manual de transacciones

## Contexto

US-006 es el primer punto de entrada de datos al sistema contable. Las stories US-004 (PositionEngine) y US-005 (wallets/tokens CRUD) están completas y en producción. Este cambio conecta el motor de posiciones con HTTP: expone `POST /api/transactions` para ingresar transacciones manuales y `GET /api/transactions` para consultarlas.

La particularidad central de US-006 es que no es solo un CRUD — cada `POST` dispara el motor de ciclos y persiste el estado contable resultante (posición actualizada). Eso implica una transacción DB atómica: insertar el `transaction` row y hacer upsert del `positions` row en el mismo `BEGIN/COMMIT`.

## Alcance

### Incluye
- `POST /api/transactions` — crear transacción manual, correr PositionEngine, persistir
- `GET /api/transactions` — listar transacciones con filtros y paginación
- Servicio `TransactionService` con lógica pura (testeable sin Fastify)
- Tipos TS en `apps/backend/src/types/transaction.ts`
- Tests unitarios del servicio: `apps/backend/src/services/__tests__/transaction.test.ts`
- Tests e2e HTTP: `tests/e2e/api/transactions.test.ts`

### No incluye
- Sync automático (Etherscan/Binance) — US-007+
- TRANSFER_IN cost resolution por from_address o Binance withdrawal — US-007+ (este story solo acepta `cost_source='MANUAL'` para TRANSFER_IN y exige `price_usd_at_time` explícito)
- Swap decomposition automática (dos rows vinculadas) — el usuario puede ingresar dos transacciones separadas manualmente
- Precios de mercado en tiempo real — se usa el `price_usd_at_time` que provee el caller

## Arquitectura propuesta

### Nuevos módulos

| Ruta | Responsabilidad |
|------|----------------|
| `apps/backend/src/types/transaction.ts` | Tipos TS: `Transaction`, `CreateTransactionInput`, `TransactionListQuery` |
| `apps/backend/src/services/transaction.ts` | `TransactionService`: `createTransaction`, `listTransactions` |
| `apps/backend/src/services/__tests__/transaction.test.ts` | Tests unitarios con pool mockeado |
| `apps/backend/src/routes/transactions.ts` | Fastify plugin `/api/transactions` |
| `tests/e2e/api/transactions.test.ts` | Tests e2e contra servidor real + DB de test |

### Módulos modificados

| Ruta | Cambio |
|------|--------|
| `apps/backend/src/index.ts` | Registrar `transactionRoutes` bajo `/api/transactions` |

### Flujo POST /api/transactions

```
HTTP POST /api/transactions
  │
  ├─ 1. Validación Zod del body (edge — falla 400 si schema inválido)
  │
  ├─ 2. Regla de dominio: TRANSFER_IN con price_usd_at_time=null → 400 'Price required for manual TRANSFER_IN'
  │       (esta validación va en el servicio, no en Zod, porque depende del type)
  │
  ├─ 3. Verificar que wallet_id existe y pertenece al user (via findById)
  │
  ├─ 4. Verificar que token_id existe
  │
  ├─ 5. BEGIN transaction
  │
  ├─ 6. Cargar posición OPEN activa para (wallet_id, token_id) — puede ser null
  │
  ├─ 7. Contar ciclos cerrados para (wallet_id, token_id) → priorClosedCycles
  │
  ├─ 8. Llamar processTransaction({ position, priorClosedCycles, transaction, positionIdentity })
  │       → lanza InsufficientBalanceError si SELL > balance (capturar → 400)
  │       → lanza InvalidTransactionError para casos inválidos (capturar → 400)
  │
  ├─ 9. INSERT INTO transactions (wallet_id, token_id, position_id, type, source='MANUAL', ...)
  │
  ├─ 10. INSERT INTO positions ... ON CONFLICT (wallet_id, token_id, cycle_number) DO UPDATE SET ...
  │        (upsert: si la posición ya existe por id, UPDATE; si es nueva, INSERT)
  │
  ├─ 11. COMMIT
  │
  └─ 12. Retornar 201 { transaction, position: { position_id, cycle_number, status, wac, balance } }
```

**Nota sobre positionIdentity**: cuando no existe posición OPEN (primer evento inbound), el motor necesita `positionIdentity.id` para crear el `PositionState`. Se genera un `uuid` en el servicio antes de llamar al motor, y ese mismo uuid se usa para el INSERT en `positions`.

### Flujo GET /api/transactions

```
GET /api/transactions?wallet_id=&token_id=&position_id=&limit=20&offset=0
  │
  ├─ 1. Validar query params con Zod
  ├─ 2. Construir WHERE dinámico (solo filtros presentes)
  ├─ 3. SELECT con LIMIT/OFFSET + ORDER BY block_timestamp DESC
  └─ 4. Retornar { data: Transaction[], total: number, limit, offset }
```

La paginación es por `limit`/`offset` simple — sin cursor — consistente con el alcance de V1 y los criterios de aceptación del PRD.

## Decisiones de diseño

### D1 — Atomicidad INSERT transaction + UPSERT position

La transacción DB debe ser atómica. Si el INSERT de `transactions` falla (ej: constraint violation), no se debe persistir el cambio de posición, y viceversa. Se usa un `client = pool.connect()` con `BEGIN/COMMIT/ROLLBACK` explícito, igual al patrón de `createCexWallet` en `wallet.ts`.

### D2 — source siempre 'MANUAL' en US-006

El campo `source` en el body HTTP no se acepta del caller. Se fuerza a `'MANUAL'` en el servicio. Esto garantiza que las transacciones ingresadas por este endpoint siempre sean auditables como manuales, independientemente de lo que envíe el cliente.

### D3 — Wallet ownership check

Antes de procesar, se verifica que `wallet_id` exista. La arquitectura de US-005 no tiene multi-tenancy a nivel DB (no hay `WHERE user_id = $userId` en queries de lectura), pero en US-006 se agrega la verificación de que la wallet existe — suficiente para V1 de single-user app. Si la wallet no existe → 404.

### D4 — positionIdentity generado en el servicio, no en el motor

El motor (`processTransaction`) recibe `positionIdentity` como input opcional cuando no hay posición OPEN. El UUID se genera en `TransactionService` con `crypto.randomUUID()` antes de llamar al motor. Esto mantiene el motor puro (sin side effects de generación de IDs).

### D5 — UPSERT de positions vía ON CONFLICT DO UPDATE

Cuando el motor retorna un `PositionState` con `positionWasOpened: true`, se hace INSERT. Cuando actualiza una posición existente, se hace UPDATE por `id`. Se podría usar `ON CONFLICT (wallet_id, token_id, cycle_number) DO UPDATE SET ...` para manejar ambos casos con una sola query, evitando el SELECT-then-write race condition. La constraint `positions_unique_cycle` ya existe en el schema.

### D6 — Validación TRANSFER_IN sin precio en el servicio

La regla `TRANSFER_IN con price_usd_at_time=null → 400` se evalúa en el servicio ANTES de llamar al motor. El motor también lanza `InvalidTransactionError: INBOUND_REQUIRES_PRICE` para este caso, pero el mensaje del PRD es específico ('Price required for manual TRANSFER_IN'), entonces se valida explícitamente a nivel servicio y se retorna un `ValidationError` con ese mensaje exacto.

### D7 — InsufficientBalanceError mapeado a 400 con body extendido

`InsufficientBalanceError` del motor expone `currentBalance` y `attempted`. El `setErrorHandler` global en `index.ts` no conoce estos campos extras. Se captura en el route handler y se retorna un 400 con `{ error, currentBalance, attempted }` como exige el PRD. NO se delega al handler global para este error específico.

### D8 — Paginación limit/offset con defaults

- `limit` default: 20, máximo: 100
- `offset` default: 0
- Validación Zod: `z.coerce.number().int().min(1).max(100)` para limit, `z.coerce.number().int().min(0)` para offset

## Casos de error

| Caso | HTTP | Código de error |
|------|------|----------------|
| Body inválido (Zod) | 400 | Zod issues array |
| `wallet_id` no existe | 404 | `WALLET_NOT_FOUND` |
| `token_id` no existe | 404 | `TOKEN_NOT_FOUND` |
| TRANSFER_IN sin `price_usd_at_time` | 400 | `PRICE_REQUIRED_FOR_TRANSFER_IN` |
| SELL/SWAP_OUT/TRANSFER_OUT sin posición OPEN | 400 | `OUTBOUND_WITHOUT_POSITION` |
| SELL con `amount` > `balance` | 400 | `INSUFFICIENT_BALANCE` (+ `currentBalance`, `attempted`) |
| Error desconocido del motor | 500 | `InternalServerError` |

## Rollback

Si el INSERT de `transactions` o el UPSERT de `positions` falla dentro del `BEGIN`, se ejecuta `ROLLBACK` en el bloque `finally` (patrón `wallet.ts`). El estado contable (WAC, balance, ciclos) NUNCA cambia sin que la transaction row quede persistida.

## Dependencias

- US-004 (PositionEngine.processTransaction, tipos, errores) ✅ completado
- US-005 (wallets y tokens en DB, servicio wallet.ts, errors.ts) ✅ completado
- Schema DB: tabla `transactions` y `positions` ya existen en migración 0001 ✅
