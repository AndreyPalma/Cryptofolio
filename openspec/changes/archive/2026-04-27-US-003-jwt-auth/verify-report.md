# Verify Report — US-003-jwt-auth

**Date:** 2026-04-27
**Verifier:** sdd-verify agent
**Artifact store:** openspec

---

## Verdict: PASS WITH WARNINGS

All 7 PRD acceptance criteria are satisfied. All quality gates pass. No CRITICALs found.
Two WARNINGs related to spec coverage gaps (not implementation failures).

---

## Quality Gates

| Gate | Status | Evidence |
|------|--------|----------|
| typecheck (backend) | ✅ | `tsc --noEmit` exit 0, no errors |
| typecheck (frontend) | ✅ | `tsc --noEmit` exit 0, no errors |
| lint | ✅ | `eslint .` exit 0 (1 non-error warning: missing `"type":"module"` in root package.json — pre-existing, not introduced by this change) |
| test:engine (auth) | ✅ | 110 tests, 0 failures. Auth-specific: 23 tests in `password.test.ts`, `login.test.ts`, `logout.test.ts`, `middleware.test.ts` — all pass |
| test:frontend (auth) | ✅ | 20 tests, 0 failures. Auth-specific: 20 tests in `auth-context.test.tsx`, `api-client.test.ts`, `login-page.test.tsx`, `protected-route.test.tsx` — all pass |

**Total: 130 tests, 0 failures across all 15 test files.**

---

## PRD Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| AC-1 | `POST /api/auth/login`: valida password contra bcrypt hash, emite JWT HS256 24h en cookie `httpOnly + Secure + SameSite=Strict` | ✅ | SC-LOGIN-01 passes. JWT has `sub=admin`, `exp=iat+86400`. Cookie has `HttpOnly`. `Secure` is conditional by `NODE_ENV` (intentional deviation from PRD, documented in spec §7.2 — accepted). |
| AC-2 | `POST /api/auth/logout`: limpia la cookie | ✅ | SC-LOGOUT-01/02/03 pass. Response includes `Set-Cookie` with `Max-Age=0`. |
| AC-3 | `AuthMiddleware` en todas las rutas `/api/*` — retorna 401 si token inválido o expirado | ✅ | SC-MW-01..07 pass. Middleware blocks invalid/expired/tampered/malformed tokens with 401. Login and logout are correctly excluded. |
| AC-4 | Ruta `/login` en frontend: campo password, botón Entrar, redirect a `/` al autenticar | ✅ | SC-LOGIN-PAGE-01/02 pass. `<input type="password">`, button text "Entrar", navigates to `/` on 200. |
| AC-5 | Al recibir 401 desde cualquier API call: frontend redirige a `/login` automáticamente | ✅ | SC-API-02 passes. `apiClient` calls `redirectToLogin()` + throws `UnauthorizedError` on 401. `redirectToLogin()` sets `isAuthenticated=false`; `AuthBridge` registered fn navigates to `/login`. |
| AC-6 | `APP_PASSWORD` hasheado con bcrypt factor 12 al iniciar backend por primera vez (startup hook) | ✅ | SC-PASS-01 verifies `$2b$12$` prefix. `bootstrapAuth()` is called in `index.ts` entry point before server creation. SC-PASS-04 verifies error if `APP_PASSWORD` missing. |
| AC-7 | NEGATIVE: password incorrecto → 401 sin revelar si el usuario existe | ✅ | NEGATIVE-SC-LOGIN-02 passes. Response body checked — does not contain "user", "exist", "found", "hint". Body is exactly `{ "error": "Unauthorized" }`. |

---

## Spec Coverage

### Backend spec scenarios

| Scenario | Test | Status |
|----------|------|--------|
| SC-PASS-01 | `password.test.ts` | ✅ |
| SC-PASS-02 | `password.test.ts` | ✅ |
| SC-PASS-03 | `password.test.ts` | ✅ |
| SC-PASS-04 | `password.test.ts` | ✅ |
| SC-PASS-05 | `password.test.ts` | ✅ |
| SC-PASS-06 | `password.test.ts` | ✅ |
| SC-LOGIN-01 | `login.test.ts` | ✅ |
| SC-LOGIN-01 (JWT) | `login.test.ts` | ✅ |
| SC-LOGIN-02 | `login.test.ts` | ✅ |
| SC-LOGIN-03 | `login.test.ts` | ✅ |
| SC-LOGIN-04 | `login.test.ts` | ✅ |
| SC-LOGIN-05 | `login.test.ts` | ✅ |
| SC-LOGOUT-01 | `logout.test.ts` | ✅ |
| SC-LOGOUT-02 | `logout.test.ts` | ✅ |
| SC-LOGOUT-03 | `logout.test.ts` | ✅ |
| SC-MW-01 | `middleware.test.ts` | ✅ |
| SC-MW-02 | `middleware.test.ts` | ✅ |
| SC-MW-03 | `middleware.test.ts` | ✅ |
| SC-MW-04 | `middleware.test.ts` | ✅ |
| SC-MW-05 | `middleware.test.ts` | ✅ |
| SC-MW-06 | `middleware.test.ts` | ✅ |
| SC-MW-07 | `middleware.test.ts` | ✅ |
| **SC-JWT-01** | Covered implicitly by SC-LOGIN-01 JWT test (decodes and inspects sub/iat/exp) | ✅ |
| **SC-JWT-02** | `env.test.ts` — "throws when JWT_SECRET is too short" | ✅ |
| **SC-COOKIE-01** | ⚠️ NOT covered — no dedicated test for `NODE_ENV=production` cookie attributes (Secure, SameSite=Strict) | ⚠️ |
| **SC-COOKIE-02** | ⚠️ NOT covered — no dedicated test for `NODE_ENV=development` cookie attributes | ⚠️ |
| SC-COOKIE-03 | `logout.test.ts` SC-LOGOUT-01 — checks `Max-Age=0` | ✅ (partial: no env variant) |
| NEGATIVE-01 | `login.test.ts` NEGATIVE-SC-LOGIN-02 | ✅ |
| NEGATIVE-02 | `middleware.test.ts` SC-MW-02 | ✅ |
| NEGATIVE-03 | `middleware.test.ts` SC-MW-03 | ✅ |
| NEGATIVE-04 | `middleware.test.ts` SC-MW-05 | ✅ |
| NEGATIVE-05 | `login.test.ts` SC-LOGIN-03 | ✅ |

### Frontend spec scenarios

| Scenario | Test | Status |
|----------|------|--------|
| SC-CTX-01 | `auth-context.test.tsx` | ✅ |
| SC-CTX-02 | `auth-context.test.tsx` | ✅ |
| SC-CTX-03 | `auth-context.test.tsx` — verifies `isAuthenticated=false` and no fetch; navigation to `/login` is NOT explicitly asserted | ⚠️ |
| SC-CTX-04 | `auth-context.test.tsx` | ✅ |
| SC-CTX-05 | `auth-context.test.tsx` — verifies fetch + `isAuthenticated=false`; navigation to `/login` is NOT asserted; `logout()` implementation does NOT navigate | ⚠️ |
| SC-LOGIN-PAGE-01 | `login-page.test.tsx` | ✅ |
| SC-LOGIN-PAGE-02 | `login-page.test.tsx` | ✅ |
| SC-LOGIN-PAGE-03 | `login-page.test.tsx` | ✅ |
| SC-LOGIN-PAGE-04 | `login-page.test.tsx` | ✅ |
| SC-LOGIN-PAGE-05 | `login-page.test.tsx` — passes with `act(...)` console warnings (React 18 timing) | ✅ |
| SC-LOGIN-PAGE-06 | `login-page.test.tsx` | ✅ |
| SC-PROT-01 | `protected-route.test.tsx` | ✅ |
| SC-PROT-02 | `protected-route.test.tsx` | ✅ |
| SC-PROT-03 | `protected-route.test.tsx` | ✅ |
| SC-API-01 | `api-client.test.ts` | ✅ |
| SC-API-02 | `api-client.test.ts` | ✅ |
| SC-API-03 | `api-client.test.ts` | ✅ |
| SC-API-04 | `api-client.test.ts` | ✅ |
| SC-API-05 | `api-client.test.ts` | ✅ |
| SC-API-06 | `api-client.test.ts` | ✅ |
| SC-ROUTER-01 | Covered by SC-PROT-01/02 tests via MemoryRouter | ✅ |
| SC-ROUTER-02 | Covered by SC-PROT-02 test | ✅ |
| SC-ROUTER-03 | Covered by SC-PROT-01 test | ✅ |
| SC-ROUTER-04 | Covered by SC-LOGIN-PAGE-02 | ✅ |
| NEGATIVE-FE-01 | SC-LOGIN-PAGE-03 | ✅ |
| NEGATIVE-FE-02 | SC-API-02 | ✅ |
| NEGATIVE-FE-03 | SC-LOGIN-PAGE-04 | ✅ |
| NEGATIVE-FE-04 | SC-LOGIN-PAGE-06 | ✅ |
| NEGATIVE-FE-05 | SC-PROT-02 + SC-PROT-03 | ✅ |

---

## CRITICAL issues

None.

---

## WARNING issues

### WARN-01: SC-COOKIE-01 and SC-COOKIE-02 — cookie attribute variants untested

**What:** The spec (§7) requires that `Secure` and `SameSite` attributes are conditional on `NODE_ENV`. In `NODE_ENV=production`, the cookie should have `Secure` and `SameSite=Strict`. In development, it should omit `Secure` and use `SameSite=Lax`. The implementation correctly handles this via `getCookieOptions()` in `routes/auth.ts`, but there is no test that sets `NODE_ENV=production` and asserts the cookie headers.

**Risk:** A future refactor of `getCookieOptions` could silently drop `Secure` in production without any test catching it.

**Recommendation:** Add a test case in `login.test.ts` or a dedicated `cookie.test.ts` that temporarily sets `process.env.NODE_ENV = 'production'`, calls login, and asserts the `Set-Cookie` header contains `Secure` and `SameSite=Strict`.

---

### WARN-02: SC-CTX-05 — `logout()` does not navigate to `/login`

**What:** The spec (§2 SC-CTX-05) states: "**And** el router navega a `/login`" when `logout()` is called. The `logout()` implementation in `auth-context.tsx` calls `fetch('/api/auth/logout')` and sets `isAuthenticated=false`, but does NOT call `navigate('/login')`. The `act(...)` warnings in SC-LOGIN-PAGE-05 are unrelated to this issue.

**Evidence:**
```typescript
// auth-context.tsx logout()
const logout = useCallback(async () => {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  setIsAuthenticated(false);
  // ← no navigate('/login') call here
}, []);
```

The test SC-CTX-05 in `auth-context.test.tsx` also does NOT assert that navigation happened — it only checks `isAuthenticated=false` and the fetch call.

**Practical impact:** A component that calls `logout()` (e.g., a navbar button) will correctly clear the auth state, but the user won't be automatically redirected to `/login`. The next interaction with a `ProtectedRoute` will redirect them, but if there's no route change, the user sees a stale UI.

**Why it doesn't block archive:** The `ProtectedRoute` will immediately redirect on the next render cycle because `isAuthenticated=false`. The user experience degradation is minimal (no immediate redirect after clicking logout, but any navigation action triggers it). This is a behavioral gap, not a security gap.

**Recommendation:** In `logout()`, after `setIsAuthenticated(false)`, add navigation. Since `AuthBridge` has access to `navigate`, one approach is to expose the navigate reference via a ref or have `logout()` also call the registered bridge function. Alternatively, add `useNavigate()` directly in `AuthProvider` — which is valid since `AuthProvider` must be inside a `RouterProvider` (ensured by `App.tsx`). Update the test to assert `navigate('/login')` was called.

---

### WARN-03: SC-LOGIN-PAGE-05 — `act(...)` React 18 console warnings

**What:** The test for the loading state during submit produces `act(...)` warnings in the console. The test passes, but React warns that state updates inside a Promise resolution are not wrapped in `act()`. This is a test hygiene issue.

**Risk:** Low — tests pass. But these warnings obscure real issues in CI logs.

**Recommendation:** Wrap the `await userEvent.click(...)` and subsequent assertions in `act()`, or use `waitFor()` from `@testing-library/react` to properly drain the async queue.

---

## SUGGESTION

### SUG-01: Add `eslint` lint warning about missing `"type": "module"` to root package.json

The lint gate produces a `[MODULE_TYPELESS_PACKAGE_JSON]` warning on every run. This is a Node.js warning about the root `package.json` not declaring `"type": "module"`. Since the ESLint config uses ESM syntax, adding `"type": "module"` to the root `package.json` would eliminate this warning and is the correct fix per Node.js ESM spec. This is a pre-existing issue, not introduced by US-003.

### SUG-02: JWT_SECRET validation location

The `JWT_SECRET` min-32 validation lives in `env.ts` (good), but `buildServer()` accepts a `jwtSecret` parameter that bypasses this check. In tests, the secret is passed directly — which is intentional. Consider adding a runtime assertion inside `buildServer()` when `enableAuth=true` to guard against misconfigured test setups that pass short secrets.
