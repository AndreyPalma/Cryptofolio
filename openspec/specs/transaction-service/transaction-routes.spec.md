# Spec — US-006 · Transaction Routes (HTTP)

> **Change:** `US-006-manual-transactions`
> **Capability:** Endpoints HTTP `/api/transactions`
> **Estado:** borrador
> **Última revisión:** 2026-04-28

---

## Índice

1. [Alcance](#1-alcance)
2. [Autenticación](#2-autenticación)
3. [POST /api/transactions](#3-post-apitransactions)
4. [GET /api/transactions](#4-get-apitransactions)
5. [Escenarios NEGATIVOS de HTTP](#5-escenarios-negativos-de-http)

---

## 1. Alcance

Esta spec cubre los endpoints HTTP de transacciones. La lógica de dominio (motor, ciclos, WAC) se especifica en `specs/transaction-service/transaction-service.spec.md`.

Archivos afectados:

| Archivo | Acción |
|---------|--------|
| `apps/backend/src/routes/transactions.ts` | NUEVO |
| `apps/backend/src/index.ts` | MODIFICADO — registrar `transactionRoutes` bajo `/api/transactions` |
| `tests/e2e/api/transactions.test.ts` | NUEVO |

---

## 2. Autenticación

Todos los endpoints bajo `/api/transactions` MUST requerir autenticación JWT.

El token JWT MUST ser enviado en la cookie `httpOnly` `token` (consistente con la arquitectura de auth de US-003).

Cualquier request sin JWT válido MUST retornar `401 Unauthorized` con body `{ error: 'Unauthorized' }`.

---

## 3. POST /api/transactions

### 3.1 Request

**Method:** `POST`
**Path:** `/api/transactions`
**Content-Type:** `application/json`

#### Body schema (Zod)

```typescript
z.object({
  wallet_id:         z.string().uuid(),
  token_id:          z.string().uuid(),
  type:              z.enum(['BUY', 'SELL', 'SWAP_IN', 'SWAP_OUT', 'TRANSFER_IN', 'TRANSFER_OUT']),
  amount:            z.string().regex(/^\d+(\.\d+)?$/).refine(v => parseFloat(v) > 0),
  price_usd_at_time: z.string().regex(/^\d+(\.\d+)?$/).nullable(),
  block_timestamp:   z.string().datetime(),
  cost_source:       z.enum(['MARKET', 'INHERITED', 'MANUAL']).optional(),
})
```

**Campos requeridos:** `wallet_id`, `token_id`, `type`, `amount`, `price_usd_at_time` (puede ser `null`), `block_timestamp`

**Campos opcionales:** `cost_source`

**Campos rechazados:** `source`, `tx_hash`, `cex_trade_id` — el servicio los fuerza a `'MANUAL'` y `null` respectivamente; si el caller los envía, MUST ser ignorados o rechazados por el schema.

### 3.2 Response exitosa

**Status:** `201 Created`
**Content-Type:** `application/json`

```typescript
{
  transaction_id: string   // UUID de la transacción creada
  position_id:   string   // UUID de la posición afectada
  cycle_number:  number   // número de ciclo (1, 2, ...)
  status:        'OPEN' | 'CLOSED'
  wac:           string   // WAC resultante como string numérico
  balance:       string   // balance resultante como string numérico
}
```

### 3.3 Scenarios de respuesta exitosa

#### SC-ROUTE-POST-01: BUY exitoso — 201

- GIVEN JWT válido en cookie `token`
- AND wallet `W1` y token `T1` existen, sin posición previa
- WHEN `POST /api/transactions` con `{ wallet_id: W1, token_id: T1, type: 'BUY', amount: '1.0', price_usd_at_time: '3000.00', block_timestamp: '2026-01-01T00:00:00Z' }`
- THEN responde `201` con `{ transaction_id, position_id, cycle_number: 1, status: 'OPEN', wac: '3000', balance: '1' }`

#### SC-ROUTE-POST-02: SELL exitoso — 201

- GIVEN JWT válido, posición OPEN con `balance='1.0'`
- WHEN `POST /api/transactions` con `{ type: 'SELL', amount: '0.5', price_usd_at_time: '4000.00', ... }`
- THEN responde `201` con `{ status: 'OPEN', balance: '0.5' }`
- AND `wac` en response es igual al WAC previo (SELL no modifica WAC)

### 3.4 Responses de error

#### 400 — Body inválido (Zod)

```json
{
  "error": "Bad Request",
  "issues": [ /* array de Zod validation issues */ ]
}
```

Casos que disparan este 400:
- `wallet_id` no es UUID válido
- `token_id` no es UUID válido
- `type` no es un valor del enum
- `amount` es negativo o cero
- `block_timestamp` no es ISO-8601 datetime

#### 400 — TRANSFER_IN sin precio

```json
{
  "error": "Price required for manual TRANSFER_IN",
  "code": "PRICE_REQUIRED_FOR_TRANSFER_IN"
}
```

Condición: `type='TRANSFER_IN'` y `price_usd_at_time=null`.

#### 400 — SELL con amount mayor al balance

```json
{
  "error": "Insufficient balance",
  "code": "INSUFFICIENT_BALANCE",
  "currentBalance": "0.5",
  "attempted": "1.0"
}
```

**Nota:** Este error MUST ser capturado explícitamente en el route handler (no delegado al error handler global) para incluir los campos `currentBalance` y `attempted` en el body.

#### 404 — wallet_id no existe

```json
{
  "error": "Wallet not found",
  "code": "WALLET_NOT_FOUND"
}
```

#### 404 — token_id no existe

```json
{
  "error": "Token not found",
  "code": "TOKEN_NOT_FOUND"
}
```

#### 401 — Sin JWT

```json
{
  "error": "Unauthorized"
}
```

---

## 4. GET /api/transactions

### 4.1 Request

**Method:** `GET`
**Path:** `/api/transactions`

#### Query params schema (Zod)

```typescript
z.object({
  wallet_id:   z.string().uuid(),
  token_id:    z.string().uuid().optional(),
  position_id: z.string().uuid().optional(),
  limit:       z.coerce.number().int().min(1).max(100).default(20),
  offset:      z.coerce.number().int().min(0).default(0),
})
```

**Parámetros requeridos:** `wallet_id`

**Parámetros opcionales:** `token_id`, `position_id`, `limit`, `offset`

### 4.2 Response exitosa

**Status:** `200 OK`
**Content-Type:** `application/json`

```typescript
{
  data: Transaction[]   // array de transacciones; ver tipo en transaction-service.spec.md § 2
  total:  number        // total de filas que coinciden con los filtros (sin limit/offset)
  limit:  number        // limit aplicado
  offset: number        // offset aplicado
}
```

Los elementos en `data` MUST estar ordenados por `block_timestamp DESC`.

### 4.3 Scenarios de respuesta exitosa

#### SC-ROUTE-GET-01: listado con wallet_id — 200

- GIVEN JWT válido, 3 transacciones para `wallet_id=W1`
- WHEN `GET /api/transactions?wallet_id=W1`
- THEN responde `200` con `{ data: [3 items], total: 3, limit: 20, offset: 0 }`

#### SC-ROUTE-GET-02: listado con filtros opcionales — 200

- GIVEN JWT válido, transacciones para `(W1, T1)` y `(W1, T2)`
- WHEN `GET /api/transactions?wallet_id=W1&token_id=T1`
- THEN `data` contiene solo transacciones de `(W1, T1)`

#### SC-ROUTE-GET-03: paginación — 200

- GIVEN JWT válido, 5 transacciones para `wallet_id=W1`
- WHEN `GET /api/transactions?wallet_id=W1&limit=2&offset=2`
- THEN responde `{ data: [2 items], total: 5, limit: 2, offset: 2 }`

#### SC-ROUTE-GET-04: sin transacciones — 200 vacío

- GIVEN JWT válido, wallet `W1` sin transacciones
- WHEN `GET /api/transactions?wallet_id=W1`
- THEN responde `200` con `{ data: [], total: 0, limit: 20, offset: 0 }`

### 4.4 Responses de error

#### 400 — Parámetros inválidos

```json
{
  "error": "Bad Request",
  "issues": [ /* Zod issues */ ]
}
```

Casos: `wallet_id` faltante o no UUID, `limit` fuera de rango `[1, 100]`, `offset` negativo.

#### 401 — Sin JWT

```json
{
  "error": "Unauthorized"
}
```

---

## 5. Escenarios NEGATIVOS de HTTP

Estos casos derivan de los NEGATIVE criteria del PRD. Son **obligatorios** en los tests e2e.

### NEGATIVE-ROUTE-01: SELL > balance → 400 con currentBalance y attempted

- GIVEN JWT válido, posición OPEN con `balance='0.5'`
- WHEN `POST /api/transactions` con `{ type: 'SELL', amount: '1.0', price_usd_at_time: '4000.00' }`
- THEN responde `400` con body que incluye `currentBalance: '0.5'` y `attempted: '1.0'`
- AND la transacción NO queda en DB

### NEGATIVE-ROUTE-02: TRANSFER_IN sin precio → 400

- GIVEN JWT válido, wallet y token válidos
- WHEN `POST /api/transactions` con `{ type: 'TRANSFER_IN', amount: '1.0', price_usd_at_time: null }`
- THEN responde `400` con `{ code: 'PRICE_REQUIRED_FOR_TRANSFER_IN', error: 'Price required for manual TRANSFER_IN' }`

### NEGATIVE-ROUTE-03: wallet_id inválido → 404

- GIVEN JWT válido
- WHEN `POST /api/transactions` con `wallet_id` que no existe en DB
- THEN responde `404` con `{ code: 'WALLET_NOT_FOUND' }`

### NEGATIVE-ROUTE-04: token_id inválido → 404

- GIVEN JWT válido, wallet válida
- WHEN `POST /api/transactions` con `token_id` que no existe en DB
- THEN responde `404` con `{ code: 'TOKEN_NOT_FOUND' }`

### NEGATIVE-ROUTE-05: sin JWT → 401

- GIVEN no hay cookie `token` en el request (o el token es inválido/expirado)
- WHEN `POST /api/transactions` o `GET /api/transactions`
- THEN responde `401` con `{ error: 'Unauthorized' }`

### NEGATIVE-ROUTE-06: GET sin wallet_id → 400

- GIVEN JWT válido
- WHEN `GET /api/transactions` sin `wallet_id` en query params
- THEN responde `400` con issues de Zod indicando que `wallet_id` es requerido
