# Exploración — US-001: Scaffold del monorepo CryptoLedger

**Change**: `US-001-scaffold`
**Fase**: explore
**Fecha**: 2026-04-21
**Fuente de verdad**: `prd.json` → `stories[0]` (US-001)
**Dependencias**: ninguna (raíz del DAG)

---

## Context

Estado actual del repo:
- `prd.json` (v5, spec autoritativa)
- `prototipo/` (UI mockup en browser, React UMD + Babel standalone — NO es build)
- `CLAUDE.md` (guía del repo, invariantes de dominio)
- `openspec/` (recién bootstrapped — config + specs vacíos)
- `.atl/skill-registry.md` (cache de reglas compactas para sub-agentes)

**No hay** `package.json`, `tsconfig.json`, `node_modules`, ni estructura `apps/`. Es greenfield puro.

US-001 es el change raíz: todo el resto del PRD depende de que este scaffold quede operativo. Los criterios de aceptación piden literalmente:
- `/apps/backend` (Fastify + TS) y `/apps/frontend` (React + Vite + Tailwind)
- `npm run dev` corriendo ambos en paralelo con **`concurrently`** (la PRD nombra el paquete)
- Scripts `typecheck`, `lint`, `test:engine`, `test:sync`, `test:e2e`, `build` funcionando
- `.env.example` con variables específicas (y ojo: **`BINANCE_SECRET_KEY`**, no `BINANCE_API_SECRET` — error histórico corregido en v4)
- NEGATIVE: falta `DATABASE_URL` → backend falla con mensaje descriptivo al arrancar

---

## Affected Areas

Como es greenfield, todo es nuevo. Lo que se crea en esta exploración-proposal-apply:

- `package.json` (root, workspaces) — nuevo
- `apps/backend/` — nuevo (Fastify + TS)
- `apps/frontend/` — nuevo (Vite + React 19 + Tailwind 4)
- `tsconfig.base.json` — nuevo (shared strict config)
- `eslint.config.js` — nuevo (flat config raíz)
- `.env.example`, `.gitignore`, `.nvmrc`, `.prettierrc` — nuevos
- `vitest.config.ts` (o `vitest.workspace.ts`) — nuevo
- `prototipo/` — queda como referencia, **excluido** de lint/typecheck/build

---

## Questions + Options

### Q1 — Orquestación del monorepo

| Opción | Pros | Contras | Complejidad |
|--------|------|---------|-------------|
| **npm workspaces** | Native, cero dependencias, soportado oficialmente, basta para 2 apps | Sin cache de builds inteligente, hoisting menos estricto | Baja |
| pnpm workspaces | Menos disco, instalación rápida, hoisting estricto evita phantom deps | Requiere instalar pnpm, otra CLI a manejar | Baja |
| Turborepo | Cache de builds local y remoto, task pipelines | Overkill para 2 apps; una capa más | Media |
| Nx | Framework completo (codegen, graph, plugins) | Masivo para este scope, lock-in fuerte | Alta |

### Q2 — Dev server concurrente

| Opción | Pros | Contras |
|--------|------|---------|
| **`concurrently`** (nombrado en PRD) | Mature, prefijos con color, kill-on-fail, el PRD lo pidió explícitamente | 1 dep extra |
| `npm-run-all` con `run-p` | Alternativa clásica | Sin diferencial vs concurrently, menos output control |
| `pnpm --parallel` | Zero-dep si ya usás pnpm | Solo aplica si Q1 = pnpm |
| Node `--run` nativo | Sin deps | No corre comandos en paralelo, solo secuenciales |

### Q3 — TypeScript

Non-negotiable en `tsconfig.base.json`:
```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "noImplicitOverride": true,
  "noFallthroughCasesInSwitch": true,
  "verbatimModuleSyntax": true,
  "isolatedModules": true,
  "skipLibCheck": true,
  "target": "ES2023",
  "module": "ESNext",
  "moduleResolution": "bundler"
}
```

Backend extiende con `moduleResolution: "nodenext"`, `module: "nodenext"` (para ejecutar en Node). Frontend hereda `bundler` (Vite) y agrega `jsx: "react-jsx"`, `lib: ["ES2023", "DOM", "DOM.Iterable"]`.

Decisión sobre `exactOptionalPropertyTypes`: recomiendo **dejarlo apagado inicialmente**. Es muy estricto y genera fricción con libs externas (Fastify types, React props). Se puede encender más adelante por módulo si hace falta.

### Q4 — ESLint

| Opción | Pros | Contras |
|--------|------|---------|
| **Flat config (`eslint.config.js`)** | Standard en ESLint 9+, typed, composable | Algunos plugins aún no migraron completamente (la mayoría sí a 2026-04) |
| Legacy `.eslintrc.*` | Ecosistema más maduro históricamente | Deprecated, ESLint 9 solo la soporta con `ESLINT_USE_FLAT_CONFIG=false` |

Estructura: `eslint.config.js` raíz con reglas base (typescript-eslint strict, no-console warn, import/order), y overrides por glob — `apps/backend/**` agrega node-specific; `apps/frontend/**` agrega `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`.

### Q5 — Test runner

| Opción | Pros | Contras |
|--------|------|---------|
| **Vitest** | Mismo runner front/back, Vite-native, TS nativo, HMR tests, `test.projects` para separar suites, compatible Jest API | Ecosistema un poco menor que Jest |
| Jest | Ecosistema enorme, muy usado | Necesita ts-jest o babel-jest, lento arrancando, menos cómodo en ESM puro |

Para separar `test:engine` / `test:sync` / `test:e2e`, Vitest 2+ ofrece dos caminos limpios:
- **`vitest.workspace.ts` (recomendado)**: define projects con `name`, `include`, `environment`, `setupFiles`. Cada script de npm corre `vitest run --project <name>`.
  - `engine` → `apps/backend/src/**/position-engine/*.{test,spec}.ts` (unit, sin DB)
  - `sync` → `apps/backend/src/**/sync/*.{test,spec}.ts` (integra con mocks HTTP)
  - `e2e` → `tests/e2e/**/*.{test,spec}.ts` (full stack, DB real o test container)
- Glob paths en cada script: más simple pero menos declarativo.

### Q6 — Validación de env vars

| Opción | Pros | Contras |
|--------|------|---------|
| **Zod + `node --env-file=.env`** | Native loading (Node 20+), validación runtime, errores humanos | — |
| dotenv + checks manuales | Conocido | Verbose, fácil olvidar chequeos |
| `node --env-file` solo | Cero deps extra | No valida tipos ni presencia |
| env schema libs (envalid, t3-env) | Ergonómicas | Dep extra innecesaria teniendo zod |

**Pattern recomendado** (cumple el NEGATIVE del PRD):
```ts
import { z } from "zod";
const EnvSchema = z.object({
  DATABASE_URL: z.url({ error: "DATABASE_URL must be a valid Postgres connection URL" }),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),
  ENCRYPTION_KEY: z.string().length(64, "ENCRYPTION_KEY must be 64 hex chars (32 bytes)"),
  ETHERSCAN_API_KEY: z.string().min(1),
  BSCTRACE_API_KEY: z.string().min(1),
  BINANCE_API_KEY: z.string().min(1),
  BINANCE_SECRET_KEY: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  APP_PASSWORD: z.string().min(8),
  PORT: z.coerce.number().int().positive().default(3000),
});
export const env = EnvSchema.parse(process.env); // lanza con mensaje descriptivo si falta o es inválido
```
El `.parse()` falla con mensaje tipo `"DATABASE_URL must be a valid Postgres connection URL"` — cumple literal el acceptance.

### Q7 — `packages/shared`

| Opción | Pros | Contras |
|--------|------|---------|
| Crear `packages/shared` ahora | Evita drift de tipos front/back, punto único para enums de dominio | US-001 PRD solo pide `apps/` — YAGNI hasta US-005/US-007 |
| **Diferir** — estructura workspaces lo permite, se agrega cuando haga falta | Scaffold minimal, ajustado al PRD | Cuando aparezca la necesidad (tipos de `Transaction`, `WalletType`...), hay que mover código |
| Usar `type-only` import path aliases sin package | Sin overhead de build | Frágil, no escala |

### Q8 — `prototipo/`

| Opción | Pros | Contras |
|--------|------|---------|
| **Dejar en raíz, excluir de lint/typecheck/build** | Referencia visible, cero cambio | Visualmente podría confundirse con código productivo |
| Mover a `docs/prototipo/` | Semántica más clara: es documentación visual | Rompe paths de `CryptoLedger.html` (no pasa nada, no hay consumidores) |
| Mover a `reference/prototipo/` | Idem | Idem |

### Q9 — Scripts taxonomy (root `package.json`)

Mínimo para satisfacer US-001 + US-002:
```json
{
  "scripts": {
    "dev": "concurrently -n backend,frontend -c blue,magenta \"npm:dev:backend\" \"npm:dev:frontend\"",
    "dev:backend": "npm -w apps/backend run dev",
    "dev:frontend": "npm -w apps/frontend run dev",
    "build": "npm run build:backend && npm run build:frontend",
    "build:backend": "npm -w apps/backend run build",
    "build:frontend": "npm -w apps/frontend run build",
    "typecheck": "npm -w apps/backend run typecheck && npm -w apps/frontend run typecheck",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:engine": "vitest run --project engine",
    "test:sync": "vitest run --project sync",
    "test:e2e": "vitest run --project e2e",
    "db:migrate": "npm -w apps/backend run db:migrate",
    "db:seed": "npm -w apps/backend run db:seed"
  }
}
```
`db:migrate` y `db:seed` quedan como placeholders que el workspace backend implementa en US-002. Para US-001 basta con que existan (el PRD exige que los scripts estén definidos aunque los tests no).

### Q10 — Versión de Node

A fecha 2026-04-21:
- **Node 22 LTS** — Active LTS hasta abril 2027. Tiene `--env-file` nativo, `node --test`, `--run`, Web Streams estables, etc.
- Node 24 — current release, no LTS, innecesariamente nuevo
- Node 20 LTS — End of Active LTS en abril 2026 (justo ahora). No conviene empezar un proyecto acá.

**Recomendado: Node 22 LTS.**
- `.nvmrc` → `22`
- `package.json` → `"engines": { "node": ">=22.0.0" }`
- Fastify 5 requiere Node ≥20, Vite 6 requiere ≥20, Vitest 2+ requiere ≥18.

---

## Recommendations (default por pregunta)

| # | Pregunta | Default recomendado | Razón |
|---|----------|---------------------|-------|
| 1 | Monorepo orch. | **npm workspaces** | Cero dep, 2 apps, single-user. Turborepo se agrega si build times duelen. |
| 2 | Dev concurrente | **`concurrently`** | PRD lo nombra explícitamente. Prefijos con color útil al debuggear. |
| 3 | TypeScript | Base compartida con strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` | Alinea con skill `typescript`. `exactOptionalPropertyTypes` off por ahora. |
| 4 | ESLint | **Flat config** (`eslint.config.js`) raíz, overrides por glob | ESLint 9 standard; legacy está deprecated. |
| 5 | Test runner | **Vitest** con `vitest.workspace.ts` definiendo projects `engine` / `sync` / `e2e` | Un solo runner, suites separadas declarativamente, TS sin ceremonia. |
| 6 | Env validation | **`node --env-file` + Zod** `EnvSchema.parse(process.env)` al startup | Cumple NEGATIVE con mensajes específicos. Zod ya está en stack. |
| 7 | `packages/shared` | **Diferir** — crear cuando US-005/US-007 lo justifique | PRD pide solo `apps/`. No over-engineer. |
| 8 | `prototipo/` | **Dejar en raíz, excluir de tooling** via `.eslintignore`/tsconfig exclude/prettier ignore | No justifica el mv. Es solo una carpeta de referencia. |
| 9 | Scripts | Set completo según tabla arriba | Satisface US-001 + placeholders para US-002. |
| 10 | Node | **22 LTS** (.nvmrc=22, engines≥22) | Active LTS, features nativos que evitan deps. |

---

## Versiones target (a 2026-04-21)

Ancla las versiones major para reducir churn en la propuesta:

| Paquete | Versión | Notas |
|---------|---------|-------|
| Node | 22.x LTS | `--env-file`, built-in test runner disponibles |
| TypeScript | `^5.7` | strict features maduras |
| Fastify | `^5` | ESM-first, hooks refactor, Node ≥20 |
| Zod | `^4` | API v4 (ver compact rules: `z.email()`, `error` callback) |
| Vite | `^6` | Rolldown aún en flag, Rollup stable por default |
| React | `^19` | React Compiler opt-in, no `forwardRef`, `use()` API |
| Tailwind | `^4` | CSS-first, sin `@apply` chains, cascade layers |
| Vitest | `^2` | workspace projects estables |
| ESLint | `^9` | flat config only |
| typescript-eslint | `^8` | flat config support |
| concurrently | `^9` | — |
| Prettier | `^3` | — |

---

## Risks

1. **Drift Node 22 ↔ Supabase client**: el cliente `@supabase/supabase-js` v2 soporta Node 22 pleno (verificar en propuesta al fijar dep). Bajo riesgo.
2. **Vitest projects + ESM + Fastify types**: la configuración de `vitest.workspace.ts` con Fastify plugins requiere `setupFiles` que instancien el servidor — hay que probar en apply. Riesgo medio.
3. **React Compiler (opt-in)**: requiere `babel-plugin-react-compiler` en vite.config.ts. Si está roto/incompatible con React 19.x current, el skill `react-19` deja de aplicar literalmente. Riesgo bajo, pero hay que confirmar en apply.
4. **Tailwind 4 + Vite**: plugin `@tailwindcss/vite` (no `postcss`) es el camino oficial en v4. Verificar en apply que styles globales (variables custom del prototipo) se pueden portar sin fricción.
5. **ESLint flat config + react-hooks plugin**: `eslint-plugin-react-hooks` tuvo versión compatible con flat ~finales 2024. Confirmar en apply que exporta configs flat. Riesgo muy bajo.
6. **PRD exige `concurrently`** literalmente — si en apply descubrimos un problema de señales (SIGINT propagation en Windows), es tentador cambiar el tool. **NO**: si hay que cambiar, documentar el motivo y pedir aprobación al user. El PRD tiene jerarquía sobre conveniencia.

---

## Open Questions for User

Antes de pasar a proposal, tres cosas que valen una confirmación explícita:

1. **`packages/shared` diferido** — ¿OK esperar a US-005/US-007 para crear el workspace compartido? (Recomendado.)
2. **Ubicación de `prototipo/`** — ¿dejamos en raíz como referencia, o preferís moverlo a `docs/prototipo/` para que quede más claro que NO es productivo? (Recomendado: dejar en raíz.)
3. **Node 22 LTS** — ¿confirmás? Si tenés preferencia por 20 LTS (soporte en algún runtime específico) o 24 current, decilo ahora, impacta engines y .nvmrc.

Todo lo demás lo decido en la propuesta según los defaults recomendados, salvo que quieras revisar algún otro punto.

---

## Ready for Proposal

**Sí.** Los 10 ejes tienen default claro y tradeoffs explícitos. Las 3 open questions de arriba son confirmatorias — no bloquean pasar a `sdd-propose`, pero si el usuario quiere cambiar alguna, más vale hacerlo antes de que la propuesta las cristalice.

El orchestrator debería mostrar al usuario:
- Resumen de las 10 decisiones recomendadas (tabla corta).
- Las 3 open questions de arriba.
- Pedir confirmación (o ajuste) antes de lanzar `sdd-propose`.
