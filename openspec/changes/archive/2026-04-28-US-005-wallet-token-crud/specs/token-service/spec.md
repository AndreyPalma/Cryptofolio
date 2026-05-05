# Spec — US-005 · TokenService

> **Change:** `US-005-wallet-token-crud`
> **Capability:** TokenService — gestión de tokens ON_CHAIN y CEX
> **Estado:** borrador
> **Última revisión:** 2026-04-28

---

## Índice

1. [Alcance](#1-alcance)
2. [Tipos de dominio](#2-tipos-de-dominio)
3. [TokenService.create](#3-tokenservicecreate)
4. [TokenService.findAll](#4-tokenservicefindall)
5. [TokenService.update](#5-tokenserviceupdate)
6. [Escenarios NEGATIVOS](#6-escenarios-negativos)

---

## 1. Alcance

Esta spec cubre la capa de servicio para tokens. Los endpoints HTTP se especifican en `specs/wallet-token-routes/spec.md`.

Archivos afectados:

| Archivo | Acción |
|---------|--------|
| `apps/backend/src/services/token.ts` | NUEVO |
| `apps/backend/src/types/token.ts` | NUEVO |

---

## 2. Tipos de dominio

```typescript
interface Token {
  id: number
  symbol: string
  name: string
  contract_address: string
  network: string
  binance_symbol: string | null
  is_hidden: boolean
  target_exit_price: string | null
  created_at: string
}

interface CreateTokenInput {
  symbol: string
  name: string
  network: string
  contract_address?: string
  binance_symbol?: string
}

interface UpdateTokenInput {
  is_hidden?: boolean
  target_exit_price?: string | null
  binance_symbol?: string | null
}

interface FindAllTokensFilter {
  network?: string
  includeHidden?: boolean
}
```

---

## 3. TokenService.create

### Requirement: Creación de token CEX

El sistema DEBE auto-generar `contract_address = symbol.toLowerCase()` cuando `network='CEX_BINANCE'`. El campo `contract_address` del input DEBE ser ignorado (no permitido externamente).

El sistema DEBE requerir `binance_symbol` para tokens CEX (`network='CEX_BINANCE'`).

#### SC-TOKEN-CREATE-01: creación CEX exitosa con auto-generación de contract_address

- GIVEN `symbol='ETH'`, `name='Ethereum'`, `network='CEX_BINANCE'`, `binance_symbol='ETHUSDT'`
- WHEN se llama a `TokenService.create(input)`
- THEN retorna el token creado con `contract_address='eth'` (symbol en minúsculas)

#### SC-TOKEN-CREATE-02: contract_address externo ignorado en token CEX

- GIVEN `symbol='BTC'`, `network='CEX_BINANCE'`, `contract_address='custom-value'`, `binance_symbol='BTCUSDT'`
- WHEN se llama a `TokenService.create(input)`
- THEN `contract_address` del token almacenado es `'btc'`, no `'custom-value'`

### Requirement: Creación de token ON_CHAIN

El sistema DEBE requerir `contract_address` explícito para tokens on-chain (`network ∈ {ETH, BSC}`).

#### SC-TOKEN-CREATE-03: creación ON_CHAIN exitosa

- GIVEN `symbol='USDC'`, `name='USD Coin'`, `network='ETH'`, `contract_address='0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'`
- WHEN se llama a `TokenService.create(input)`
- THEN retorna el token creado con `contract_address='0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'`

---

## 4. TokenService.findAll

### Requirement: Listado con filtros opcionales

El sistema DEBE retornar tokens aplicando los filtros `network` e `includeHidden`.

- Si `includeHidden=false` (o ausente), DEBE excluir tokens con `is_hidden=true`.
- Si `includeHidden=true`, DEBE incluir todos los tokens independientemente de `is_hidden`.
- Si `network` está presente, DEBE retornar únicamente tokens con esa network.

#### SC-TOKEN-LIST-01: filtro por network=CEX_BINANCE

- GIVEN existen tokens en redes ETH, BSC y CEX_BINANCE
- WHEN se llama a `TokenService.findAll({ network: 'CEX_BINANCE' })`
- THEN retorna únicamente los tokens con `network='CEX_BINANCE'`

#### SC-TOKEN-LIST-02: tokens ocultos excluidos por defecto

- GIVEN existe un token con `is_hidden=true` y otro con `is_hidden=false`
- WHEN se llama a `TokenService.findAll({})`
- THEN el resultado NO incluye el token oculto

#### SC-TOKEN-LIST-03: includeHidden=true incluye tokens ocultos

- GIVEN existe un token con `is_hidden=true`
- WHEN se llama a `TokenService.findAll({ includeHidden: true })`
- THEN el resultado incluye el token oculto

---

## 5. TokenService.update

### Requirement: Actualización de campos editables

El sistema DEBE permitir actualizar únicamente los campos `is_hidden`, `target_exit_price` y `binance_symbol`. Todos son opcionales — solo se modifican los campos presentes en el input.

Si `target_exit_price` es `null`, DEBE almacenarse como `NULL` en la base de datos.

#### SC-TOKEN-UPDATE-01: marcar token como oculto

- GIVEN existe un token con `id=1` y `is_hidden=false`
- WHEN se llama a `TokenService.update(1, { is_hidden: true })`
- THEN la token actualizada tiene `is_hidden=true`

#### SC-TOKEN-UPDATE-02: establecer target_exit_price

- GIVEN existe un token con `id=1` y `target_exit_price=null`
- WHEN se llama a `TokenService.update(1, { target_exit_price: '5000.00' })`
- THEN la token actualizada tiene `target_exit_price='5000.00'`

#### SC-TOKEN-UPDATE-03: limpiar target_exit_price

- GIVEN existe un token con `id=1` y `target_exit_price='5000.00'`
- WHEN se llama a `TokenService.update(1, { target_exit_price: null })`
- THEN la token actualizada tiene `target_exit_price=null`

#### SC-TOKEN-UPDATE-04: actualizar binance_symbol

- GIVEN existe un token CEX con `id=1`
- WHEN se llama a `TokenService.update(1, { binance_symbol: 'ETHBTC' })`
- THEN la token actualizada tiene `binance_symbol='ETHBTC'`

#### SC-TOKEN-UPDATE-05: token inexistente

- GIVEN no existe ningún token con `id=999`
- WHEN se llama a `TokenService.update(999, { is_hidden: true })`
- THEN lanza error con código `'TOKEN_NOT_FOUND'`

---

## 6. Escenarios NEGATIVOS

### NEGATIVE-T-01: token CEX sin binance_symbol

- GIVEN `symbol='ETH'`, `network='CEX_BINANCE'`, sin `binance_symbol`
- WHEN se llama a `TokenService.create(input)`
- THEN lanza error con código `'BINANCE_SYMBOL_REQUIRED'`

### NEGATIVE-T-02: token ON_CHAIN sin contract_address

- GIVEN `symbol='USDC'`, `network='ETH'`, sin `contract_address`
- WHEN se llama a `TokenService.create(input)`
- THEN lanza error con código `'CONTRACT_ADDRESS_REQUIRED'`

### NEGATIVE-T-03: colisión de contract_address en tokens CEX

- GIVEN ya existe un token con `network='CEX_BINANCE'` y `contract_address='eth'`
- WHEN se llama a `TokenService.create({ symbol: 'ETH', network: 'CEX_BINANCE', binance_symbol: 'ETHUSDT' })`
- THEN lanza error con código `'TOKEN_ALREADY_EXISTS'` (propagado desde la constraint UNIQUE de la DB)
