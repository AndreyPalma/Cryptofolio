# Design: US-002 — DB Schema y Migraciones

## Technical Approach

Una sola migración inicial `0001_initial_schema` escrita como **archivo SQL crudo** (no JS), ejecutada por node-pg-migrate desde el workspace `db/`. ENUMs se generan a partir de un único array `as const` en TypeScript (`db/enums.ts`) que sirve simultáneamente como source of truth para SQL (vía script generador) y para tipos del backend. Pool `pg` singleton en `apps/backend/src/db/pool.ts`. Tests e2e contra `DATABASE_URL_TEST` con setup que migra antes de cada suite.

## Architecture Decisions

### Decision: ENUMs — array `as const` en TS como source of truth

**Choice**: `db/enums.ts` exporta arrays `as const` (`WALLET_TYPES = ['ON_CHAIN','CEX'] as const`, etc.). Las migraciones SQL los referencian por nombre (`CREATE TYPE wallet_type AS ENUM ('ON_CHAIN','CEX')`). El backend deriva los tipos vía `typeof WALLET_TYPES[number]`. Un test (`db/enums.test.ts`) valida que el SQL del archivo de migración contiene cada miembro del array, evitando drift.

**Alternatives considered**:
- Generar SQL desde TS en build time (más complejo, agrega step al pipeline).
- Mantener dos listas independientes (frágil, drift inevitable).

**Rationale**: PRD project standard exige `as const` sobre `enum` nativo. Validar drift por test es barato y suficiente para la escala del proyecto.

### Decision: Migraciones SQL crudas, no JS

**Choice**: Archivos `.sql` en `db/migrations/` con bloques `-- Up Migration` / `-- Down Migration` (formato node-pg-migrate v7 con `migrationFileLanguage: 'sql'`).

**Alternatives considered**:
- Migraciones JS programáticas (`pgm.createTable(...)`): API más alta pero esconde la cláusula `WHERE` de los partial unique indexes y pierde control sobre el orden de DDL.
- ORM-style migrations (Prisma, Drizzle): rechazadas en US-001 design por no soportar partial unique indexes con `WHERE`.

**Rationale**: SQL crudo es leíble por cualquier ingeniero DB, hace explícitas las cláusulas v5 críticas y elimina capa de abstracción innecesaria.

### Decision: Pool pg config

**Choice**: `new Pool({ connectionString: env.DATABASE_URL, max: 10, ssl: env.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined })`. Single-user, read-light, write-light → 10 conexiones es generoso. SSL solo cuando la URL lo pide (Supabase remoto sí, dev local no).

**Alternatives considered**:
- `pg-pool` separado: redundante, `pg.Pool` ya lo es.
- `Drizzle` o `Kysely` query builders: scope creep para US-002, se evalúa si dolor surge en US-005+.

**Rationale**: Mínimo viable, alineado a single-user.

### Decision: Test DB strategy

**Choice**: Variable nueva `DATABASE_URL_TEST` en `.env.example`. `tests/e2e/setup.ts` (vitest `globalSetup` del project `e2e`) ejecuta `npm run db:migrate -- down -1` (best effort) → `db:migrate` antes de la suite. Cada test que escribe usa `BEGIN ... ROLLBACK` o limpia con `TRUNCATE ... CASCADE` en `afterEach`.

**Alternatives considered**:
- DB efímera por test (testcontainers): overkill para single-user offline-first.
- Mismo `DATABASE_URL` con schema separado: complica el pool (tendría que `SET search_path`).

**Rationale**: Reutilizable, rápido, no requiere Docker. Cliente con Postgres ya instalado (Supabase CLI o local) lo corre sin fricción.

### Decision: Seed idempotency

**Choice**: **Fail-on-existing**. `seed.ts` empieza con `SELECT count(*) FROM users; if > 0 → console.error("DB already seeded — run 'npm run db:migrate -- down' to reset"); process.exit(1);`.

**Alternatives considered**:
- Truncate-first: peligroso si alguien lo corre por error contra DB con datos.
- Upsert: complejidad mayor, fixtures triviales no la justifican.

**Rationale**: Más seguro y obvio para single-user dev workflow. Reset explícito vs implícito.

## Data Flow

```
db/enums.ts (as const arrays)
    │
    ├── consumed by → db/migrations/0001_initial_schema.sql (CREATE TYPE)
    └── consumed by → apps/backend/src/db/types.ts (typeof exports)

apps/backend/src/env.ts (EnvSchema)
    │
    └── consumed by → apps/backend/src/db/pool.ts (singleton Pool)
                           │
                           ├── consumed by → seed.ts (via re-export from db workspace)
                           └── consumed by → tests/e2e/**/*.test.ts
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `db/migrations/0001_initial_schema.sql` | Create | Schema completo: 7 ENUMs + 7 tablas + índices + partial UNIQUEs + CHECK constraints. Up + Down. |
| `db/enums.ts` | Create | `as const` arrays para los 7 ENUMs SQL. Named exports. |
| `db/enums.test.ts` | Create | Valida que la migración SQL contiene cada miembro de cada array (drift guard). |
| `db/seed.ts` | Modify | Reemplaza placeholder. Usa pool importado desde `apps/backend`. Fail-on-existing. |
| `db/package.json` | Modify | `migrate`: `node-pg-migrate -m migrations -j sql --database-url-var DATABASE_URL up`. `seed`: `tsx seed.ts`. Añadir `pg`, `tsx` deps. |
| `db/.node-pg-migrate.json` | Create | Config: `{ "migrationFileLanguage": "sql", "schema": "public" }`. |
| `apps/backend/src/db/pool.ts` | Create | `export const pool = new Pool({...})` singleton. |
| `apps/backend/src/db/types.ts` | Create | Re-exporta `typeof X[number]` para cada ENUM de `db/enums.ts`. |
| `apps/backend/package.json` | Modify | Añadir `pg`, `@types/pg`. Reemplazar placeholders `db:migrate` / `db:seed` con delegate a workspace `db`. |
| `package.json` (raíz) | Modify | `db:migrate` y `db:seed` apuntan a `npm -w @cryptoledger/db run migrate/seed`. |
| `.env.example` | Modify | Añadir `DATABASE_URL_TEST=postgresql://postgres:postgres@localhost:5432/cryptoledger_test`. |
| `apps/backend/src/env.ts` | Modify | Añadir `DATABASE_URL_TEST: z.url().optional()` al `EnvSchema` (opcional para que prod no lo exija). |
| `tests/e2e/setup.ts` | Create | `globalSetup` del project e2e: migrate down + up usando `DATABASE_URL_TEST`. |
| `tests/e2e/db/schema.test.ts` | Create | Tests por requirement del spec `database-schema` (12 requirements). |
| `tests/e2e/db/factories.ts` | Create | Helpers para crear wallets/tokens/transactions en tests sin acoplar a `seed.ts`. |
| `vitest.workspace.ts` | Modify | Project `e2e`: agregar `globalSetup: ['./tests/e2e/setup.ts']`. |

## Interfaces / Contracts

```ts
// db/enums.ts
export const WALLET_TYPES = ['ON_CHAIN', 'CEX'] as const;
export const NETWORKS = ['ETH', 'BSC', 'CEX_BINANCE'] as const;
export const TRANSACTION_TYPES = ['BUY','SELL','SWAP_IN','SWAP_OUT','TRANSFER_IN','TRANSFER_OUT'] as const;
export const TRANSACTION_SOURCES = ['ETHERSCAN','BSCTRACE','BINANCE','MANUAL'] as const;
export const POSITION_STATUSES = ['OPEN','CLOSED'] as const;
export const COST_SOURCES = ['MARKET','INHERITED','MANUAL'] as const;
export const SERVICE_NAMES = ['ETHERSCAN','BSCTRACE','BINANCE_API_KEY','BINANCE_SECRET_KEY','TELEGRAM'] as const;

// apps/backend/src/db/types.ts
import { WALLET_TYPES, NETWORKS, /* ... */ } from "../../../../db/enums.js";
export type WalletType = typeof WALLET_TYPES[number];
export type Network = typeof NETWORKS[number];
// etc.

// apps/backend/src/db/pool.ts
import { Pool } from "pg";
import { parseEnv } from "../env.js";
const env = parseEnv();
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  ssl: env.DATABASE_URL.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
});
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|--------------|----------|
| Unit | `db/enums.ts` ↔ SQL drift | `enums.test.ts` lee el `.sql` y verifica cada miembro presente |
| E2E (project `e2e`) | Cada requirement del spec `database-schema` | `tests/e2e/db/schema.test.ts` con factories; `globalSetup` migra DB de test antes de la suite |
| E2E | Up→Down→Up reversibilidad | Test que `exec()` los tres pasos y compara `pg_indexes` + `information_schema.columns` snapshot |
| E2E | Seed determinístico | Test que corre `seed.ts` por API (importando, no spawnando) y assert counts |

**Strict TDD**: cada test del spec es RED-GREEN-REFACTOR. Orden de implementación: enums.ts (RED `enums.test.ts` por SQL inexistente) → migración SQL (GREEN) → tests e2e schema uno por uno (RED → ajuste SQL si falla → GREEN). La RED inicial del test e2e es "tabla X no existe".

## Migration / Rollout

No hay datos productivos a migrar — proyecto greenfield. Para dev: `npm run db:migrate` desde DB vacía. Si ya hay un schema previo de experimentación, `npm run db:migrate -- down` antes.

## Open Questions

- [ ] Ninguna bloqueante. Detalle menor: nombre exacto de columna `from_address` vs `from_address_lower` para matching de wallets en US-006 — se decide en US-006 (no afecta este schema).
