# Verification Report — US-001-scaffold

**Change**: US-001-scaffold  
**Version**: spec v1 (project-scaffold)  
**Mode**: Strict TDD  
**Date**: 2026-04-21  
**Verdict**: ⚠️ CONDITIONAL PASS

---

## Executive Summary

El scaffold está mayoritariamente correcto: 8 de 9 scripts requeridos pasaron en verde, todos los tests existentes pasan (21/21), la estructura de archivos es la correcta, los invariantes críticos del PRD (`BINANCE_SECRET_KEY`, Zod 4, posición-engine limpio) están respetados. Sin embargo se identificaron **3 CRITICAL** y **4 WARNING** que requieren remediación antes de archive:

1. **CRITICAL-1**: `apps/backend/src/env.test.ts` está dentro de `src/` → `tsconfig.build.json` la incluye → los artefactos de test (`env.test.js`, `env.test.d.ts`) se filtran al bundle de producción `dist/`.
2. **CRITICAL-2**: `npm run format:check` termina con exit code 2. Causa: `openspec/config.yaml` contiene YAML inválido para el parser de Prettier (`planned:` con valor no-quoted que contiene caracteres especiales). Adicionalmente, múltiples archivos fuente necesitan reformateo (warnings). La spec exige exit 0.
3. **CRITICAL-3**: `apply-progress.md` no contiene la tabla "TDD Cycle Evidence" obligatoria en Strict TDD Mode. El apply completó el trabajo con calidad pero omitió el artefacto de trazabilidad requerido por el protocolo.

---

## Script Matrix

| Script | Exit Code | Notes |
|--------|-----------|-------|
| `npm run typecheck` | **0** ✅ | Ambos workspaces: backend (tsconfig.build.json) y frontend |
| `npm run lint` | **0** ✅ | 0 errores ESLint. Node.js emite 1 warning de process (sin `"type":"module"` en root package.json — ver WARNING-2) |
| `npm run build` | **0** ✅ | Backend: tsc emite a `dist/`. Frontend: tsc + vite build. Advertencia: `env.test.js` queda en dist/ — ver CRITICAL-1 |
| `npm run test:engine` | **0** ✅ | 19 tests en 4 archivos: smoke (1), env.test (7), health (1), env-negative (10) |
| `npm run test:sync` | **0** ✅ | 1 test (sync-smoke) |
| `npm run test:e2e` | **0** ✅ | 1 test (e2e-smoke) |
| `npm run db:migrate` | **0** ✅ | Stdout: `placeholder: US-002 will implement` |
| `npm run db:seed` | **0** ✅ | Stdout: `placeholder: US-002 will implement` |
| `npm run format:check` | **2** ❌ | Error en `openspec/config.yaml` (YAML parse); múltiples warns en archivos fuente |
| `npm run dev` | ➖ skipped | Windows + concurrently SIGINT risk — documentado en apply-progress como manual |

---

## TDD Compliance (Strict TDD Mode)

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported en apply-progress | ❌ | Tabla "TDD Cycle Evidence" AUSENTE en apply-progress.md |
| All tasks have tests (los codificables) | ✅ | env.test.ts, env-negative.test.ts, health.test.ts existen |
| RED confirmado — test files existen | ✅ | 4 test files confirmados en codebase |
| GREEN confirmado — tests pasan en ejecución | ✅ | 21/21 pasan |
| Triangulación adecuada (EnvSchema) | ✅ | 7 casos en env.test.ts, 10 en env-negative.test.ts |
| Safety Net para archivos modificados | ➖ N/A | Greenfield — todos los archivos son nuevos |

**TDD Compliance**: 4/5 checks aplicables (1 falla por falta de tabla de evidencia en artifact)

---

## Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 17 | 2 (`env.test.ts`, `env-negative.test.ts` — parcialmente) | Vitest 2 |
| Integration | 1 | 1 (`health.test.ts`) | Vitest 2 + `server.inject()` |
| E2E real | 0 | 0 | No herramienta instalada (playwright, cypress) |
| Smoke/trivial | 3 | 3 (`smoke.test.ts`, `sync-smoke.test.ts`, `e2e/smoke.test.ts`) | Vitest 2 |
| **Total** | **21** | **6** | |

---

## Changed File Coverage

Coverage tool (`@vitest/coverage-v8`) no instalado → análisis de cobertura omitido.

---

## Assertion Quality

| File | Line | Assertion | Issue | Severity |
|------|------|-----------|-------|----------|
| `apps/backend/tests/smoke.test.ts` | 5 | `expect(true).toBe(true)` | Tautología — no ejercita código de producción | WARNING |
| `apps/backend/tests/sync-smoke.test.ts` | 5 | `expect(true).toBe(true)` | Tautología — no ejercita código de producción | WARNING |
| `tests/e2e/smoke.test.ts` | 5 | `expect(true).toBe(true)` | Tautología — no ejercita código de producción | WARNING |

**Nota contextual**: las tres tautologías fueron declaradas explícitamente en tasks.md (tasks 6.1, 6.2, 6.3) como mecanismo de bootstrap para garantizar exit 0 en proyects sin tests reales. El diseño los reconoce como "trivial pasante". Clasificados como WARNING (no CRITICAL) por este motivo — son intencionales por especificación, pero deben reemplazarse en el primer US que agregue tests reales a esos projects.

**Assertion quality**: 0 CRITICAL, 3 WARNING (todos intencionales por spec)

---

## Quality Metrics

**Linter**: ✅ 0 errores. 1 warning de Node.js runtime (no de ESLint) por `"type"` ausente en root `package.json`.  
**Type Checker**: ✅ 0 errores en ambos workspaces.  
**Formatter**: ❌ exit 2 — ver CRITICAL-2.

---

## Spec Compliance Matrix

### Requirement: Monorepo install

| Scenario | Test | Result |
|----------|------|--------|
| Fresh install en raíz | Estructura `package.json` + `workspaces` verificada statically. `npm install` produjo `node_modules/`. | ✅ COMPLIANT |

### Requirement: Dev server concurrente

| Scenario | Test | Result |
|----------|------|--------|
| Arranque paralelo | Script `dev` presente en root `package.json` con `concurrently -n backend,frontend -c blue,magenta`. No ejecutado (Windows SIGINT risk). | ⚠️ PARTIAL — script existe y es correcto estructuralmente; ejecución real no verificada |

### Requirement: Build de producción

| Scenario | Test | Result |
|----------|------|--------|
| Build exitoso | `npm run build` → exit 0, `apps/backend/dist/` existe, `apps/frontend/dist/` existe. | ✅ COMPLIANT (con caveats — ver CRITICAL-1: `env.test.js` en dist) |

### Requirement: Quality gates

| Scenario | Test | Result |
|----------|------|--------|
| Typecheck de ambos apps | `npm run typecheck` → exit 0, invoca tsc en ambos workspaces | ✅ COMPLIANT |
| Lint sin warnings | `npm run lint` → exit 0, 0 errores ESLint. (El warning de Node.js sobre `"type"` es del runtime, no de ESLint.) | ✅ COMPLIANT |
| Format check | `npm run format:check` → exit 2 | ❌ FAILING — ver CRITICAL-2 |

### Requirement: Test suite split (Vitest workspace)

| Scenario | Test | Result |
|----------|------|--------|
| Projects vacíos exit 0 | `test:engine` (19 passed), `test:sync` (1 passed), `test:e2e` (1 passed) — todos exit 0 | ✅ COMPLIANT |

### Requirement: DB placeholders

| Scenario | Test | Result |
|----------|------|--------|
| Placeholder sin crashear | `db:migrate` exit 0, stdout contiene `"placeholder: US-002 will implement"`. `db:seed` idem. | ✅ COMPLIANT |

### Requirement: Env loading (happy path)

| Scenario | Test | Result |
|----------|------|--------|
| .env válido arranca el server | `apps/backend/src/env.test.ts > EnvSchema > parses a fully valid env without throwing` — PASSED | ✅ COMPLIANT |

### Requirement: Env validation — missing DATABASE_URL (NEGATIVE)

| Scenario | Test | Result |
|----------|------|--------|
| DATABASE_URL ausente | `apps/backend/tests/env-negative.test.ts > env fail-fast (8.1) > process exits with code != 0...` — PASSED. Verifica exit != 0 y stderr contiene `DATABASE_URL`. | ✅ COMPLIANT |

### Requirement: Env validation — malformed DATABASE_URL (NEGATIVE)

| Scenario | Test | Result |
|----------|------|--------|
| DATABASE_URL no es URL | `apps/backend/src/env.test.ts > EnvSchema > throws with correct message when DATABASE_URL is malformed` — PASSED. Verifica error con `"DATABASE_URL must be a valid Postgres connection URL"`. | ✅ COMPLIANT |

### Requirement: Env naming invariant (BINANCE_SECRET_KEY)

| Scenario | Test | Result |
|----------|------|--------|
| Nombre canónico en .env.example | `apps/backend/tests/env-negative.test.ts > BINANCE_API_SECRET absent from scaffold (8.3)` — 8 archivos verificados, ninguno contiene el literal. `.env.example` usa `BINANCE_SECRET_KEY=`. | ✅ COMPLIANT |

### Requirement: Prototipo relocation

| Scenario | Test | Result |
|----------|------|--------|
| HTML carga tras el mv | `docs/prototipo/CryptoLedger.html` existe. `prototipo/` en raíz no existe. Todos los `.jsx` hermanos presentes en `docs/prototipo/`. | ✅ COMPLIANT |

### Requirement: Tooling exclusions

| Scenario | Test | Result |
|----------|------|--------|
| docs/ ignorado por las tres herramientas | ESLint: `ignores: ["docs/**",...]` en eslint.config.js. tsconfig.base.json: `exclude: [...,"docs"]`. .prettierignore: `docs/`. `npm run lint` y `npm run typecheck` exit 0 sin errores en docs/. | ✅ COMPLIANT |

### Requirement: Node 22 LTS pin

| Scenario | Test | Result |
|----------|------|--------|
| .nvmrc y engines coherentes | `.nvmrc` contiene `22`. `package.json` root: `"engines": { "node": ">=22.0.0" }`. | ✅ COMPLIANT |

### Requirement: Position-engine reservado

| Scenario | Test | Result |
|----------|------|--------|
| Directorio presente sin cross-cutting deps | `apps/backend/src/position-engine/` existe con `.gitkeep`. Grep sobre el directorio: 0 imports de fastify/@supabase/HTTP clients. | ✅ COMPLIANT |

### Requirement: SDD artifact safety

| Scenario | Test | Result |
|----------|------|--------|
| Archivos protegidos intactos | `prd.json`, `CLAUDE.md`, `openspec/config.yaml`, `.atl/skill-registry.md` no modificados por el scaffold. Verificado: timestamps y contenidos intactos. | ✅ COMPLIANT |

**Compliance summary**: 14/15 escenarios COMPLIANT, 1 FAILING (format:check), 1 PARTIAL (dev server — no ejecutado)

---

## PRD Acceptance Criteria Matrix (US-001)

| AC | Status | Evidence |
|----|--------|----------|
| Estructura `/apps/backend` (Fastify + TS) y `/apps/frontend` (React + Vite + Tailwind) | ✅ | Directorios presentes, packages correctos en package.json de cada app |
| `npm run dev` arranca backend en :3000 y frontend en :5173 concurrentemente | ⚠️ PARTIAL | Script correcto estructuralmente; no ejecutado en Windows por SIGINT risk |
| `npm run build` produce artefactos sin errores en ambos | ✅ con caveat | Exit 0; dist/ presente en ambos. Caveat: `env.test.js` en backend dist (CRITICAL-1) |
| `.env.example` con todas las variables (incluyendo `BINANCE_SECRET_KEY` no `BINANCE_API_SECRET`) | ✅ | Verificado: todas las 10 vars PRD + PORT presentes, `BINANCE_SECRET_KEY` correcto |
| `npm run typecheck` y `npm run lint` pasan sin errores | ✅ | Ambos exit 0 |
| `npm run test:engine`, `test:sync`, `test:e2e` definidos como scripts | ✅ | Presentes en root package.json, todos exit 0 con tests pasando |
| NEGATIVE: falta `DATABASE_URL` → backend falla al iniciar con mensaje descriptivo | ✅ | `env-negative.test.ts` task 8.1 — PASSED. Process exit != 0, stderr contiene `DATABASE_URL` |

---

## Invariant Check Results

| Invariant | Status | Evidence |
|-----------|--------|----------|
| `BINANCE_SECRET_KEY` (never `BINANCE_API_SECRET`) | ✅ PASS | Grep en apps/**/*.ts, .env.example: 0 ocurrencias en archivos de scaffold (solo en tests que buscan el literal prohibido — correcto) |
| 9 scripts npm obligatorios en root package.json | ✅ PASS | `dev`, `build`, `typecheck`, `lint`, `test:engine`, `test:sync`, `test:e2e`, `db:migrate`, `db:seed` — todos presentes |
| Zod 4 — sin patrones v3 prohibidos (`z.string().email()`, etc.) | ✅ PASS | Grep `z\.string()\.email\|z\.string()\.uuid\|z\.string()\.url\|z\.nonempty` → 0 matches |
| No `useMemo`/`useCallback`/`forwardRef` en frontend | ✅ PASS | Grep en `apps/frontend/src/` → 0 matches |
| Migration tool = `node-pg-migrate` (soporta partial unique indexes) | ✅ PASS | `node-pg-migrate@7.9.1` en root devDeps; `db/migrations/` existe con `.gitkeep` |
| `prototipo/` en `docs/prototipo/` (mv permitido) | ✅ PASS | `docs/prototipo/CryptoLedger.html` existe; `prototipo/` en raíz eliminado |
| `apps/backend/src/position-engine/` sin imports de framework | ✅ PASS | Solo `.gitkeep` — directorio puro |
| `apps/backend/dist/` no contiene test files | ❌ FAIL | `env.test.js`, `env.test.d.ts`, mapas — ver CRITICAL-1 |

---

## Issues Found

### CRITICAL (debe corregirse antes de archive)

**CRITICAL-1: Test files se filtran al build de producción**  
`apps/backend/src/env.test.ts` vive dentro de `src/`, pero `tsconfig.build.json` incluye `src/**/*.ts` sin excluir `*.test.ts`. Resultado: `apps/backend/dist/env.test.js` y `apps/backend/dist/env.test.d.ts` se emiten en el bundle de producción.

- Archivo afectado: `apps/backend/tsconfig.build.json`
- Fix requerido: agregar `"exclude": [..., "src/**/*.test.ts", "src/**/*.spec.ts"]` en `tsconfig.build.json`.
- Riesgo si no se corrige: dependencias de Vitest (`import { describe, it } from "vitest"`) podrían romper en runtime de producción al no estar disponibles.

**CRITICAL-2: `npm run format:check` falla con exit code 2**  
El spec (Requirement: Quality gates, Scenario: Format check) exige exit 0. Hay dos problemas:

1. `openspec/config.yaml` tiene un valor YAML inválido en la línea `planned: eslint (per US-001 acceptance: \`npm run lint\`)` — el backtick y los paréntesis hacen que el parser YAML de Prettier lance `SyntaxError: Nested mappings are not allowed in compact mappings`. `openspec/config.yaml` es un archivo de gobernanza SDD que NO debe ser tocado por el scaffold, pero tampoco está en `.prettierignore` — `prettier --check .` lo procesa y falla.
2. Múltiples archivos fuente necesitan reformateo (warns): `apps/backend/src/env.test.ts`, `apps/backend/tests/env-negative.test.ts`, `apps/frontend/vite.config.ts`, `eslint.config.js`, `vitest.workspace.ts`.

- Fix opción A (recomendada): agregar `openspec/` a `.prettierignore` (archivo de gobernanza SDD, no código fuente) + correr `prettier --write` sobre los archivos con warns.
- Fix opción B: corregir la sintaxis YAML de `openspec/config.yaml` (no recomendada — viola el invariant SDD artifact safety).

**CRITICAL-3: `apply-progress.md` no contiene tabla "TDD Cycle Evidence"**  
Strict TDD Mode requiere que el apply reporte evidencia de ciclos RED/GREEN/TRIANGULATE/SAFETY-NET/REFACTOR por tarea. El apply-progress.md actual solo tiene Phase Completion, Scripts, Versions y Deviations — sin trazabilidad TDD task-a-task.

- Impacto: no se puede verificar retroactivamente si TDD fue seguido correctamente para cada tarea. El código en sí tiene buena cobertura (tests de ENV, health, negativos) pero la evidencia no está documentada.
- Fix: en el siguiente ciclo apply o como addendum, agregar la tabla de evidencia al apply-progress.md (es un artefacto, no código — no rompe nada si se agrega ahora).

---

### WARNING

**WARNING-1: `npm run dev` no verificado en Windows**  
El script existe y está correctamente declarado. No se ejecutó debido al riesgo conocido de `concurrently` + SIGINT en Windows 11. El PRD AC2 requiere que "arranca backend en :3000 y frontend en :5173". Sin ejecución real, este AC queda PARTIAL.

- Recomendación: verificar manualmente una vez antes de archive, o agregar una nota explícita en render.yaml / docs.

**WARNING-2: Root `package.json` sin `"type": "module"`**  
Node.js emite `[MODULE_TYPELESS_PACKAGE_JSON]` warning en cada invocación de `npm run lint` porque `eslint.config.js` usa sintaxis ES module (`import`/`export`) pero el root `package.json` no declara `"type": "module"`. No bloquea, pero contamina stdout y podría romper herramientas que parseen la salida de ESLint.

- Fix: agregar `"type": "module"` al root `package.json`.
- Nota: requiere verificar que todos los scripts en package.json sean compatibles con ESM (probablemente sí, todos usan `node -e` o `npm -w`).

**WARNING-3: `backend typecheck` script usa `tsconfig.build.json` (no `tsconfig.json`)**  
El script `"typecheck": "tsc --noEmit --project tsconfig.build.json"` no verifica los archivos de test (`tests/**/*.ts`). La desviación fue documentada y es técnicamente correcta (el `rootDir` de build excluye tests), pero significa que los tests en `apps/backend/tests/` solo tienen type-check cuando se incluyen en `tsconfig.json` (que sí los incluye). Sin embargo, el script `typecheck` raíz nunca invoca ese tsconfig.

- Impact: bugs de tipos en `tests/*.ts` no se detectan con `npm run typecheck`.
- Fix opcional: cambiar el backend `typecheck` script a `tsc --noEmit --project tsconfig.json` para incluir los tests.

**WARNING-4: Tres smoke tests con tautologías (`expect(true).toBe(true)`)**  
Los tests en `smoke.test.ts`, `sync-smoke.test.ts` y `e2e/smoke.test.ts` son tautologías intencionales (tasks 6.1, 6.2, 6.3). No ejercitan código de producción. Cuando US-002+ agreguen código real al proyecto `sync` y el proyecto `e2e`, estos tests deben reemplazarse por comportamiento real o simplemente eliminarse.

- Severidad: WARNING (no CRITICAL) porque fueron explícitamente especificados en tasks.md como bootstrap.
- Acción futura: el primer US que use project `sync` o `e2e` debe eliminar los smoke tests triviales.

---

### SUGGESTION

**SUGGESTION-1: Instalar `@vitest/coverage-v8`**  
No está instalado. Aunque el threshold es 0 en US-001, instalarlo ahora previene que el siguiente US que active coverage tenga que configurarlo. Simple `devDependencies` addition.

**SUGGESTION-2: Configurar `.editorconfig` con `end_of_line = lf`**  
El `.editorconfig` fue creado (task 1.4) pero los archivos fuente muestran inconsistencias con Prettier (format:check warns). Esto puede deberse a que el editor del desarrollador usa CRLF en Windows. Verificar que el git config tenga `core.autocrlf = false` o `core.eol = lf`.

**SUGGESTION-3: `render.yaml` usa `staticPublishPath` — verificar key correcta**  
Render.com usa `publishPath` (sin "static") para static sites según la documentación oficial. `staticPublishPath: apps/frontend/dist` puede silenciar un error de configuración en el deploy real. Bajo riesgo pero vale la pena confirmar.

---

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Monorepo = npm workspaces | ✅ Yes | `workspaces: ["apps/*","packages/*"]` en root package.json |
| TypeScript baseline estricto | ✅ Yes | `strict: true`, `noUncheckedIndexedAccess`, todos los flags del design |
| Zod 4 + `node --env-file` | ✅ Yes | `EnvSchema` con `z.url({error:...})`, parseEnv() lazy, isMain guard en index.ts |
| Fastify 5 + type-provider-zod | ✅ Yes | `buildServer()` exportado, setValidatorCompiler, setSerializerCompiler, setErrorHandler |
| Vite 6 + React 19 + Tailwind 4 | ✅ Yes | plugin @tailwindcss/vite, `@import "tailwindcss"` en index.css, cn() helper |
| Migration runner = node-pg-migrate | ✅ Yes | `node-pg-migrate@7.9.1` instalado, `db/migrations/.gitkeep` presente |
| Test runner = Vitest 2 con workspace | ✅ Yes | `vitest.workspace.ts` con 3 projects |
| ESLint 9 flat + Prettier 3 | ✅ Yes | `eslint.config.js` flat, Prettier 3 config |
| Git hooks = simple-git-hooks | ✅ Yes | `simple-git-hooks` con `pre-commit: npx lint-staged` |
| Dual tsconfig backend (desviación) | ⚠️ Deviated (allowed) | `tsconfig.json` (noEmit) + `tsconfig.build.json` (emit). Documentado en apply-progress. Necesario por `rootDir`. |
| env.test.ts en src/ (desviación no documentada) | ⚠️ Deviated | Design dice test en `apps/backend/src/env.test.ts` — fue implementado así — pero crea CRITICAL-1. No fue identificado como riesgo. |

---

## Completeness

| Métrica | Valor |
|---------|-------|
| Fases completadas | 10/10 |
| Tasks totales en tasks.md | 45 |
| Tasks completadas | ~42 |
| Tasks no completadas | ~3 (9.4 format:check falla; parcialmente 10.1 render.yaml con posible key error) |

**Tasks incompletas / con issues:**
- **9.4** (`npm run format:check` exit 0) — FAILING
- **6.1, 6.2, 6.3** — completas pero con tautologías intencionales (WARNING-4)
- **9.2** — `npm run typecheck` exit 0: PASS, pero con caveat de que solo verifica `tsconfig.build.json` del backend

---

## Recommendation

**CONDITIONAL PASS** — ready para remediación parcial antes de archive.

Los fixes requeridos (CRITICAL) son de baja complejidad:
1. **CRITICAL-1**: Una línea en `tsconfig.build.json` + `npm run build` para confirmar.
2. **CRITICAL-2**: Agregar `openspec/` a `.prettierignore` + `npm run format` sobre los archivos warn.
3. **CRITICAL-3**: Agregar tabla TDD evidence en apply-progress.md (solo documentación, no código).

Una vez resueltos los 3 CRITICAL, el change está listo para `sdd-archive`.

---

## Re-verificación post-remediación CRITICAL (2026-04-21)

**Veredicto final**: ✅ PASS

---

### CRITICAL Resolution Matrix

| CRITICAL | Claim del apply | Evidencia verificada | Resuelto |
|----------|----------------|----------------------|----------|
| **CRITICAL-1** — test files en `dist/` | `tsconfig.build.json` ahora excluye `**/*.test.ts` y `**/*.spec.ts`; dist limpio. | `apps/backend/tsconfig.build.json` line 10: `"exclude": ["node_modules", "dist", "tests", "**/*.test.ts", "**/*.spec.ts"]`. `find apps/backend/dist -name "*.test.*"` → 0 resultados. `npm run build` → exit 0, dist contiene sólo `env.js`, `index.js`, `plugins/health.js` y sus `.d.ts` + `.map`. | ✅ YES |
| **CRITICAL-2** — `format:check` exit 2 | `.prettierignore` expandido; `npm run format:check` → exit 0. | `.prettierignore` contiene `**/dist/`, `coverage/`, `package-lock.json`, `openspec/config.yaml`, `openspec/changes/`. `npm run format:check` → `All matched files use Prettier code style!` → exit 0. | ✅ YES |
| **CRITICAL-3** — Tabla "TDD Cycle Evidence" ausente | `apply-progress.md` ahora incluye `## TDD Cycle Evidence` con tabla de 7 tareas (3.3, 3.4, 3.5, 3.7, 8.1, 8.2, 8.3). | `apply-progress.md` líneas 145-159: sección `## TDD Cycle Evidence` presente. Tabla con columnas `Task | Test file + key assertion | GREEN evidence | Status`. Las 7 tareas TDD cubiertas con rutas de archivo concretas. Status `⚠` en todas las filas — honesto: documenta que el RED phase no fue capturado como commit separado. Aceptable per las instrucciones de re-verify. | ✅ YES |

---

### Risk Handling Matrix

| Risk | Claim del apply | Evidencia verificada | Estado |
|------|----------------|----------------------|--------|
| **Risk A** — `npm run dev` en Windows | Documentado en `## Known Unverified` de `apply-progress.md`. | Sección `## Known Unverified` presente en `apply-progress.md` (líneas 163-169). Detalla: script existe, wired correctamente, riesgo de SIGINT + `concurrently` documentado como non-blocking, acción recomendada = QA manual. | ✅ Documentado (no blocking) |
| **Risk B** — `render.yaml` key `staticPublishPath` | Comentario inline en `render.yaml` documenta decisión + fallback. | `render.yaml` líneas 42-44: comentario presente → `# Render static service key: 'staticPublishPath' is correct for 'type: web' + 'runtime: static'. # Some Render docs show 'publishPath' — if deploy fails, try that key. Not blocking scaffold.` | ✅ Documentado (no blocking) |

---

### Script Matrix — post-remediación (ejecución real)

| Script | Exit Code | Notas |
|--------|-----------|-------|
| `npm run typecheck` | **0** ✅ | Backend (`tsconfig.build.json`) + frontend — sin errores |
| `npm run lint` | **0** ✅ | 0 errores ESLint. Warning de Node.js runtime sobre `"type"` en root `package.json` (WARNING-2 conocido, no bloqueante) |
| `npm run build` | **0** ✅ | `apps/backend/dist/` limpio: 0 archivos `.test.*`. Frontend build 451ms. |
| `npm run test:engine` | **0** ✅ | 19/19 tests pasados (4 files: smoke, env.test, health, env-negative) |
| `npm run test:sync` | **0** ✅ | 1/1 test pasado |
| `npm run test:e2e` | **0** ✅ | 1/1 test pasado |
| `npm run format:check` | **0** ✅ | `All matched files use Prettier code style!` — resuelto desde exit 2 |
| `npm run db:migrate` | **0** ✅ | `placeholder: US-002 will implement` |
| `npm run db:seed` | **0** ✅ | `placeholder: US-002 will implement` |

**Total scripts verdes: 9/9** (antes: 8/9)

---

### Invariant Re-check

| Invariant | Estado | Evidencia |
|-----------|--------|-----------|
| `BINANCE_API_SECRET` solo en docs/tests (nunca en código/config) | ✅ PASS | Grep en todo el proyecto: ocurrencias sólo en `prd.json`, `CLAUDE.md`, `openspec/`, y en `env-negative.test.ts` donde se busca el literal prohibido — comportamiento correcto y esperado |
| 9 scripts npm requeridos en root `package.json` | ✅ PASS | `dev`, `build`, `typecheck`, `lint`, `test:engine`, `test:sync`, `test:e2e`, `db:migrate`, `db:seed` — todos presentes |
| Zod 4 — sin patrones v3 (`z.string().email()`, `.uuid()`, `.url()`, `.nonempty()`) | ✅ PASS | Grep en `apps/**/*.{ts,tsx}` → 0 matches |
| No `useMemo`/`useCallback`/`forwardRef` en frontend src | ✅ PASS | Grep en `apps/frontend/src/` → 0 matches |

---

### Veredicto Final

**✅ PASS** — todos los CRITICAL resueltos, 9/9 scripts en verde, invariantes PRD respetados.

**WARNING residuales** (no bloquean archive — conocidos del ciclo anterior):
- WARNING-2: Root `package.json` sin `"type": "module"` (Node.js runtime warning en lint)
- WARNING-3: `backend typecheck` usa `tsconfig.build.json` (tests no type-checkeados por `npm run typecheck`)
- WARNING-4: Tres smoke tests con tautologías intencionales (por spec, reemplazar en US-002+)

**Recomendación**: listo para `sdd-archive`. Los WARNINGs son conocidos y aceptados — ninguno representa deuda técnica bloqueante para US-001.
