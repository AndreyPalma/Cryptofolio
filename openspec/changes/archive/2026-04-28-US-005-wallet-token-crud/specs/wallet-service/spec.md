# Spec — US-005 · WalletService

> **Change:** `US-005-wallet-token-crud`
> **Capability:** WalletService — gestión de wallets ON_CHAIN y CEX
> **Estado:** borrador
> **Última revisión:** 2026-04-28

---

## Índice

1. [Alcance](#1-alcance)
2. [Tipos de dominio](#2-tipos-de-dominio)
3. [WalletService.create](#3-walletservicecreate)
4. [WalletService.findAll](#4-walletservicefindall)
5. [WalletService.findById](#5-walletservicefindbyid)
6. [WalletService.update](#6-walletserviceupdate)
7. [WalletService.delete](#7-walletservicedelete)
8. [Escenarios NEGATIVOS](#8-escenarios-negativos)

---

## 1. Alcance

Esta spec cubre la capa de servicio para wallets. Las validaciones de request HTTP (Zod, routing) se especifican en `specs/wallet-token-routes/spec.md`.

Archivos afectados:

| Archivo | Acción |
|---------|--------|
| `apps/backend/src/services/wallet.ts` | NUEVO |
| `apps/backend/src/types/wallet.ts` | NUEVO |

---

## 2. Tipos de dominio

```typescript
type WalletType = 'ON_CHAIN' | 'CEX'
type NetworkOnChain = 'ETH' | 'BSC'
type NetworkCex = 'CEX_BINANCE'

interface Wallet {
  id: number
  wallet_type: WalletType
  name: string
  address: string | null
  network: NetworkOnChain | NetworkCex
  created_at: string
}

interface CreateWalletInput {
  wallet_type: WalletType
  name: string
  address?: string
  network: string
}

interface UpdateWalletInput {
  name?: string
}
```

---

## 3. WalletService.create

### Requirement: Creación de wallet ON_CHAIN válida

El sistema DEBE aceptar la creación de una wallet `ON_CHAIN` si recibe `address` con checksum EIP-55 válido y `network` en `{ETH, BSC}`.

El sistema DEBE usar `ethers.getAddress(address)` (o `viem getAddress`) para validar el checksum. Si la función lanza, la address es inválida.

El sistema DEBE almacenar la address en su forma checksummed (normalizada por `ethers.getAddress`).

#### SC-WALLET-CREATE-01: creación ON_CHAIN exitosa

- GIVEN `wallet_type='ON_CHAIN'`, `address='0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'` (checksum válido), `network='ETH'`
- WHEN se llama a `WalletService.create(input)`
- THEN retorna la wallet creada con `id` generado y `address` en su forma checksummed

#### SC-WALLET-CREATE-02: creación ON_CHAIN con address en minúsculas (normalización)

- GIVEN `address='0xd8da6bf26964af9d7eed9e03e53415d37aa96045'` (sin checksum, pero hex válido), `network='BSC'`
- WHEN se llama a `WalletService.create(input)`
- THEN retorna la wallet con `address` normalizada al checksum EIP-55 correcto

### Requirement: Creación de wallet CEX válida

El sistema DEBE aceptar la creación de una wallet `CEX` si `network='CEX_BINANCE'` y `address` está ausente o es `null`.

El sistema DEBE verificar que no exista previamente ninguna wallet con `network='CEX_BINANCE'` antes de insertar. Si ya existe, DEBE lanzar un error tipado con código `'BINANCE_ALREADY_CONFIGURED'`.

#### SC-WALLET-CREATE-03: creación CEX exitosa (primera vez)

- GIVEN no existe ninguna wallet con `network='CEX_BINANCE'`
- AND `wallet_type='CEX'`, `network='CEX_BINANCE'`, sin `address`
- WHEN se llama a `WalletService.create(input)`
- THEN retorna la wallet creada con `address=null`

#### SC-WALLET-CREATE-04: segunda wallet CEX rechazada

- GIVEN ya existe una wallet con `network='CEX_BINANCE'`
- WHEN se llama a `WalletService.create({ wallet_type: 'CEX', network: 'CEX_BINANCE' })`
- THEN lanza error con código `'BINANCE_ALREADY_CONFIGURED'`

---

## 4. WalletService.findAll

### Requirement: Listado de todas las wallets

El sistema DEBE retornar todas las wallets del usuario ordenadas por `created_at ASC`.

#### SC-WALLET-LIST-01: listado exitoso

- GIVEN existen 2 wallets en la base de datos
- WHEN se llama a `WalletService.findAll()`
- THEN retorna un array con las 2 wallets

---

## 5. WalletService.findById

### Requirement: Búsqueda de wallet por ID

El sistema DEBE retornar la wallet con el `id` indicado, o `null` si no existe.

#### SC-WALLET-FIND-01: wallet encontrada

- GIVEN existe una wallet con `id=1`
- WHEN se llama a `WalletService.findById(1)`
- THEN retorna la wallet

#### SC-WALLET-FIND-02: wallet no encontrada

- GIVEN no existe ninguna wallet con `id=999`
- WHEN se llama a `WalletService.findById(999)`
- THEN retorna `null`

---

## 6. WalletService.update

### Requirement: Actualización de nombre de wallet

El sistema DEBE permitir actualizar el campo `name` de una wallet existente. No se permiten cambios de `wallet_type`, `address` ni `network` post-creación.

#### SC-WALLET-UPDATE-01: actualización exitosa

- GIVEN existe una wallet con `id=1` y `name='Mi wallet'`
- WHEN se llama a `WalletService.update(1, { name: 'Wallet principal' })`
- THEN la wallet actualizada tiene `name='Wallet principal'`

#### SC-WALLET-UPDATE-02: wallet inexistente

- GIVEN no existe ninguna wallet con `id=999`
- WHEN se llama a `WalletService.update(999, { name: 'X' })`
- THEN lanza error con código `'WALLET_NOT_FOUND'`

---

## 7. WalletService.delete

### Requirement: Eliminación de wallet

El sistema DEBE eliminar la wallet indicada. Si no existe, DEBE lanzar un error tipado con código `'WALLET_NOT_FOUND'`.

#### SC-WALLET-DELETE-01: eliminación exitosa

- GIVEN existe una wallet con `id=1`
- WHEN se llama a `WalletService.delete(1)`
- THEN la wallet ya no existe en la base de datos

#### SC-WALLET-DELETE-02: wallet inexistente

- GIVEN no existe ninguna wallet con `id=999`
- WHEN se llama a `WalletService.delete(999)`
- THEN lanza error con código `'WALLET_NOT_FOUND'`

---

## 8. Escenarios NEGATIVOS

Estos casos son requeridos explícitamente por el PRD. Son obligatorios.

### NEGATIVE-W-01: ON_CHAIN sin address → error tipado

- GIVEN `wallet_type='ON_CHAIN'`, sin campo `address`, `network='ETH'`
- WHEN se llama a `WalletService.create(input)`
- THEN lanza error con código `'ADDRESS_REQUIRED'` y mensaje `'Address required for on-chain wallet'`

### NEGATIVE-W-02: ON_CHAIN con address sin checksum válido → error tipado

- GIVEN `wallet_type='ON_CHAIN'`, `address='0xINVALIDA'`, `network='ETH'`
- WHEN se llama a `WalletService.create(input)`
- THEN lanza error con código `'INVALID_ADDRESS'` y mensaje `'Invalid Ethereum address'`

### NEGATIVE-W-03: ON_CHAIN con network inválida

- GIVEN `wallet_type='ON_CHAIN'`, `address` válida, `network='POLYGON'`
- WHEN se llama a `WalletService.create(input)`
- THEN lanza error con código `'INVALID_NETWORK'`

### NEGATIVE-W-04: CEX con address presente → error tipado

- GIVEN `wallet_type='CEX'`, `network='CEX_BINANCE'`, `address='0xABC...'`
- WHEN se llama a `WalletService.create(input)`
- THEN lanza error con código `'CEX_ADDRESS_NOT_ALLOWED'`
