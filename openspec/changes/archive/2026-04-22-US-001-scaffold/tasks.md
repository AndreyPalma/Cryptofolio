# Tasks: US-001 — Scaffold del monorepo CryptoLedger

## Fase 1: Infraestructura de monorepo

- [ ] 1.1 Crear `package.json` raíz con `workspaces: ["apps/*","packages/*"]`, `engines: { "node": ">=22.0.0" }` y la taxonomía completa de scripts (ver sección 7).
- [ ] 1.2 Crear `.nvmrc` con contenido `22\n`.
- [ ] 1.3 Crear `.gitignore` (node_modules, dist, .env, .env.local, coverage).
- [ ] 1.4 Crear `.editorconfig` (indent_size=2, end_of_line=lf, charset=utf-8).
- [ ] 1.5 Crear `.env.example` con las 10 vars PRD + `PORT`. Usar `BINANCE_SECRET_KEY` — jamás `BINANCE_API_SECRET`.
- [ ] 1.6 Mover `prototipo/` → `docs/prototipo/` preservando paths relativos internos.
- [ ] 1.7 Crear `packages/.gitkeep` y `db/migrations/.gitkeep` (reservas vacías).

## Fase 2: Tooling de calidad

- [ ] 2.1 Crear `tsconfig.base.json` con `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride`, `verbatimModuleSyntax`, `isolatedModules`, `target: ES2023`, `skipLibCheck`, `exactOptionalPropertyTypes: false`.
- [ ] 2.2 Crear `eslint.config.js` flat (ESLint 9): typescript-eslint strict-type-checked, overrides por glob (backend: `eslint-plugin-n`; frontend: react + react-hooks + jsx-a11y), `ignores: ["docs/**","dist/**","node_modules/**"]`.
- [ ] 2.3 Crear `.prettierrc` (Prettier 3, tabWidth 2, singleQuote false) y `.prettierignore` (docs/, dist/, node_modules/).
- [ ] 2.4 Crear `vitest.workspace.ts` con tres projects: `engine` (glob `apps/backend/src/**/position-engine/*.{test,spec}.ts`), `sync` (glob `apps/backend/src/**/sync/*.{test,spec}.ts`), `e2e` (glob `tests/e2e/**/*.{test,spec}.ts`).
- [ ] 2.5 Configurar `simple-git-hooks` + `lint-staged` en `package.json` raíz (`pre-commit: npx lint-staged`).

## Fase 3: Backend scaffold (`apps/backend`)

- [ ] 3.1 Crear `apps/backend/package.json` con scripts `dev` (tsx watch), `build` (tsc), `typecheck`, `db:migrate` (placeholder), `db:seed` (placeholder). Deps: fastify, fastify-type-provider-zod, zod. DevDeps: tsx, typescript.
- [ ] 3.2 Crear `apps/backend/tsconfig.json` extendiendo base; `module/moduleResolution: "nodenext"`.
- [ ] 3.3 **[RED — test first]** Escribir `apps/backend/src/env.test.ts`: test que verifica que `EnvSchema.parse({})` lanza con mensaje `DATABASE_URL`; test que verifica que `EnvSchema.parse({ DATABASE_URL: "not-a-url", ... })` lanza con `"DATABASE_URL must be a valid Postgres connection URL"`.
- [ ] 3.4 **[GREEN]** Crear `apps/backend/src/env.ts` con `EnvSchema` Zod 4 (todos los campos del spec) + `export const env`. Hacer pasar los tests de 3.3.
- [ ] 3.5 **[RED — test first]** Escribir test de integración `apps/backend/tests/health.test.ts`: importa `buildServer()`, llama `server.inject({ url: "/health" })`, espera 200 + `{ status: "ok" }`.
- [ ] 3.6 Crear `apps/backend/src/plugins/health.ts` como plugin Fastify con `GET /health → { status: "ok" }`.
- [ ] 3.7 **[GREEN]** Crear `apps/backend/src/index.ts` con bootstrap completo (Fastify + type provider + setErrorHandler + healthPlugin + listen). Exponer `buildServer()` para tests. Hacer pasar 3.5.
- [ ] 3.8 Crear `apps/backend/src/position-engine/.gitkeep` y `apps/backend/src/sync/.gitkeep` (sin imports de framework).

## Fase 4: Frontend scaffold (`apps/frontend`)

- [ ] 4.1 Crear `apps/frontend/package.json` con scripts `dev` (vite), `build` (tsc -b + vite build), `typecheck`. Deps: react, react-dom. DevDeps: vite, @vitejs/plugin-react, @tailwindcss/vite, typescript, clsx, tailwind-merge.
- [ ] 4.2 Crear `apps/frontend/tsconfig.json` (extiende base, `moduleResolution: "bundler"`, `jsx: "react-jsx"`) y `tsconfig.node.json`.
- [ ] 4.3 Crear `apps/frontend/vite.config.ts` con plugin React, `@tailwindcss/vite`, proxy `/api → http://localhost:3000`, `VITE_API_URL` via `define`.
- [ ] 4.4 Crear `apps/frontend/index.html`, `src/main.tsx`, `src/App.tsx` (stub funcional), `src/index.css` (`@import "tailwindcss"`).
- [ ] 4.5 Crear `apps/frontend/src/lib/cn.ts` con helper `cn()` usando `clsx` + `tailwind-merge`.

## Fase 5: Database scaffold (`db/`)

- [ ] 5.1 Agregar `node-pg-migrate` a devDependencies raíz.
- [ ] 5.2 Crear scripts `db:migrate` y `db:seed` en `apps/backend/package.json` que imprimen `"placeholder: US-002 will implement"` y salen 0.
- [ ] 5.3 Confirmar que `db/migrations/` existe con `.gitkeep` (creado en 1.7).

## Fase 6: Vitest workspace — tests mínimos pasantes

- [ ] 6.1 Crear `apps/backend/tests/smoke.test.ts` con test trivial `expect(true).toBe(true)` bajo project `engine` (garantiza exit 0 si no hay otros tests).
- [ ] 6.2 Crear `apps/backend/tests/sync-smoke.test.ts` con test trivial bajo project `sync`.
- [ ] 6.3 Crear `tests/e2e/smoke.test.ts` con test trivial bajo project `e2e`.

## Fase 7: Contrato de scripts raíz

- [ ] 7.1 Verificar que `package.json` raíz declare exactamente estos 9 scripts obligatorios: `dev`, `build`, `typecheck`, `lint`, `test:engine`, `test:sync`, `test:e2e`, `db:migrate`, `db:seed`.
- [ ] 7.2 Verificar scripts auxiliares presentes: `lint:fix`, `format`, `format:check`, `test`, `test:watch`.

## Fase 8: Tests NEGATIVE — acceptance criteria PRD

> Cada ítem es un test task explícito. Todos van en project `engine`.

- [ ] 8.1 **[RED → GREEN]** Test: proceso Node lanzado con `.env` sin `DATABASE_URL` termina con exit code `!= 0` y `stderr` contiene el literal `DATABASE_URL`. Implementar behavior en `src/index.ts` (catch de ZodError al startup → `process.exit(1)` con mensaje).
- [ ] 8.2 **[RED → GREEN]** Test: `EnvSchema.parse` con `DATABASE_URL: "not-a-url"` lanza `ZodError` cuyo mensaje contiene `"DATABASE_URL must be a valid Postgres connection URL"`. Verificar en `env.test.ts` (ya iniciado en 3.3 — completar el assertion exacto del mensaje).
- [ ] 8.3 **[Assertion estática]** Verificar (en test o en lint rule) que el string `BINANCE_API_SECRET` NO aparece en `.env.example`, `apps/backend/src/**`, ni `apps/frontend/src/**`. Test usa `fs.readFileSync` para buscar el literal prohibido.

## Fase 9: Smoke verification

- [ ] 9.1 Ejecutar `npm install` en raíz; verificar exit 0.
- [ ] 9.2 Ejecutar `npm run typecheck`; verificar exit 0 en ambas apps.
- [ ] 9.3 Ejecutar `npm run lint`; verificar exit 0 y cero warnings.
- [ ] 9.4 Ejecutar `npm run format:check`; verificar exit 0.
- [ ] 9.5 Ejecutar `npm run test:engine`, `test:sync`, `test:e2e`; verificar exit 0 en los tres.
- [ ] 9.6 Ejecutar `npm run db:migrate` y `db:seed`; verificar exit 0 y stdout contiene `US-002`.
- [ ] 9.7 Verificar que `docs/prototipo/CryptoLedger.html` existe y `prototipo/` raíz fue eliminado.
- [ ] 9.8 Verificar que `openspec/config.yaml`, `prd.json`, `CLAUDE.md`, `.atl/skill-registry.md` no tienen diff.

## Fase 10: Contratos Render (sin provisionar)

- [ ] 10.1 Crear `render.yaml` (o sección en `README.md`) documentando: backend `buildCommand`, `startCommand`; frontend `buildCommand`, `publishDir`. Dejar claro que la provisión real es manual post-merge — fuera del scope de US-001.
