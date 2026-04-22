# Proposal: US-001 — Scaffold del monorepo

> Exploración y tradeoffs completos en [`explore.md`](./explore.md). Este proposal cristaliza decisiones.

## Intent

Bootstreamos el monorepo para que las otras 12 user stories tengan terreno firme: estructura `apps/`, TypeScript strict compartido, ESLint/Vitest/Prettier operativos, y env vars validadas con Zod que fallan rápido ante missing/malformed. Sin este change, nada arranca.

## Scope

### In Scope
- npm workspaces: `apps/backend` (Fastify 5 + TS), `apps/frontend` (Vite 6 + React 19 + Tailwind 4), `packages/*` reservado vacío.
- `tsconfig.base.json` strict + `eslint.config.js` flat + `vitest.workspace.ts` (projects `engine`/`sync`/`e2e` con suites vacías) + Prettier 3.
- `.env.example` con las 10 vars del PRD + `PORT`. Backend carga via `node --env-file=.env` y valida con Zod al startup — falla descriptiva por campo.
- Scripts raíz: `dev`, `build`, `typecheck`, `lint`, `lint:fix`, `format`, `format:check`, `test`, `test:watch`, `test:engine`, `test:sync`, `test:e2e`, `db:migrate`, `db:seed` (+ `:backend`/`:frontend` donde aplica).
- `concurrently` orquestando `dev` (PRD lo nombra literal).
- Node 22 LTS pinneado (`.nvmrc=22`, `engines.node>=22`).
- Mover `prototipo/` → `docs/prototipo/`, excluirlo del tooling.

### Out of Scope
- Tests reales — placeholders vacíos. Reales en US-004 (engine), US-008-A/B (sync), e2e story.
- `db:migrate`/`db:seed` como placeholder: backend imprime `"placeholder: US-002 will implement"` y exit 0.
- DB schema, auth, routes, UI — cada uno tiene su US.
- CI/CD (Render deploy) — no está en US-001.

## Capabilities

### New Capabilities
- `project-scaffold`: estructura del monorepo, taxonomía de scripts npm, tooling (TS/ESLint/Vitest/Prettier), y contrato de env validation con el NEGATIVE del PRD (`DATABASE_URL` faltante → backend no arranca con mensaje descriptivo).

### Modified Capabilities
None — greenfield.

## Approach

| Eje | Decisión |
|-----|----------|
| Orquestación | npm workspaces, `workspaces: ["apps/*","packages/*"]` |
| Dev paralelo | `concurrently` (PRD literal) |
| TS base | strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` + `isolatedModules` |
| Lint | ESLint 9 flat + typescript-eslint strict |
| Tests | Vitest 2 workspace projects (`engine`/`sync`/`e2e`) |
| Env | `node --env-file=.env` + Zod `EnvSchema.parse()` al startup |
| Node | 22 LTS |
| `prototipo/` | Movido a `docs/prototipo/`, excluido del tooling |
| `packages/shared` | Diferido a US-005/US-007; workspaces ya lo soporta sin refactor |

Invariantes del PRD a preservar desde este scaffold: `BINANCE_SECRET_KEY` (no `_API_SECRET`, bug v4), single-user (cero tenant middleware), `apps/backend/src/position-engine/` reservado como módulo puro para US-004 (sin cross-cutting deps).

## Affected Areas

| Área | Impacto | Detalle |
|------|---------|---------|
| `package.json` (raíz) | Nuevo | workspaces, scripts, devDeps compartidas |
| `apps/backend/` | Nuevo | Fastify bootstrap, env loader, health route stub |
| `apps/frontend/` | Nuevo | Vite + React 19 + Tailwind 4, `App.tsx` stub |
| `tsconfig.base.json`, `eslint.config.js`, `vitest.workspace.ts` | Nuevo | tooling |
| `.env.example`, `.nvmrc`, `.prettierrc`, `.prettierignore`, `.gitignore` | Nuevo | config |
| `prototipo/` → `docs/prototipo/` | Movido | excluido de lint/typecheck/format |
| `CLAUDE.md` | Follow-up (fuera de este change) | actualizar referencias `prototipo/` → `docs/prototipo/` después del apply |

## Risks

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| Vitest workspace + Fastify ESM setup frágil | Media | Validar config en apply antes de declarar done; fallback a scripts con path globs |
| React Compiler (opt-in) rompe con React 19 current | Baja | Plugin opcional; apagable sin bloquear scaffold |
| `concurrently` SIGINT en Windows | Baja | PRD lo pide; si falla, escalamos al user antes de cambiar tool |
| `@tailwindcss/vite` v4 bugs | Baja | Plugin oficial v4, maduro a 2026-04 |

## Rollback Plan

Greenfield — rollback = borrar todo lo creado. Si US-001 se aborta:

1. `rm -rf apps/ docs/prototipo/ packages/ node_modules/`
2. `rm package.json package-lock.json tsconfig.base.json eslint.config.js vitest.workspace.ts .env.example .nvmrc .prettierrc .prettierignore .gitignore`
3. `mv docs/prototipo prototipo` (restaurar ubicación original)
4. `rmdir docs` si quedó vacío
5. `rm -rf openspec/changes/US-001-scaffold` (opcional, limpia SDD artifacts)

Con git committeado antes de apply: `git reset --hard <pre-US-001>`.

## Dependencies

Ninguna. Raíz del DAG. Blocker de US-002 → US-013.

## Originating User Story

**US-001** de `prd.json`. Acceptance criteria completos en `explore.md § Context` y cubiertos por la sección "In Scope" de arriba.

## Success Criteria

- [ ] `npm install` en raíz sin errores.
- [ ] `npm run dev` arranca backend `:3000` + frontend `:5173` con prefijos en log.
- [ ] `npm run build` genera `apps/backend/dist/` y `apps/frontend/dist/`.
- [ ] `npm run typecheck`, `lint`, `format:check` exit 0.
- [ ] `npm run test:engine`, `test:sync`, `test:e2e` exit 0 con suites vacías.
- [ ] `npm run db:migrate` y `db:seed` retornan placeholder sin crashear.
- [ ] Backend sin `DATABASE_URL` falla con mensaje tipo `"DATABASE_URL must be a valid Postgres connection URL"`.
- [ ] `docs/prototipo/CryptoLedger.html` carga sin roto (paths relativos intactos).
- [ ] `openspec/config.yaml` + `.atl/skill-registry.md` intactos — este change no los toca.
