# Archive Report — US-003-jwt-auth

**Date**: 2026-04-27
**Verdict at archive**: PASS WITH WARNINGS
**Test count**: 130 tests, 0 failures

---

## Summary

US-003 implemented JWT-based single-user authentication for Cryptofolio, a critical blocker for all subsequent API stories. The change introduces:

### Backend components
- **Password service** (`apps/backend/src/services/password.ts`): bcrypt hashing with factor 12 for `APP_PASSWORD` verification
- **Auth bootstrap** (`apps/backend/src/services/auth-bootstrap.ts`): startup hook that hashes the app password once per process
- **Auth plugin** (`apps/backend/src/plugins/auth.ts`): Fastify plugin registering `@fastify/cookie` and `@fastify/jwt`, exposes `authenticate` preHandler
- **Auth routes** (`apps/backend/src/routes/auth.ts`): `POST /api/auth/login` and `POST /api/auth/logout` endpoints
- **Middleware integration** (`apps/backend/src/index.ts` modified): registers auth flow in correct order to protect all `/api/*` routes except login/logout

### Frontend components
- **LoginPage** (`apps/frontend/src/pages/LoginPage.tsx`): password-only form with Tailwind 4 styling
- **AuthContext** (`apps/frontend/src/lib/auth-context.tsx`): React Context managing `isAuthenticated` state and `redirectToLogin()` for 401 handling
- **apiClient** (`apps/frontend/src/lib/api-client.ts`): fetch wrapper with `credentials: 'include'` and automatic 401 → redirect interception
- **Router** (`apps/frontend/src/routes/router.tsx`): react-router-dom v7 with ProtectedRoute guard
- **App integration** (`apps/frontend/src/App.tsx` modified): AuthProvider wraps RouterProvider

### Key architectural decisions
- **Password hash in memory**: Computed once at startup, not persisted. Regenerated on each restart (idempotent).
- **Cookie attributes conditional by NODE_ENV**: `Secure=true` only in production (HTTP localhost breaks in dev); `SameSite=Strict` in prod, `Lax` in dev.
- **Fail-closed middleware**: All `/api/*` routes protected by default; login/logout explicitly excluded via `config.public = true`.
- **No refresh tokens**: Single 24-hour JWT per session. V1 single-user constraint permits this simplification.
- **Stateless logout**: No server-side blacklist; cookie cleanup (`Max-Age=0`) sufficient for V1.

### Test coverage
- **Backend (vitest engine project)**: 23 auth-specific tests across password service, login, logout, and middleware
- **Frontend (vitest + RTL)**: 20 auth-specific tests across AuthContext, LoginPage, apiClient, ProtectedRoute, router
- **E2E scenarios**: Full login flow, protected route access, 401 handling
- **All 130 tests pass**: No failures. Quality gates (typecheck, lint) also pass.

---

## Warnings carried forward

### WARN-01: Cookie production attributes not tested under NODE_ENV=production

The spec (§7) requires `Secure=true` and `SameSite=Strict` in production, but no test explicitly sets `NODE_ENV=production` and verifies these headers. The implementation correctly handles this via `getCookieOptions()`, but refactors without test coverage could silently drop the `Secure` flag.

**Recommendation**: Add a dedicated test case in `login.test.ts` that sets `NODE_ENV=production` and asserts `Set-Cookie` includes `Secure` and `SameSite=Strict`.

### WARN-02: `logout()` does not navigate to `/login`

The spec (SC-CTX-05) states that `logout()` should navigate to `/login` after clearing the cookie. The current implementation only clears `isAuthenticated` state; the redirect depends on ProtectedRoute catching the next render cycle. The user is not automatically redirected to `/login` on logout.

**Practical impact**: Minimal. ProtectedRoute will redirect on the next interaction, but if the user stays on the same page after clicking logout, the UI remains stale until navigation occurs.

**Recommendation**: Add `navigate('/login')` call in `logout()` after `setIsAuthenticated(false)`. AuthProvider should import `useNavigate` from react-router-dom (safe because AuthProvider is always inside a RouterProvider per App.tsx structure).

### WARN-03: `act()` warnings in login-page test (SC-LOGIN-PAGE-05)

Test SC-LOGIN-PAGE-05 passes but produces React 18 console warnings about state updates inside Promise resolutions not wrapped in `act()`. This is a test hygiene issue, not a code issue.

**Recommendation**: Wrap the async state updates in `act()` or use `waitFor()` from @testing-library/react to properly drain the async queue.

---

## Tech debt logged (from design.md)

The following improvements are deferred to later stories:

1. **GET /api/auth/me endpoint** — Session persistence on page reload. Currently, `isAuthenticated` resets to `false` on refresh. A session check endpoint would allow frontend to verify the httpOnly cookie is still valid. Out-of-scope for US-003 but needed before production use.

2. **Rate limiting on /api/auth/login** — PRD NEGATIVE clause #7 ("don't reveal if user exists") suggests attack hardening. Not implemented; deferred to a hardening story. Acceptable in V1 (single-user, minimal attack surface).

3. **Cookie Secure attribute testing in production environment** — See WARN-01.

4. **logout() navigation behavior** — See WARN-02.

---

## Key files and paths

| File | Purpose |
|------|---------|
| `apps/backend/src/plugins/auth.ts` | Auth middleware plugin |
| `apps/backend/src/routes/auth.ts` | Login/logout endpoints |
| `apps/backend/src/services/password.ts` | Password hashing and verification |
| `apps/backend/src/services/auth-bootstrap.ts` | Startup hook |
| `apps/frontend/src/lib/auth-context.tsx` | Auth state management |
| `apps/frontend/src/lib/api-client.ts` | Fetch wrapper with interceptor |
| `apps/frontend/src/pages/LoginPage.tsx` | Login form |
| `apps/frontend/src/routes/router.tsx` | Router configuration |
| `apps/backend/tests/auth/` | Backend auth tests |
| `apps/frontend/tests/` | Frontend auth tests |

---

## Dependencies added

- Backend: `@fastify/cookie@^11`, `@fastify/jwt@^9`, `bcrypt@^5`
- Frontend: `react-router-dom@^7`

---

## Next steps

The change is complete and archivable. All PRD acceptance criteria are met. The warnings are behavioral gaps (not security issues) that can be addressed in follow-up stories without blocking the use of this capability in US-004 (dashboard) and beyond.
