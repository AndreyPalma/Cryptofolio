# Apply Progress — US-003-jwt-auth

> **Batch:** 1
> **Phases completed:** 1, 2, 3
> **Date:** 2026-04-27

---

## Tasks completed

### Phase 1 — Dependencies

- [x] **1.1** Installed `@fastify/cookie`, `@fastify/jwt`, `bcrypt`, `fastify-plugin` in `apps/backend`
- [x] **1.2** Installed `@types/bcrypt` in `apps/backend` devDependencies
- [ ] **1.3** `react-router-dom@^7` in `apps/frontend` — **pending (Phase 4–5)**
- [x] **1.4** Verified no peer dep conflicts. `bcrypt` native compiled successfully (no node-gyp error). Plan B (`bcryptjs`) was NOT needed.

### Phase 2 — AppPasswordService (TDD)

- [x] **2.1** 🔴 RED — `apps/backend/tests/auth/password.test.ts` written (6 tests, all failing)
- [x] **2.2** 🟢 GREEN — `apps/backend/src/services/password.ts` implemented
- [x] **2.3** 🟢 GREEN — `apps/backend/src/services/auth-bootstrap.ts` implemented
- [x] **2.4** 🔵 REFACTOR — `verifyPassword` confirmed: no early-exit, always runs `bcrypt.compare`, returns `false` on any exception. No changes needed.

### Phase 3 — authPlugin + index.ts integration (TDD)

- [x] **3.1** 🔴 RED — `apps/backend/tests/auth/login.test.ts` written (7 tests, all failing)
- [x] **3.2** 🔴 RED — `apps/backend/tests/auth/logout.test.ts` written (3 tests, all failing)
- [x] **3.3** 🔴 RED — `apps/backend/tests/auth/middleware.test.ts` written (7 tests, all failing)
- [x] **3.4** 🟢 GREEN — `apps/backend/src/routes/auth.ts` implemented
- [x] **3.5** 🟢 GREEN — `apps/backend/src/plugins/auth.ts` implemented with `fp()` wrapper
- [x] **3.6** 🟢 GREEN — `apps/backend/src/index.ts` updated with correct plugin registration order
- [x] **3.7** 🔵 REFACTOR — `getCookieOptions(isLogout)` helper extracted (no duplication); logout cookie has `httpOnly: true`; error handler covers FastifyJWT errors via statusCode property.

---

## TDD Cycle Evidence

| Task | RED (test written, failing) | GREEN (impl passing) | REFACTOR |
|------|-----------------------------|----------------------|----------|
| 2.1 password.ts + auth-bootstrap.ts | 6 tests fail — modules not found | `password.ts` + `auth-bootstrap.ts` created — 6 pass | verified no early-exit in verifyPassword |
| 3.1 login routes | 7 tests fail — plugins not found | `routes/auth.ts` + `plugins/auth.ts` — 7 pass (after SC-LOGIN-04 fix) | — |
| 3.2 logout routes | 3 tests fail — plugins not found | same impl — 3 pass | getCookieOptions extracted |
| 3.3 middleware | 7 tests fail — plugins not found | same impl — 7 pass | verified logout httpOnly |

**Total: 23 tests passing. 0 failures.**

---

## Issues encountered and resolved

### SC-LOGIN-04 — Fastify 5 returns 415, spec requires 400

Fastify 5 returns `415 Unsupported Media Type` when the body parser doesn't recognize the content-type. The spec requires `400`. Resolved by registering a catch-all `addContentTypeParser('*', ...)` inside `authRoutes` that rejects with a `400`-statusCode error before Fastify's default parser runs.

### `bootstrapAuth` singleton isolation in tests

Each test file calls `bootstrapAuth()` which stores a module-level singleton. With `vi.resetModules()` in `beforeEach`, each test gets a fresh module so the singleton resets properly. Tests use `process.env.APP_PASSWORD` directly (not the validated env schema) to avoid needing all other env vars.

### `buildServer()` required JWT_SECRET at import time

The original `health.test.ts` called `buildServer()` without env vars. After adding `@fastify/jwt` to `buildServer()`, it required `JWT_SECRET`. Resolved by adding `BuildServerOptions.enableAuth` parameter (default `true`). Health tests pass `{ enableAuth: false }`.

### `COOKIE_SECRET` added to env schema

`pool.test.ts` and `env.test.ts` didn't include `COOKIE_SECRET` in their VALID_ENV. Updated both to include `COOKIE_SECRET: "test-cookie-secret-16+"`.

### `vitest.workspace.ts` pattern update

The original workspace used `apps/backend/tests/*.{test,spec}.ts` (no `**`), which didn't pick up `tests/auth/` subdirectory. Updated to `apps/backend/tests/**/*.{test,spec}.ts`.

### `FastifyPluginAsync` require-await lint rule

`authRoutes` typed as `FastifyPluginAsync` requires `async` signature but has no top-level `await`. Added `// eslint-disable-next-line @typescript-eslint/require-await` comment.

---

## New files created

| File | Purpose |
|------|---------|
| `apps/backend/src/services/password.ts` | `hashPassword` + `verifyPassword` wrappers |
| `apps/backend/src/services/auth-bootstrap.ts` | Singleton bootstrap, `bootstrapAuth()` + `getPasswordHash()` |
| `apps/backend/src/plugins/auth.ts` | `authPlugin` with `fp()` wrapper, `onRequest` hook |
| `apps/backend/src/routes/auth.ts` | `/api/auth/login` + `/api/auth/logout` routes |
| `apps/backend/src/types/fastify.d.ts` | `FastifyInstance.authenticate` type declaration |
| `apps/backend/tests/auth/password.test.ts` | Unit tests SC-PASS-01..06 |
| `apps/backend/tests/auth/login.test.ts` | E2E tests SC-LOGIN-01..05 + NEGATIVE |
| `apps/backend/tests/auth/logout.test.ts` | E2E tests SC-LOGOUT-01..03 |
| `apps/backend/tests/auth/middleware.test.ts` | E2E tests SC-MW-01..07 |
| `apps/backend/tests/auth/helpers/test-server.ts` | Shared Fastify test server factory |

## Files modified

| File | Change |
|------|--------|
| `apps/backend/src/index.ts` | Added auth plugin registration, `BuildServerOptions`, `enableAuth` param |
| `apps/backend/src/env.ts` | Added `COOKIE_SECRET: z.string().min(16)` |
| `apps/backend/src/env.test.ts` | Added `COOKIE_SECRET` to `VALID_ENV` |
| `apps/backend/src/db/pool.test.ts` | Added `COOKIE_SECRET` to beforeAll env setup |
| `apps/backend/tests/health.test.ts` | Pass `{ enableAuth: false }` to `buildServer()` |
| `vitest.workspace.ts` | Changed `tests/*.test.ts` to `tests/**/*.test.ts` |

---

### Phase 4 — AuthContext + apiClient (frontend, TDD)

- [x] **4.1** Install `react-router-dom@^7`, `@testing-library/react`, `@testing-library/user-event` in `apps/frontend`
- [x] **4.2** 🔴 RED — `apps/frontend/tests/auth-context.test.tsx` written (5 tests: SC-CTX-01..05)
- [x] **4.3** 🔴 RED — `apps/frontend/tests/api-client.test.ts` written (6 tests: SC-API-01..05 + network error)
- [x] **4.4** 🟢 GREEN — `apps/frontend/src/lib/auth-context.tsx` implemented (AuthProvider, useAuth, AuthBridge)
- [x] **4.5** 🟢 GREEN — `apps/frontend/src/lib/api-client.ts` implemented (apiClient, registerAuthBridge, UnauthorizedError)
- [x] **4.6** 🔵 REFACTOR — removed useless try/catch in apiClient, simplified BASE_URL, void navigate() in AuthBridge

### Phase 5 — LoginPage + ProtectedRoute + App routing (TDD)

- [x] **5.1** 🔴 RED — `apps/frontend/tests/login-page.test.tsx` written (6 tests: SC-LOGIN-PAGE-01..05 + loading)
- [x] **5.2** 🔴 RED — `apps/frontend/tests/protected-route.test.tsx` written (3 tests: SC-PROT-01..03)
- [x] **5.3** 🟢 GREEN — `apps/frontend/src/pages/LoginPage.tsx` implemented
- [x] **5.4** 🟢 GREEN — `apps/frontend/src/routes/router.tsx` implemented (ProtectedRoute + createBrowserRouter)
- [x] **5.5** 🟢 GREEN — `apps/frontend/src/pages/DashboardPlaceholder.tsx` implemented
- [x] **5.6** 🟢 GREEN — `apps/frontend/src/App.tsx` wired (AuthProvider wraps RouterProvider)

### Phase 6 — Quality gates

- [x] **6.1** `npm run typecheck` ✅ — fixed `import.meta.env` types (`"vite/client"` added to tsconfig)
- [x] **6.2** `npm run lint` ✅ — fixed: optional-chain in apiClient, floating promises, no-misused-promises, deprecated FormEvent, empty-function in test override, unused imports, allowDefaultProject for `.tsx` tests
- [x] **6.3** All tests ✅ — 130 tests passing (15 test files: engine + frontend)
- [x] **6.4** `npm run build` — SKIPPED per CLAUDE.md rule ("Never build after changes")

---

## TDD Cycle Evidence — Batch 2

| Task | RED (test written, failing) | GREEN (impl passing) | REFACTOR |
|------|-----------------------------|----------------------|----------|
| 4.2 AuthContext | 5 tests fail — modules not found | AuthProvider + useAuth implemented — 5 pass | — |
| 4.3 apiClient | 6 tests fail — modules not found | api-client.ts implemented — 6 pass | removed useless try/catch, simplified BASE_URL |
| 5.1 LoginPage | 6 tests fail | LoginPage implemented — 6 pass | void wrapper on async onSubmit |
| 5.2 ProtectedRoute | 3 tests fail | ProtectedRoute in router.tsx — 3 pass | — |

**Total (all batches): 130 tests passing. 0 failures.**

---

## Issues resolved (Batch 2)

### `COOKIE_SECRET` removed from env schema
Added by Batch 1 agent but never used in code and missing from `.env.example`. Removed from `env.ts`, `env.test.ts`, `pool.test.ts`.

### `import.meta.env` TypeScript error
`apps/frontend/tsconfig.json` was missing `"types": ["vite/client"]`. Added to `compilerOptions`.

### allowDefaultProject disallows `**` glob
`apps/frontend/tests/*.tsx` files were outside any tsconfig. ESLint `allowDefaultProject` does not support `**` globs — used flat pattern `apps/frontend/tests/*.tsx` instead.

### Lint fixes in frontend files
- `api-client.ts`: removed unnecessary `typeof import.meta` check, useless try/catch, used `String()` for number in template
- `auth-context.tsx`: `void navigate()` to silence floating-promise rule
- `LoginPage.tsx`: `React.SyntheticEvent` (deprecated FormEvent), `void` on navigate, `(e) => { void handleSubmit(e); }` pattern for async onSubmit, braces on onChange shorthand

---

## New files created (all phases)

| File | Purpose |
|------|---------|
| `apps/frontend/src/lib/auth-context.tsx` | AuthProvider, useAuth, AuthBridge |
| `apps/frontend/src/lib/api-client.ts` | fetch wrapper, registerAuthBridge, UnauthorizedError |
| `apps/frontend/src/pages/LoginPage.tsx` | Login screen (password + Entrar) |
| `apps/frontend/src/pages/DashboardPlaceholder.tsx` | Placeholder for / route |
| `apps/frontend/src/routes/router.tsx` | createBrowserRouter, ProtectedRoute |
| `apps/frontend/src/App.tsx` | Root: AuthProvider wraps RouterProvider |
| `apps/frontend/tests/auth-context.test.tsx` | SC-CTX-01..05 |
| `apps/frontend/tests/api-client.test.ts` | SC-API-01..05 |
| `apps/frontend/tests/login-page.test.tsx` | SC-LOGIN-PAGE-01..06 |
| `apps/frontend/tests/protected-route.test.tsx` | SC-PROT-01..03 |

## Remaining phases

- [x] All phases complete
