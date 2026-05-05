# Delta — US-007 · TokenService

> **Change:** `US-007-portfolio-api`
> **Capability:** TokenService — extensión mínima
> **Estado:** activo
> **Última revisión:** 2026-05-05

---

## Alcance

Agrega 1 función al servicio existente `apps/backend/src/services/token.ts`. No modifica ninguna función existente.

| Archivo | Acción |
|---------|--------|
| `apps/backend/src/services/token.ts` | MODIFICADO — agrega `findByContractAddress` |

---

## ADDED Requirements

### Requirement: Búsqueda de token por contractAddress y network

El sistema MUST proveer `findByContractAddress(pool, contractAddress, network)` que retorna el token coincidente o `null` si no existe. La búsqueda MUST ser case-insensitive en `contract_address` (usa `lower(contract_address) = lower($2)`). MUST aprovechar el índice único existente `UNIQUE (network, lower(contract_address)) WHERE contract_address IS NOT NULL`.

Si retorna `null`, el caller (PortfolioService) MUST lanzar `NotFoundError`.

#### SC-TOKEN-LOOKUP-01: token encontrado — case-insensitive

- GIVEN existe token con `network='ETH'`, `contract_address='0xAaAa...'`
- WHEN `findByContractAddress(pool, '0xaaaa...', 'ETH')` (minúsculas)
- THEN retorna el token

#### SC-TOKEN-LOOKUP-02: token inexistente → null

- GIVEN no existe token con `(contract_address='0xbbbb...', network='ETH')`
- WHEN `findByContractAddress(pool, '0xbbbb...', 'ETH')`
- THEN retorna `null`

#### SC-TOKEN-LOOKUP-03: token CEX — lookup por contract_address derivado

- GIVEN token CEX con `network='CEX_BINANCE'`, `contract_address='eth'`
- WHEN `findByContractAddress(pool, 'ETH', 'CEX_BINANCE')` (mayúsculas)
- THEN retorna el token (case-insensitive)
