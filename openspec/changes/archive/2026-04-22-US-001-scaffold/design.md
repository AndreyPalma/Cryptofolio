# Design: US-001 — Scaffold del monorepo CryptoLedger

## Technical Approach

Greenfield scaffold bajo **npm workspaces** con dos workspaces activos (`apps/backend`, `apps/frontend`) y `packages/*` reservado vacío. TypeScript strict compartido vía `tsconfig.base.json`, ESLint 9 flat raíz, Vitest 2 con `vitest.workspace.ts` definiendo los tres projects `engine`/`sync`/`e2e`, Prettier 3, y un `.env.example` + Zod `EnvSchema` que valida al startup. Node 22 LTS pinneado. El backend arranca con `node --env-file=.env` y expone un `/health` mínimo como smoke. El frontend sirve un `App.tsx` stub con Tailwind 4 aplicado. No se crea aún `packages/shared` (diferido a US-005), ni migraciones reales (diferidas a US-002). `prototipo/` se muda a `docs/prototipo/` y queda excluido de todo el tooling. Mapea 1:1 al spec `project-scaffold`.

## Architecture Decisions

### Decision: Monorepo tool = **npm workspaces**

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| npm workspaces | Cero dep extra, nativo de Node 22, soporta hoisting y scripts con `-w`. | **Elegida** |
| pnpm | Hoisting más estricto, más rápido, pero suma CLI a instalar en Windows 11 single-dev y Render exige config extra. | Rechazada |
| Turborepo/Nx | Cache de builds; overkill para 2 apps. | Rechazada |

**Rationale**: single-developer sobre Windows 11, 2 workspaces, deploys separados en Render. Cero valor agregado de pnpm o Turborepo ahora; `npm workspaces` ya resuelve hoisting y scripts cross-workspace (`npm -w apps/backend run dev`).

### Decision: TypeScript baseline estricto en `tsconfig.base.json`

**Choice**: `strict: true` + `noUncheckedIndexedAccess: true` + `noImplicitOverride` + `verbatimModuleSyntax` + `isolatedModules` + `target: ES2023` + `skipLibCheck`. Backend extiende con `module/moduleResolution: "nodenext"`; frontend hereda `bundler` y agrega `jsx: "react-jsx"`. `exactOptionalPropertyTypes` queda OFF (fricción con Fastify/React types).

**Rationale**: alinea con el skill `typescript` (compact rules: no `any`, `as const` enums, named exports). `noUncheckedIndexedAccess` es crítico para el motor WAC que opera sobre arrays de lotes en US-004.

### Decision: Zod 4 al edge + `node --env-file`

**Choice**: Backend carga `.env` con flag nativo (`node --env-file=.env dist/index.js`), luego parsea con `EnvSchema.parse(process.env)`. Errores descriptivos por campo vía `z.url({ error: "DATABASE_URL must be a valid Postgres connection URL" })`. Falla el proceso antes de `server.listen()`.

**Rationale**: cumple literal el NEGATIVE del PRD (US-001 AC7). Zod 4 ya está en el stack — sin dep extra. `z.email()`/`z.url()` son v4-correctos (no `.string().email()` v3).

### Decision: Fastify 5 + `fastify-type-provider-zod`

**Choice**: Bootstrap con `fastify({ logger: true })`, `setValidatorCompiler`/`setSerializerCompiler` del type provider, `setErrorHandler` global que mapea `ZodError` → 400 y errores de dominio → status tipado, plugin-per-feature (en US-001 solo `health`). Nunca loggear secrets (redactor del logger).

**Rationale**: alinea con el skill `nodejs-backend-patterns`. Deja la base lista para que US-003+ agreguen plugins de auth y routes sin refactor.

### Decision: Vite 6 + React 19 + Tailwind 4 + `@tailwindcss/vite`

**Choice**: Plugin oficial v4 (no PostCSS), `src/index.css` con `@import "tailwindcss"`, `App.tsx` como stub con `cn()` de `clsx` + `tailwind-merge`, dev proxy `/api → http://localhost:3000`, env `VITE_API_URL` leída al arranque. **NO** se habilita React Compiler en US-001 (opt-in diferido, riesgo 3 del proposal).

**Rationale**: skills `react-19` (no `useMemo/useCallback`, `ref` como prop) y `tailwind-4` (class-first, tokens como CSS vars, sin `@apply` chains). El proxy evita CORS en dev sin tocar backend.

### Decision: Migration runner = **`node-pg-migrate`** (placeholder en US-001, operativo en US-002)

| Opción | Partial unique indexes con `WHERE` | Decisión |
|--------|-------------------------------------|----------|
| `node-pg-migrate` | Sí — SQL crudo vía `pgm.sql(...)` o `createIndex` con `where`. | **Elegida** |
| Supabase CLI migrations | Sí — SQL files crudos. Requiere CLI extra en Windows/Render. | Rechazada |
| Prisma Migrate | **No** expresa partial unique indexes sin `unsupported("raw sql")` — ROMPE la constraint `UNIQUE(cex_trade_id, tx_log_index) WHERE cex_trade_id IS NOT NULL`. | **Rechazada por bloqueo técnico** |
| Drizzle | Sí pero con ORM schema adicional — acopla model a migration tool. | Rechazada |

**Rationale**: las constraints de PRD v5 — `UNIQUE(tx_hash, tx_log_index) WHERE tx_hash IS NOT NULL AND source IN ('ETHERSCAN','BSCTRACE')` y `UNIQUE(cex_trade_id, tx_log_index) WHERE cex_trade_id IS NOT NULL` — requieren partial indexes. Prisma queda descartada; `node-pg-migrate` permite SQL nativo y se integra con `npm run db:migrate`. En US-001 los scripts `db:migrate`/`db:seed` son placeholders que imprimen `"placeholder: US-002 will implement"` y salen 0; la dependencia ya queda instalada.

### Decision: Test runner = **Vitest 2 con `vitest.workspace.ts`**

**Choice**: Tres projects — `engine` (globs `apps/backend/src/**/position-engine/*.{test,spec}.ts`, env `node`), `sync` (`apps/backend/src/**/sync/*.{test,spec}.ts`, env `node`, setupFiles mock HTTP), `e2e` (`tests/e2e/**/*.{test,spec}.ts`, env `node`). Scripts raíz: `test:engine → vitest run --project engine`, idem sync/e2e. Cada project recibe **al menos un test trivial pasante** (`expect(true).toBe(true)`) para que el pipeline esté verde day-one — **requisito TDD estricto**: strict TDD no puede arrancar si el runner no existe.

**Rationale**: alternativa rechazada — Jest — requiere `ts-jest` o `babel-jest`, más lento y menos ergonómico con ESM puro. Vitest es Vite-native (frontend lo usará sin fricción adicional), TS sin ceremonia, API compatible con Jest, y `workspace` permite separar suites declarativamente — no con globs dispersos en scripts.

**Strict TDD callout**: `openspec/config.yaml` declara `strict_tdd: true` pero `testing.test_runner.status: not-configured` — **ESTE** US es el que cambia ese estado. Post-apply, el siguiente change (US-002) correrá bajo strict TDD real. En US-001 la política se aplica solo a código no-trivial (p.ej. el `EnvSchema`): primero test RED (`.env` sin `DATABASE_URL` lanza con mensaje), luego implementación GREEN. Configs declarativas (tsconfig, eslint.config) no exigen test previo.

### Decision: ESLint 9 flat + Prettier 3 + `tsc --noEmit`

**Choice**: `eslint.config.js` raíz, typescript-eslint strict-type-checked, override por app (backend: `eslint-plugin-n`; frontend: `eslint-plugin-react`, `react-hooks`, `jsx-a11y`). Prettier 3 raíz, `.prettierignore` excluye `docs/` y `dist/`. `typecheck = npm -w apps/backend run typecheck && npm -w apps/frontend run typecheck`.

**Rationale**: ESLint legacy está deprecated en v9. `typescript-eslint` v8 soporta flat. Riesgo bajo — verificado en 2026-04.

### Decision: Git hooks = **`simple-git-hooks`** (no husky)

**Choice**: `simple-git-hooks` con `pre-commit: npx lint-staged`, lint-staged corre `eslint --fix` + `prettier --write` sobre staged files.

**Rationale**: husky requiere `prepare` script y tiene history de problemas en Windows con path handling; `simple-git-hooks` es ~200 líneas, instala hook nativo, funciona idéntico en Windows/macOS/Linux. Para single-developer, es suficiente.

### Decision: Deployment targets = Render (contracts only)

**Choice**: US-001 NO provisiona infra. Define los contratos que Render va a invocar:
- Backend: `buildCommand = npm ci && npm -w apps/backend run build`, `startCommand = node --env-file=.env apps/backend/dist/index.js`, env vars inyectadas desde el dashboard de Render.
- Frontend: `buildCommand = npm ci && npm -w apps/frontend run build`, `publishDir = apps/frontend/dist` (static site).

**Rationale**: PRD define Render como target pero la provisión es manual post-merge. Lo importante es que los scripts npm respeten estos entrypoints desde day-one.

## Data Flow

Flujo único relevante en US-001: **startup del backend** (smoke).

```
process.env ──[node --env-file=.env]──► EnvSchema.parse() ──► env (typed)
                                              │
                                              ├── on error: console.error(zodIssues) + process.exit(1)
                                              │
                                              ▼
                                      Fastify(logger) ──► setErrorHandler(zodError → 400)
                                              │
                                              ▼
                                      register(healthPlugin) ──► GET /health → { status: 'ok' }
                                              │
                                              ▼
                                      server.listen({ port: env.PORT, host: '0.0.0.0' })
```

### Sync flows (sequence diagrams) — DEFERIDOS

El rule `design.rules` exige sequence diagrams para sync flows (on-chain + Binance). **En US-001 se stubean intencionalmente**: no hay `OnChainSyncService` ni `BinanceSyncService` — viven en US-006 y US-007 respectivamente. Los diagramas correctos dependen del schema de BD (`wallet_sync_cursors`, `transactions`) que aterriza en US-002. Documentarlos ahora sería especular.

**Contrato**: US-006 (explore/design) MUST incluir el sequence diagram del flujo Etherscan/BSCTrace con paginación delta-by-block e idempotencia vía `UNIQUE(tx_hash, tx_log_index)`. US-007 MUST incluir el de Binance (myTrades 24h + Convert 30d + Withdrawals/Deposits 90d) con idempotencia vía `UNIQUE(cex_trade_id, tx_log_index)`.

### Idempotency strategy (stub)

US-001 no tiene endpoints de sync. Política cristalizada para todos los syncs futuros: `ON CONFLICT (...) DO NOTHING` contra las constraints compuestas parciales declaradas en US-002. Re-correr syncs es seguro por diseño. Este design reserva el runner de migraciones (`node-pg-migrate`) precisamente porque permite expresar esas constraints — cualquier tool que no las soporte INVALIDA la arquitectura de sync del PRD.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `package.json` (raíz) | Create | workspaces `["apps/*","packages/*"]`, engines Node ≥22, scripts taxonomy completa, devDeps: typescript, eslint, vitest, prettier, concurrently, simple-git-hooks, lint-staged, node-pg-migrate. |
| `tsconfig.base.json` | Create | strict baseline compartido. |
| `eslint.config.js` | Create | flat config raíz con overrides por glob. |
| `vitest.workspace.ts` | Create | 3 projects: engine, sync, e2e. |
| `.prettierrc`, `.prettierignore` | Create | Prettier 3 config; ignora `docs/`, `dist/`, `node_modules/`. |
| `.env.example` | Create | 10 vars PRD + `PORT`. `BINANCE_SECRET_KEY` (NO `BINANCE_API_SECRET`). |
| `.nvmrc` | Create | `22`. |
| `.gitignore` | Create | `node_modules/`, `dist/`, `.env`, `.env.local`, `coverage/`. |
| `apps/backend/package.json` | Create | scripts `dev` (tsx watch), `build` (tsc), `typecheck`, `db:migrate` (placeholder), `db:seed` (placeholder). |
| `apps/backend/tsconfig.json` | Create | extiende base; `module/moduleResolution: nodenext`. |
| `apps/backend/src/index.ts` | Create | bootstrap Fastify + `EnvSchema` + health plugin + listen. |
| `apps/backend/src/env.ts` | Create | `EnvSchema` Zod 4 + `export const env`. |
| `apps/backend/src/plugins/health.ts` | Create | plugin con GET `/health`. |
| `apps/backend/src/position-engine/.gitkeep` | Create | reserva para US-004, módulo puro. |
| `apps/backend/src/sync/.gitkeep` | Create | reserva para US-006/US-007. |
| `apps/backend/tests/smoke.test.ts` | Create | un test trivial para que `test:engine`/`test:sync`/`test:e2e` no fallen por "no tests". |
| `apps/frontend/package.json` | Create | scripts `dev` (vite), `build` (tsc -b + vite build), `typecheck`. |
| `apps/frontend/vite.config.ts` | Create | React plugin, `@tailwindcss/vite`, proxy `/api` → `:3000`. |
| `apps/frontend/tsconfig.json`, `tsconfig.node.json` | Create | extiende base; `bundler` moduleResolution. |
| `apps/frontend/index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css` | Create | Vite entry + Tailwind import. |
| `apps/frontend/src/lib/cn.ts` | Create | helper `cn()` (`clsx` + `tailwind-merge`). |
| `packages/.gitkeep` | Create | reserva vacía para US-005/US-007. |
| `db/migrations/.gitkeep` | Create | reserva para US-002. |
| `prototipo/` → `docs/prototipo/` | Move | paths relativos internos intactos. |
| `prd.json`, `CLAUDE.md`, `openspec/config.yaml`, `.atl/skill-registry.md` | Untouched | spec `SDD artifact safety` lo exige. |

## Interfaces / Contracts

```ts
// apps/backend/src/env.ts
import { z } from "zod";

export const EnvSchema = z.object({
  DATABASE_URL: z.url({ error: "DATABASE_URL must be a valid Postgres connection URL" }),
  JWT_SECRET: z.string().min(32, { error: "JWT_SECRET must be at least 32 chars" }),
  ENCRYPTION_KEY: z.string().length(64, { error: "ENCRYPTION_KEY must be 64 hex chars (32 bytes)" }),
  ETHERSCAN_API_KEY: z.string().min(1),
  BSCTRACE_API_KEY: z.string().min(1),
  BINANCE_API_KEY: z.string().min(1),
  BINANCE_SECRET_KEY: z.string().min(1), // NOT BINANCE_API_SECRET — v4 bugfix invariant
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  APP_PASSWORD: z.string().min(8),
  PORT: z.coerce.number().int().positive().default(3000),
});
export type Env = z.infer<typeof EnvSchema>;
export const env: Env = EnvSchema.parse(process.env);
```

```ts
// apps/backend/src/index.ts — bootstrap contract
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { env } from "./env.js";
import { healthPlugin } from "./plugins/health.js";

const server = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();
server.setValidatorCompiler(validatorCompiler);
server.setSerializerCompiler(serializerCompiler);
await server.register(healthPlugin);
await server.listen({ port: env.PORT, host: "0.0.0.0" });
```

```ts
// Root package.json — scripts contract (excerpt)
{
  "scripts": {
    "dev": "concurrently -n backend,frontend -c blue,magenta \"npm:dev:backend\" \"npm:dev:frontend\"",
    "build": "npm -w apps/backend run build && npm -w apps/frontend run build",
    "typecheck": "npm -w apps/backend run typecheck && npm -w apps/frontend run typecheck",
    "lint": "eslint .", "lint:fix": "eslint . --fix",
    "format": "prettier --write .", "format:check": "prettier --check .",
    "test": "vitest run", "test:watch": "vitest",
    "test:engine": "vitest run --project engine",
    "test:sync": "vitest run --project sync",
    "test:e2e": "vitest run --project e2e",
    "db:migrate": "npm -w apps/backend run db:migrate",
    "db:seed": "npm -w apps/backend run db:seed"
  }
}
```

## Testing Strategy

| Layer | Qué testear | Cómo |
|-------|-------------|------|
| Unit — engine | `EnvSchema` feliz y NEGATIVE (DATABASE_URL missing/malformed). `cn()` helper frontend. | Vitest project `engine`, env `node`, zero deps HTTP. |
| Unit — sync | (Placeholder) — real en US-006/007. | Project `sync` con al menos un test trivial. |
| Integration | Backend arranca y `/health` responde 200. | Project `engine` importa `buildServer()` y usa `server.inject({ url: "/health" })`. |
| E2E | (Placeholder) — real en US-013. | Project `e2e` con al menos un test trivial. |
| Quality | `typecheck`, `lint`, `format:check` exit 0. | Scripts npm raíz. |
| NEGATIVE — DATABASE_URL missing | `spawn('node', ['--env-file=.env.missing', '...'])` exit != 0, stderr contiene `DATABASE_URL`. | Project `engine`, subprocess test. |
| Coverage | No gate en US-001. | `coverage_threshold: 0` en config. |

**Strict TDD aplicado**: tests del `EnvSchema` y del NEGATIVE se escriben ANTES del código de `env.ts`. Scripts placeholder (`db:migrate`, `db:seed`) no exigen test propio — son one-liners declarativos.

## Migration / Rollout

Greenfield — no hay data migration. Rollout = `npm install` + verificar acceptance. Rollback plan detallado en `proposal.md §Rollback`. **Invariantes del rollback**:
- NUNCA tocar `prd.json`, `CLAUDE.md`, `openspec/config.yaml`, `.atl/skill-registry.md`.
- `docs/prototipo/` se restaura a `prototipo/` en raíz si el change se aborta — es un reference, no un contrato productivo; el mv es reversible.

## Open Questions

- [ ] Confirmar que `@tailwindcss/vite` en una versión estable v4 está disponible a 2026-04 (alto probabilidad; verificar en apply y fijar versión exacta).
- [ ] Confirmar `eslint-plugin-react-hooks` flat-config compatible (riesgo 5 del proposal — bajo).
- [ ] `concurrently` señales SIGINT en Windows 11: el PRD exige el paquete literalmente; si apply detecta bug de señales, ESCALAR al user antes de swapping tool.

**Assumption que podría invalidar tasks/apply**: las versiones target del explore (`Fastify 5`, `Vite 6`, `React 19`, `Tailwind 4`, `Vitest 2`, `ESLint 9`, `Zod 4`) existen en estado estable a 2026-04-21. Si alguna rompió en breaking minor entre explore (2026-04-21) y apply, el task layer debe fijar la última sub-versión compatible.
