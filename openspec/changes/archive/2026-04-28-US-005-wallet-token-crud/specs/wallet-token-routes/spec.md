# Spec — US-005 · Route Plugins walletRoutes y tokenRoutes

> **Change:** `US-005-wallet-token-crud`
> **Capability:** Route plugins HTTP para `/api/wallets` y `/api/tokens`
> **Estado:** borrador
> **Última revisión:** 2026-04-28

---

## Índice

1. [Alcance](#1-alcance)
2. [Autenticación](#2-autenticacion)
3. [Schemas Zod](#3-schemas-zod)
4. [Endpoints de wallets](#4-endpoints-de-wallets)
5. [Endpoints de tokens](#5-endpoints-de-tokens)
6. [Contratos de error](#6-contratos-de-error)
7. [Escenarios NEGATIVOS](#7-escenarios-negativos)

---

## 1. Alcance

Esta spec cubre los dos plugins Fastify que exponen los endpoints REST. La lógica de negocio y validación de dominio se especifica en las specs de WalletService y TokenService.

Archivos afectados:

| Archivo | Acción |
|---------|--------|
| `apps/backend/src/routes/wallets.ts` | NUEVO |
| `apps/backend/src/routes/tokens.ts` | NUEVO |
| `apps/backend/src/index.ts` | MODIFICADO — registra ambos plugins |

---

## 2. Autenticación

Todos los endpoints de wallets y tokens DEBEN estar protegidos con `preHandler: [fastify.authenticate]`.

Una request sin JWT válido DEBE recibir `401 { "error": "Unauthorized" }` antes de que el handler procese el body.

#### SC-AUTH-01: request sin token a cualquier endpoint protegido

- GIVEN el cliente no tiene cookie `token`
- WHEN se envía cualquier request a `/api/wallets` o `/api/tokens`
- THEN la respuesta es `401 { "error": "Unauthorized" }`

---

## 3. Schemas Zod

### 3.1. Wallets

```typescript
const CreateWalletBodySchema = z.object({
  wallet_type: z.enum(['ON_CHAIN', 'CEX']),
  name: z.string().min(1),
  address: z.string().optional(),
  network: z.string().min(1),
})

const UpdateWalletBodySchema = z.object({
  name: z.string().min(1),
})

const WalletIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
})
```

### 3.2. Tokens

```typescript
const CreateTokenBodySchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  network: z.string().min(1),
  contract_address: z.string().optional(),
  binance_symbol: z.string().optional(),
})

const UpdateTokenBodySchema = z.object({
  is_hidden: z.boolean().optional(),
  target_exit_price: z.string().nullable().optional(),
  binance_symbol: z.string().nullable().optional(),
})

const TokenIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
})

const TokenQuerySchema = z.object({
  network: z.string().optional(),
  includeHidden: z.coerce.boolean().optional().default(false),
})
```

---

## 4. Endpoints de wallets

### Requirement: POST /api/wallets

El sistema DEBE crear la wallet delegando en `WalletService.create()`. Ante error tipado del servicio, DEBE mapear al código HTTP correspondiente:

| Código de error del servicio | HTTP | Mensaje |
|-----------------------------|------|---------|
| `ADDRESS_REQUIRED` | 400 | `'Address required for on-chain wallet'` |
| `INVALID_ADDRESS` | 400 | `'Invalid Ethereum address'` |
| `INVALID_NETWORK` | 400 | `'Invalid network for wallet type'` |
| `CEX_ADDRESS_NOT_ALLOWED` | 400 | `'CEX wallet must not have an address'` |
| `BINANCE_ALREADY_CONFIGURED` | 409 | `'Binance account already configured'` |

Respuesta exitosa: `201` con la wallet creada.

#### SC-WALLET-POST-01: creación ON_CHAIN exitosa → 201

- GIVEN JWT válido en cookie
- AND body `{ wallet_type: 'ON_CHAIN', name: 'Mi wallet', address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', network: 'ETH' }`
- WHEN se envía `POST /api/wallets`
- THEN la respuesta es `201` con la wallet creada

#### SC-WALLET-POST-02: creación CEX exitosa → 201

- GIVEN JWT válido y no existe wallet CEX_BINANCE
- AND body `{ wallet_type: 'CEX', name: 'Binance', network: 'CEX_BINANCE' }` (sin address)
- WHEN se envía `POST /api/wallets`
- THEN la respuesta es `201` con `address: null`

### Requirement: GET /api/wallets

El sistema DEBE retornar `200` con el array de wallets.

#### SC-WALLET-GET-01: listado exitoso

- GIVEN JWT válido
- WHEN se envía `GET /api/wallets`
- THEN la respuesta es `200` con array de wallets (puede ser vacío)

### Requirement: GET /api/wallets/:id

El sistema DEBE retornar `200` con la wallet, o `404` si no existe.

#### SC-WALLET-GET-ID-01: wallet encontrada → 200

- GIVEN JWT válido y existe wallet con `id=1`
- WHEN se envía `GET /api/wallets/1`
- THEN la respuesta es `200` con la wallet

#### SC-WALLET-GET-ID-02: wallet no encontrada → 404

- GIVEN JWT válido y no existe wallet con `id=999`
- WHEN se envía `GET /api/wallets/999`
- THEN la respuesta es `404 { "error": "Wallet not found" }`

### Requirement: PUT /api/wallets/:id

El sistema DEBE actualizar la wallet y retornar `200`, o `404` si no existe.

#### SC-WALLET-PUT-01: actualización exitosa → 200

- GIVEN JWT válido y existe wallet con `id=1`
- AND body `{ name: 'Wallet actualizada' }`
- WHEN se envía `PUT /api/wallets/1`
- THEN la respuesta es `200` con la wallet actualizada

### Requirement: DELETE /api/wallets/:id

El sistema DEBE eliminar la wallet y retornar `204`, o `404` si no existe.

#### SC-WALLET-DELETE-01: eliminación exitosa → 204

- GIVEN JWT válido y existe wallet con `id=1`
- WHEN se envía `DELETE /api/wallets/1`
- THEN la respuesta es `204` sin body

---

## 5. Endpoints de tokens

### Requirement: GET /api/tokens

El sistema DEBE retornar `200` con el array de tokens aplicando los filtros del query string.

#### SC-TOKEN-GET-01: filtro ?network=CEX_BINANCE

- GIVEN JWT válido y existen tokens en ETH y CEX_BINANCE
- WHEN se envía `GET /api/tokens?network=CEX_BINANCE`
- THEN la respuesta contiene únicamente tokens con `network='CEX_BINANCE'`

#### SC-TOKEN-GET-02: ?includeHidden=true incluye ocultos

- GIVEN JWT válido y existe un token con `is_hidden=true`
- WHEN se envía `GET /api/tokens?includeHidden=true`
- THEN la respuesta incluye el token oculto

### Requirement: POST /api/tokens

El sistema DEBE crear el token delegando en `TokenService.create()`. Ante error tipado del servicio, DEBE mapear:

| Código de error | HTTP | Mensaje |
|-----------------|------|---------|
| `BINANCE_SYMBOL_REQUIRED` | 400 | `'binance_symbol is required for CEX tokens'` |
| `CONTRACT_ADDRESS_REQUIRED` | 400 | `'contract_address is required for on-chain tokens'` |
| `TOKEN_ALREADY_EXISTS` | 409 | `'Token already exists'` |

Respuesta exitosa: `201` con el token creado.

#### SC-TOKEN-POST-01: creación CEX exitosa → 201 con contract_address auto-generado

- GIVEN JWT válido
- AND body `{ symbol: 'BNB', name: 'BNB', network: 'CEX_BINANCE', binance_symbol: 'BNBUSDT' }`
- WHEN se envía `POST /api/tokens`
- THEN la respuesta es `201` con `contract_address='bnb'`

### Requirement: PUT /api/tokens/:id

El sistema DEBE actualizar los campos editables del token y retornar `200`, o `404` si no existe.

#### SC-TOKEN-PUT-01: actualización exitosa → 200

- GIVEN JWT válido y existe token con `id=1`
- AND body `{ is_hidden: true, target_exit_price: '3000.00' }`
- WHEN se envía `PUT /api/tokens/1`
- THEN la respuesta es `200` con los campos actualizados

---

## 6. Contratos de error

Todos los errores DEBEN usar el siguiente formato:

```json
{ "statusCode": 400, "error": "Bad Request", "message": "<mensaje>" }
```

Errores de validación Zod (body/query inválido) siguen el formato estándar de Fastify. El servidor NUNCA DEBE exponer stack traces en producción.

---

## 7. Escenarios NEGATIVOS

Estos escenarios son requeridos explícitamente por el PRD. Son obligatorios.

### NEGATIVE-R-01: POST /api/wallets ON_CHAIN sin address → 400

- GIVEN JWT válido
- AND body `{ wallet_type: 'ON_CHAIN', name: 'X', network: 'ETH' }` (sin address)
- WHEN se envía `POST /api/wallets`
- THEN la respuesta es `400 { "message": "Address required for on-chain wallet" }`

### NEGATIVE-R-02: segundo POST /api/wallets CEX → 400

- GIVEN JWT válido y ya existe una wallet CEX_BINANCE
- AND body `{ wallet_type: 'CEX', name: 'Binance 2', network: 'CEX_BINANCE' }`
- WHEN se envía `POST /api/wallets`
- THEN la respuesta es `400 { "message": "Binance account already configured" }`

### NEGATIVE-R-03: POST /api/wallets ON_CHAIN con address inválida → 400

- GIVEN JWT válido
- AND body `{ wallet_type: 'ON_CHAIN', name: 'X', address: '0xINVALIDA', network: 'ETH' }`
- WHEN se envía `POST /api/wallets`
- THEN la respuesta es `400 { "message": "Invalid Ethereum address" }`

### NEGATIVE-R-04: cualquier endpoint sin JWT → 401

- GIVEN el cliente no tiene cookie `token`
- WHEN se envía cualquier request a `/api/wallets` o `/api/tokens`
- THEN la respuesta es `401 { "error": "Unauthorized" }`
- AND el handler de la ruta NO es invocado
