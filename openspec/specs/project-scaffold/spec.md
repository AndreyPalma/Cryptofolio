# project-scaffold Specification

## Purpose

Define el comportamiento observable del scaffold del monorepo CryptoLedger: estructura `apps/`, tooling (TypeScript, ESLint, Vitest, Prettier), orquestación de scripts npm, validación de env vars con Zod y fail-fast, reubicación de `prototipo/` y pin de Node 22 LTS. Habilita US-002 … US-013.

## Invariants (PRD, preservar verbatim)

1. `BINANCE_SECRET_KEY` es el nombre canónico. El scaffold SHALL NOT introducir `BINANCE_API_SECRET` en `.env.example`, `EnvSchema`, ni en ningún otro archivo — es el bug legacy corregido en PRD v4.
2. Single-user: el scaffold SHALL NOT crear middleware multi-tenant, tablas de tenants, ni hooks de contexto por usuario.
3. `apps/backend/src/position-engine/` queda reservado como módulo puro para US-004. El scaffold MUST crearlo vacío (o con `.gitkeep`) y MUST NOT importar allí dependencias de framework (Fastify, Supabase client, HTTP clients).

## Requirements

### Requirement: Monorepo install

El sistema MUST soportar `npm install` desde la raíz sin errores, usando `workspaces: ["apps/*", "packages/*"]`.

#### Scenario: Fresh install en raíz

- GIVEN clon limpio del repo con `package.json` raíz declarando workspaces y sin `node_modules/`
- WHEN se ejecuta `npm install` en la raíz
- THEN el comando MUST terminar con exit code 0
- AND `node_modules/` raíz MUST contener las dependencias hoisted de `apps/backend` y `apps/frontend`

### Requirement: Dev server concurrente

`npm run dev` MUST arrancar backend y frontend en paralelo vía `concurrently`, con prefijos por app.

#### Scenario: Arranque paralelo

- GIVEN `.env` válido en la raíz y deps instaladas
- WHEN se ejecuta `npm run dev`
- THEN backend MUST escuchar en `http://localhost:3000`
- AND frontend (Vite) MUST servir en `http://localhost:5173`
- AND la salida MUST llevar prefijos `backend` y `frontend` con colores distintos (`concurrently -n backend,frontend -c blue,magenta`)

### Requirement: Build de producción

`npm run build` MUST emitir artefactos de ambos workspaces.

#### Scenario: Build exitoso

- GIVEN workspace sin errores de tipo ni de lint
- WHEN se ejecuta `npm run build`
- THEN exit code MUST ser 0
- AND `apps/backend/dist/` MUST contener el bundle Node compilado
- AND `apps/frontend/dist/` MUST contener el bundle Vite (HTML + assets)

### Requirement: Quality gates

Los scripts `typecheck`, `lint` y `format:check` MUST pasar en verde sobre el scaffold inicial.

#### Scenario: Typecheck de ambos apps

- GIVEN el scaffold recién creado sin código de negocio
- WHEN se ejecuta `npm run typecheck`
- THEN MUST invocar `tsc --noEmit` en backend y frontend
- AND MUST terminar con exit code 0

#### Scenario: Lint sin warnings

- GIVEN `eslint.config.js` flat con typescript-eslint strict y overrides por app
- WHEN se ejecuta `npm run lint`
- THEN exit code MUST ser 0
- AND stdout MUST reportar cero warnings (cumple quality gate del PRD: "ESLint sin warnings")

#### Scenario: Format check

- GIVEN todos los archivos formateados con Prettier 3
- WHEN se ejecuta `npm run format:check`
- THEN exit code MUST ser 0

### Requirement: Test suite split (Vitest workspace)

Los scripts `test:engine`, `test:sync`, `test:e2e` MUST existir como projects separados del Vitest workspace, aunque las suites estén vacías.

#### Scenario: Projects vacíos exit 0

- GIVEN `vitest.workspace.ts` con projects `engine`, `sync`, `e2e` apuntando a globs sin archivos `.test.ts`
- WHEN se ejecuta cualquiera de `npm run test:engine`, `npm run test:sync`, `npm run test:e2e`
- THEN exit code MUST ser 0
- AND Vitest MAY reportar "No test files found" sin fallar

### Requirement: DB placeholders

`npm run db:migrate` MUST aplicar la migración inicial `0001_initial_schema.sql` (provista por `database-schema`) usando node-pg-migrate, creando el schema híbrido on-chain/CEX completo. `npm run db:seed` MUST insertar los fixtures determinísticos del seed real (1 user + 3 wallets + tokens + transacciones de prueba). Los placeholders introducidos por US-001 quedan reemplazados por la implementación real.

(Previously: ambos scripts existían como placeholders que solo imprimían `"placeholder: US-002 will implement"` y terminaban exit 0, sin tocar la DB.)

#### Scenario: Migrate aplica schema sobre DB limpia

- GIVEN scripts declarados en `db/package.json` y expuestos en la raíz, con `DATABASE_URL` apuntando a una DB Postgres vacía
- WHEN se ejecuta `npm run db:migrate`
- THEN exit code MUST ser 0
- AND la DB MUST contener las tablas, ENUMs, índices y constraints definidos en el spec `database-schema`
- AND stdout MUST NOT contener la cadena `"placeholder"` (evidencia de que ya no es el stub de US-001)

#### Scenario: Seed inserta fixtures sobre schema migrado

- GIVEN schema migrado en DB limpia
- WHEN se ejecuta `npm run db:seed`
- THEN exit code MUST ser 0
- AND `SELECT COUNT(*) FROM wallets` MUST devolver `3` (1 ETH + 1 BSC + 1 CEX_BINANCE)
- AND stdout MUST NOT contener la cadena `"placeholder"`

### Requirement: Env loading (happy path)

El backend MUST cargar `.env` vía `node --env-file=.env` y validar con Zod `EnvSchema.parse(process.env)` al startup.

#### Scenario: .env válido arranca el server

- GIVEN `.env` que cumple todos los campos requeridos (`DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `ETHERSCAN_API_KEY`, `BSCTRACE_API_KEY`, `BINANCE_API_KEY`, `BINANCE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `APP_PASSWORD`, `PORT`)
- WHEN el backend arranca con `node --env-file=.env ...`
- THEN `EnvSchema.parse(process.env)` MUST resolver sin lanzar
- AND el server MUST escuchar en el `PORT` configurado

### Requirement: Env validation — missing DATABASE_URL (NEGATIVE)

El backend SHALL NOT arrancar de forma silenciosa si `DATABASE_URL` falta o está vacío.

#### Scenario: DATABASE_URL ausente

- GIVEN `.env` sin la línea `DATABASE_URL=` (o con valor vacío)
- WHEN el backend arranca
- THEN el proceso MUST terminar con exit code distinto de 0
- AND stderr MUST contener el literal `DATABASE_URL` identificándolo como campo faltante/inválido
- AND el server SHALL NOT quedar escuchando en ningún puerto

### Requirement: Env validation — malformed DATABASE_URL (NEGATIVE)

El backend MUST rechazar un `DATABASE_URL` que no sea una URL válida, con mensaje descriptivo.

#### Scenario: DATABASE_URL no es URL

- GIVEN `.env` con `DATABASE_URL=not-a-url`
- WHEN el backend arranca
- THEN el proceso MUST terminar con exit code distinto de 0
- AND stderr MUST nombrar `DATABASE_URL` y MUST indicar que debe ser una Postgres connection URL válida (ej: `"DATABASE_URL must be a valid Postgres connection URL"`, usando `z.url({ error: ... })` de Zod 4)

### Requirement: Env naming invariant (BINANCE_SECRET_KEY)

`.env.example` y el `EnvSchema` del backend MUST usar `BINANCE_SECRET_KEY`. SHALL NOT aparecer el legacy `BINANCE_API_SECRET` en ningún archivo del scaffold.

#### Scenario: Nombre canónico en .env.example

- GIVEN `.env.example` generado por el scaffold
- WHEN se busca el string `BINANCE_API_SECRET`
- THEN no MUST haber coincidencias en `.env.example`, `apps/backend/src/**`, ni `apps/frontend/src/**`
- AND `.env.example` MUST declarar una línea `BINANCE_SECRET_KEY=` con placeholder
- AND el `EnvSchema` de backend MUST tener la property `BINANCE_SECRET_KEY: z.string().min(1)`

### Requirement: Prototipo relocation

`prototipo/` MUST moverse a `docs/prototipo/` preservando paths relativos internos.

#### Scenario: HTML carga tras el mv

- GIVEN el repo con `prototipo/` en la raíz antes del scaffold
- WHEN se aplica el scaffold
- THEN la carpeta original MUST desaparecer y `docs/prototipo/CryptoLedger.html` MUST existir
- AND abrir `docs/prototipo/CryptoLedger.html` en un browser MUST renderizar el prototipo sin 404s sobre sus `.jsx` hermanos (los paths relativos dentro de la carpeta MUST quedar intactos)

### Requirement: Tooling exclusions

`docs/` MUST quedar excluido del lint, typecheck y format check del scaffold.

#### Scenario: docs/ ignorado por las tres herramientas

- GIVEN `docs/prototipo/` con archivos `.jsx` no-TS y HTML con scripts inline
- WHEN se ejecutan `npm run lint`, `npm run typecheck` y `npm run format:check`
- THEN ninguno MUST reportar errores originados en `docs/**`
- AND la exclusión MUST estar declarada en `eslint.config.js` (ignores), `tsconfig.base.json` / `tsconfig.*.json` (exclude) y `.prettierignore`

### Requirement: Node 22 LTS pin

El proyecto MUST fijar Node 22 LTS como única versión soportada.

#### Scenario: .nvmrc y engines coherentes

- GIVEN scaffold recién aplicado
- WHEN se inspecciona la raíz
- THEN `.nvmrc` MUST contener exactamente `22` (seguido de newline)
- AND `package.json` raíz MUST declarar `"engines": { "node": ">=22.0.0" }`

### Requirement: Position-engine reservado

`apps/backend/src/position-engine/` MUST existir como módulo vacío reservado para US-004 y MUST NOT contener imports de framework.

#### Scenario: Directorio presente sin cross-cutting deps

- GIVEN scaffold aplicado
- WHEN se inspecciona `apps/backend/src/position-engine/`
- THEN el directorio MUST existir (puede estar vacío o contener solo `.gitkeep` / `index.ts` con comentario TODO US-004)
- AND MUST NOT importar `fastify`, `@supabase/*`, ni HTTP clients — preserva la pureza para el motor WAC

### Requirement: SDD artifact safety

Este change SHALL NOT modificar artefactos de gobernanza ya existentes.

#### Scenario: Archivos protegidos intactos

- GIVEN el estado del repo antes del apply
- WHEN se aplica US-001-scaffold
- THEN los diffs sobre `openspec/config.yaml`, `.atl/skill-registry.md`, `prd.json` y `CLAUDE.md` MUST ser vacíos
- AND el scaffold solo MUST crear archivos nuevos de config raíz (`package.json`, `tsconfig.base.json`, `eslint.config.js`, `vitest.workspace.ts`, `.env.example`, `.nvmrc`, `.prettierrc`, `.prettierignore`, `.gitignore`) y la estructura `apps/`, `docs/prototipo/`, `packages/` (este último vacío o con `.gitkeep`)
