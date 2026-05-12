# Spec — US-006 · TransactionService

> **Change:** `US-006-manual-transactions`
> **Capability:** TransactionService — ingreso manual de transacciones y consulta
> **Estado:** borrador
> **Última revisión:** 2026-04-28

---

## Índice

1. [Alcance](#1-alcance)
2. [Tipos de dominio](#2-tipos-de-dominio)
3. [Invariantes del dominio](#3-invariantes-del-dominio)
4. [TransactionService.createTransaction](#4-transactionservicecreatetransaction)
5. [TransactionService.listTransactions](#5-transactionservicelisttransactions)
6. [Ciclo de vida completo de una posición](#6-ciclo-de-vida-completo-de-una-posición)
7. [Escenarios NEGATIVOS](#7-escenarios-negativos)

---

## 1. Alcance

Esta spec cubre la capa de servicio para transacciones manuales. Las validaciones de request HTTP (Zod, routing) se especifican en `specs/transaction-service/transaction-routes.spec.md`.

Archivos afectados:

| Archivo                                                   | Acción |
| --------------------------------------------------------- | ------ |
| `apps/backend/src/services/transaction.ts`                | NUEVO  |
| `apps/backend/src/types/transaction.ts`                   | NUEVO  |
| `apps/backend/src/services/__tests__/transaction.test.ts` | NUEVO  |

**No incluye:** sync automático (Alchemy/Binance), TRANSFER_IN cost resolution por `from_address` o Binance withdrawal, swap decomposition automática, precios de mercado en tiempo real. Estos son US-007+.

---

## 2. Tipos de dominio

```typescript
type TransactionType = "BUY" | "SELL" | "SWAP_IN" | "SWAP_OUT" | "TRANSFER_IN" | "TRANSFER_OUT";
type TransactionSource = "ALCHEMY" | "BINANCE" | "MANUAL";
type CostSource = "MARKET" | "INHERITED" | "MANUAL";
type PositionStatus = "OPEN" | "CLOSED";

interface Transaction {
  id: string; // UUID
  wallet_id: string;
  token_id: string;
  position_id: string | null;
  type: TransactionType;
  source: TransactionSource; // siempre 'MANUAL' en US-006
  tx_hash: null; // siempre null para MANUAL
  cex_trade_id: null; // siempre null para MANUAL
  block_timestamp: string; // ISO-8601
  amount: string; // NUMERIC como string
  price_usd: string | null;
  cost_source: CostSource | null;
  created_at: string;
}

interface CreateTransactionInput {
  wallet_id: string;
  token_id: string;
  type: TransactionType;
  amount: string;
  price_usd_at_time: string | null;
  block_timestamp: string; // ISO-8601
  cost_source?: CostSource;
}

interface CreateTransactionResult {
  transaction_id: string;
  position_id: string;
  cycle_number: number;
  status: PositionStatus;
  wac: string;
  balance: string;
}

interface TransactionListQuery {
  wallet_id: string;
  token_id?: string;
  position_id?: string;
  limit?: number; // default 20, max 100
  offset?: number; // default 0
}

interface TransactionListResult {
  data: Transaction[];
  total: number;
  limit: number;
  offset: number;
}
```

---

## 3. Invariantes del dominio

Las siguientes invariantes provienen del PRD (`prd.json → resolvedDecisions y rules`) y DEBEN preservarse verbatim. Ninguna decisión de implementación puede violarlas.

### INV-1 — WAC puro

> **WAC solo recalcula en eventos inbound: `BUY`, `SWAP_IN`, `TRANSFER_IN`. Los eventos outbound (`SELL`, `SWAP_OUT`, `TRANSFER_OUT`) reducen balance pero NUNCA modifican WAC.**

El `TransactionService` MUST delegar el cálculo de WAC al `PositionEngine` sin modificar ni cachear el WAC antes de que el motor retorne. MUST NOT calcular WAC independientemente.

### INV-2 — Ciclos de posición

> **Cuando el balance de una posición llega a 0 el status cambia a `CLOSED` y el `realized_pnl_usd` queda congelado. El próximo evento inbound abre una nueva posición con `cycle_number = max_ciclos_cerrados + 1`. WAC del nuevo ciclo parte desde cero — no hay carry-over del ciclo anterior.**

El servicio MUST leer `priorClosedCycles` via COUNT de posiciones CLOSED para `(wallet_id, token_id)` antes de llamar al motor cuando no hay posición OPEN.

### INV-3 — Identidad de token por fuente

> **ETH on-chain `(contract_address, network∈{ETH,BSC})` y ETH en Binance `(symbol.toLowerCase(), 'CEX_BINANCE')` son tokens distintos con WAC independiente. El dashboard NUNCA debe agregarlos.**

El servicio MUST respetar el `token_id` recibido tal cual. MUST NOT resolver ni unificar tokens de distinta fuente.

### INV-4 — source siempre 'MANUAL'

El campo `source` en `transactions` MUST ser forzado a `'MANUAL'` por el servicio, independientemente de lo que envíe el caller. `tx_hash` y `cex_trade_id` MUST ser `null` para todas las transacciones de este endpoint.

### INV-5 — Atomicidad

El INSERT de `transactions` y el UPSERT de `positions` MUST ejecutarse en la misma transacción de base de datos (`BEGIN/COMMIT`). Si cualquiera falla, se ejecuta `ROLLBACK` y ningún cambio queda persistido.

---

## 4. TransactionService.createTransaction

### Requirement: POST exitoso — BUY abre posición nueva

El servicio MUST verificar que `wallet_id` existe antes de procesar. Si no existe, MUST lanzar un error tipado con código `'WALLET_NOT_FOUND'`.

El servicio MUST verificar que `token_id` existe antes de procesar. Si no existe, MUST lanzar un error tipado con código `'TOKEN_NOT_FOUND'`.

El servicio MUST validar que TRANSFER_IN con `price_usd_at_time=null` es inválido ANTES de llamar al motor. MUST lanzar un error tipado con código `'PRICE_REQUIRED_FOR_TRANSFER_IN'` y mensaje `'Price required for manual TRANSFER_IN'`.

El servicio MUST generar un `positionIdentity.id` con `crypto.randomUUID()` cuando no existe posición OPEN activa para el par `(wallet_id, token_id)`.

El servicio MUST llamar a `PositionEngine.processTransaction()` pasando la posición actual (o `null`), los ciclos cerrados previos, el `TransactionInput`, y el `positionIdentity` cuando corresponda.

El servicio MUST persistir el resultado en una transacción DB atómica: INSERT en `transactions` + UPSERT en `positions`.

#### SC-TX-CREATE-01: BUY exitoso — posición nueva

- GIVEN existe una wallet con `wallet_id=W1` y un token con `token_id=T1`
- AND no existe ninguna posición para `(W1, T1)`
- AND `input = { wallet_id: W1, token_id: T1, type: 'BUY', amount: '1.0', price_usd_at_time: '3000.00', block_timestamp: '2026-01-01T00:00:00Z' }`
- WHEN se llama a `TransactionService.createTransaction(input)`
- THEN retorna `{ transaction_id, position_id, cycle_number: 1, status: 'OPEN', wac: '3000.00', balance: '1.0' }`
- AND la posición en DB tiene `status='OPEN'`, `wac='3000.00'`, `balance='1.0'`, `cycle_number=1`
- AND la transacción en DB tiene `source='MANUAL'`, `tx_hash=null`, `cex_trade_id=null`, `type='BUY'`

#### SC-TX-CREATE-02: SELL exitoso — balance suficiente

- GIVEN existe una posición OPEN para `(W1, T1)` con `balance='1.0'`, `wac='3000.00'`
- AND `input = { wallet_id: W1, token_id: T1, type: 'SELL', amount: '0.5', price_usd_at_time: '4000.00', block_timestamp: '2026-01-02T00:00:00Z' }`
- WHEN se llama a `TransactionService.createTransaction(input)`
- THEN retorna `{ transaction_id, position_id, cycle_number: 1, status: 'OPEN', balance: '0.5' }`
- AND `wac` no cambia (INV-1: SELL no modifica WAC)
- AND la posición en DB tiene `balance='0.5'` y `status='OPEN'`

#### SC-TX-CREATE-03: TRANSFER_IN con price_usd_at_time

- GIVEN existe una wallet `W1` y token `T1`
- AND no existe posición OPEN para `(W1, T1)`
- AND `input = { type: 'TRANSFER_IN', amount: '2.0', price_usd_at_time: '1500.00', block_timestamp: '2026-01-01T00:00:00Z', cost_source: 'MANUAL' }`
- WHEN se llama a `TransactionService.createTransaction(input)`
- THEN retorna `{ status: 'OPEN', wac: '1500.00', balance: '2.0', cycle_number: 1 }`
- AND `cost_source='MANUAL'` queda persistido en la transacción

---

## 5. TransactionService.listTransactions

### Requirement: Consulta paginada de transacciones

El servicio MUST retornar las transacciones que coincidan con los filtros provistos, ordenadas por `block_timestamp DESC`.

El servicio MUST soportar los filtros: `wallet_id` (requerido), `token_id` (opcional), `position_id` (opcional).

El servicio MUST aplicar paginación `limit`/`offset` con default `limit=20`, máximo `limit=100`, default `offset=0`.

El servicio MUST retornar el campo `total` con el COUNT total de filas que coinciden con los filtros (sin aplicar limit/offset) para permitir que el caller calcule páginas.

#### SC-TX-LIST-01: listado con filtro wallet_id

- GIVEN existen 3 transacciones para `wallet_id=W1` y 2 para `wallet_id=W2`
- WHEN se llama a `TransactionService.listTransactions({ wallet_id: W1, limit: 20, offset: 0 })`
- THEN retorna `{ data: [3 transacciones], total: 3, limit: 20, offset: 0 }`
- AND las transacciones están ordenadas por `block_timestamp DESC`

#### SC-TX-LIST-02: listado con filtro token_id

- GIVEN existen transacciones para `(W1, T1)` y `(W1, T2)`
- WHEN se llama a `TransactionService.listTransactions({ wallet_id: W1, token_id: T1 })`
- THEN retorna solo las transacciones para el par `(W1, T1)`

#### SC-TX-LIST-03: paginación offset

- GIVEN existen 5 transacciones para `wallet_id=W1`
- WHEN se llama con `limit=2, offset=2`
- THEN retorna `{ data: [2 transacciones], total: 5, limit: 2, offset: 2 }`

#### SC-TX-LIST-04: wallet sin transacciones

- GIVEN existe `wallet_id=W1` pero no tiene transacciones
- WHEN se llama a `TransactionService.listTransactions({ wallet_id: W1 })`
- THEN retorna `{ data: [], total: 0, limit: 20, offset: 0 }`

---

## 6. Ciclo de vida completo de una posición

Este escenario verifica la correcta implementación de INV-2 (ciclos de posición) a través de múltiples llamadas al servicio.

#### SC-TX-LIFECYCLE-01: BUY → SELL total → ciclo 2

- GIVEN existe wallet `W1` y token `T1` sin historial previo

**Paso 1 — Apertura ciclo 1:**

- WHEN `createTransaction({ type: 'BUY', amount: '1.0', price_usd_at_time: '2000.00' })`
- THEN `{ cycle_number: 1, status: 'OPEN', wac: '2000.00', balance: '1.0' }`

**Paso 2 — SELL total (cierre ciclo 1):**

- WHEN `createTransaction({ type: 'SELL', amount: '1.0', price_usd_at_time: '3000.00' })`
- THEN `{ cycle_number: 1, status: 'CLOSED', balance: '0.0' }`
- AND la posición en DB tiene `status='CLOSED'`, `closed_at IS NOT NULL`, `realized_pnl_usd` congelado

**Paso 3 — BUY nuevo (apertura ciclo 2):**

- WHEN `createTransaction({ type: 'BUY', amount: '0.5', price_usd_at_time: '2500.00' })`
- THEN `{ cycle_number: 2, status: 'OPEN', wac: '2500.00', balance: '0.5' }`
- AND el WAC del ciclo 2 es `2500.00`, no hereda el WAC del ciclo 1 (INV-2)
- AND la posición cerrada del ciclo 1 sigue intacta en DB con `status='CLOSED'`

---

## 7. Escenarios NEGATIVOS

Estos casos son requeridos explícitamente por el PRD (`acceptanceCriteria → NEGATIVE:`). Son **obligatorios**.

### NEGATIVE-TX-01: SELL con amount mayor al balance

- GIVEN existe una posición OPEN para `(W1, T1)` con `balance='0.5'`
- WHEN `createTransaction({ type: 'SELL', amount: '1.0', price_usd_at_time: '4000.00' })`
- THEN lanza `InsufficientBalanceError` con `currentBalance='0.5'` y `attempted='1.0'`
- AND NO se persiste ningún cambio en DB (atomicidad garantizada por INV-5)

### NEGATIVE-TX-02: TRANSFER_IN sin price_usd_at_time

- GIVEN existe wallet `W1` y token `T1`
- WHEN `createTransaction({ type: 'TRANSFER_IN', amount: '1.0', price_usd_at_time: null })`
- THEN lanza error con código `'PRICE_REQUIRED_FOR_TRANSFER_IN'` y mensaje exacto `'Price required for manual TRANSFER_IN'`
- AND el error se lanza ANTES de llamar al motor (validación de servicio, D6)

### NEGATIVE-TX-03: wallet_id inexistente

- GIVEN no existe ninguna wallet con `wallet_id='uuid-inexistente'`
- WHEN `createTransaction({ wallet_id: 'uuid-inexistente', ... })`
- THEN lanza error con código `'WALLET_NOT_FOUND'`

### NEGATIVE-TX-04: token_id inexistente

- GIVEN existe wallet `W1` pero no existe ningún token con `token_id='uuid-inexistente'`
- WHEN `createTransaction({ wallet_id: W1, token_id: 'uuid-inexistente', ... })`
- THEN lanza error con código `'TOKEN_NOT_FOUND'`

### NEGATIVE-TX-05: SELL sin posición OPEN

- GIVEN existe wallet `W1` y token `T1` sin ninguna posición (ni OPEN ni CLOSED)
- WHEN `createTransaction({ type: 'SELL', amount: '1.0', price_usd_at_time: '1000.00' })`
- THEN lanza `InvalidTransactionError` con `reason='OUTBOUND_WITHOUT_POSITION'`
- AND NO se persiste ningún cambio en DB

### NEGATIVE-TX-06: SWAP_OUT sin posición OPEN

- GIVEN existe wallet `W1` y token `T1` sin posición OPEN
- WHEN `createTransaction({ type: 'SWAP_OUT', amount: '1.0', price_usd_at_time: '1000.00' })`
- THEN lanza `InvalidTransactionError` con `reason='OUTBOUND_WITHOUT_POSITION'`
