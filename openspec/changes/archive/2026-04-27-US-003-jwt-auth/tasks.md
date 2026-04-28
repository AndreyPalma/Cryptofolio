# Tasks — US-003: JWT Auth (backend + pantalla de login)

> **Change:** `US-003-jwt-auth`
> **Estado:** listo para implementar
> **Modo:** Strict TDD — cada tarea de código va precedida por su tarea de tests en ROJO
> **Artifact store:** openspec
> **Última revisión:** 2026-04-27

---

## Resumen de fases

| Fase | Descripción | Tareas |
|------|-------------|--------|
| 1 | Dependencias | 4 |
| 2 | AppPasswordService (TDD) | 5 |
| 3 | authPlugin — backend (TDD) | 7 |
| 4 | AuthContext + apiClient — frontend (TDD) | 7 |
| 5 | LoginPage + ProtectedRoute — frontend (TDD) | 7 |
| 6 | Quality gates | 4 |
| **Total** | | **34** |

---

## Fase 1 — Dependencias

> Instalar paquetes necesarios antes de escribir cualquier código. No hay tests para esta fase, pero sí verificación de conflictos.

- [ ] **1.1** Instalar dependencias de producción en `apps/backend`: `@fastify/cookie@^11`, `@fastify/jwt@^9`, `bcrypt@^5`, `fastify-plugin`
  ```
  npm install @fastify/cookie @fastify/jwt bcrypt fastify-plugin -w apps/backend
  ```

- [ ] **1.2** Instalar tipos de desarrollo en `apps/backend`: `@types/bcrypt`
  ```
  npm install -D @types/bcrypt -w apps/backend
  ```

- [ ] **1.3** Instalar `react-router-dom@^7` en `apps/frontend`
  ```
  npm install react-router-dom@^7 -w apps/frontend
  ```

- [ ] **1.4** Verificar que no hay conflictos de pares (`npm ls` sin errores de peer deps en ambos workspaces). Si `bcrypt` falla la compilación nativa (`node-gyp`), reemplazar por `bcryptjs` + `@types/bcryptjs` y documentar el swap en el ADR-003 del design.

---

## Fase 2 — AppPasswordService (TDD)

> Cubre: `apps/backend/src/services/password.ts` y `apps/backend/src/services/auth-bootstrap.ts`
> Spec de referencia: `specs/auth-backend/spec.md` §2

### 2.1 — RED: tests unitarios de AppPasswordService

- [ ] **2.1** `🔴 RED` — Crear `apps/backend/tests/auth/password.test.ts` con los siguientes casos (todos deben FALLAR porque los módulos no existen aún):

  - `SC-PASS-01` — `hashPassword("SecurePassword123!")` retorna string que empieza con `"$2b$12$"`
  - `SC-PASS-02` — `verifyPassword(plain, hash)` retorna `true` cuando el plain coincide con el hash
  - `SC-PASS-03` — `verifyPassword("WrongPassword", hash)` retorna `false`
  - `SC-PASS-04` — `bootstrapAuth()` sin `APP_PASSWORD` en env lanza `Error("APP_PASSWORD env var is required")`
  - `SC-PASS-05` — `getPasswordHash()` antes de `bootstrapAuth()` lanza `Error("Auth not bootstrapped")`
  - `SC-PASS-06` — `bootstrapAuth()` llamado dos veces NO llama a `bcrypt.hash` por segunda vez (idempotente); el hash devuelto es el mismo

  > Usar `vi.spyOn` sobre `bcrypt` para verificar SC-PASS-06 sin depender del timing real.
  > Restaurar `process.env.APP_PASSWORD` en `beforeEach`/`afterEach` para aislar los tests.

### 2.2 — GREEN: implementar password.ts y auth-bootstrap.ts

- [ ] **2.2** `🟢 GREEN` — Crear `apps/backend/src/services/password.ts`:
  - Exportar `hashPassword(plain: string): Promise<string>` — usa `bcrypt.hash(plain, 12)`
  - Exportar `verifyPassword(plain: string, hash: string): Promise<boolean>` — usa `bcrypt.compare`; captura cualquier excepción y retorna `false` en lugar de relanzarla

- [ ] **2.3** `🟢 GREEN` — Crear `apps/backend/src/services/auth-bootstrap.ts`:
  - Variable módulo-scoped `let _passwordHash: string | null = null`
  - `bootstrapAuth(): Promise<void>` — idempotente; lee `process.env.APP_PASSWORD`; lanza si está ausente/vacío; hashea y guarda en `_passwordHash`
  - `getPasswordHash(): string` — lanza `Error("Auth not bootstrapped")` si `_passwordHash` es `null`

  > Correr los tests de 2.1 — todos deben pasar en VERDE.

### 2.3 — REFACTOR

- [ ] **2.4** `🔵 REFACTOR` — Revisar que `verifyPassword` no tiene early-exit ante password incorrecto (el `bcrypt.compare` completo siempre se ejecuta). Confirmar que el tipo de retorno es `Promise<boolean>` sin posibilidad de `throw`. Ajustar si hace falta. Re-correr tests.

---

## Fase 3 — authPlugin (TDD)

> Cubre: `apps/backend/src/plugins/auth.ts`, `apps/backend/src/routes/auth.ts`, y la integración en `apps/backend/src/index.ts`
> Spec de referencia: `specs/auth-backend/spec.md` §3, §4, §5, §7, §8

### 3.1 — RED: tests de login

- [ ] **3.1** `🔴 RED` — Crear `apps/backend/tests/auth/login.test.ts` usando `fastify.inject()` (sin servidor HTTP real). Todos deben FALLAR:

  - `SC-LOGIN-01` — `POST /api/auth/login` con password correcto → `200 { ok: true }` + header `Set-Cookie` con JWT
  - `SC-LOGIN-01` (JWT) — el token decodificado tiene `sub === "admin"` y `exp` en ~24h
  - `SC-LOGIN-02` — password incorrecto → `401 { error: "Unauthorized" }`, sin `Set-Cookie`
  - `NEGATIVE: SC-LOGIN-02` — el body de respuesta NO contiene campos `"user"`, `"hint"` ni mensaje informativo (cubre NEGATIVE-01 de spec backend §8)
  - `SC-LOGIN-03` — body `{}` (sin campo `password`) → `400`
  - `SC-LOGIN-04` — `Content-Type: application/x-www-form-urlencoded` → `400`
  - `SC-LOGIN-05` — request SIN cookie previa + password correcto → `200` (no `401` por el middleware — verifica que login es ruta pública)

  > Cada test monta un servidor de test con `buildServer()` en un `beforeAll`, llama `bootstrapAuth()` con `APP_PASSWORD` de test, y usa `inject()`.

### 3.2 — RED: tests de logout

- [ ] **3.2** `🔴 RED` — Crear `apps/backend/tests/auth/logout.test.ts`:

  - `SC-LOGOUT-01` — cliente con cookie válida → `POST /api/auth/logout` → `200 { ok: true }` + `Set-Cookie` con `Max-Age=0`
  - `SC-LOGOUT-02` — cliente SIN cookie → `POST /api/auth/logout` → `200 { ok: true }` (idempotente, no 401)
  - `SC-LOGOUT-03` — logout no está bloqueado por el middleware de auth (mismo que SC-LOGOUT-02)

### 3.3 — RED: tests del middleware

- [ ] **3.3** `🔴 RED` — Crear `apps/backend/tests/auth/middleware.test.ts`. El archivo registra una ruta de test `GET /api/test` en el servidor para verificar el middleware. Todos deben FALLAR:

  - `SC-MW-01` — `GET /api/test` con cookie válida → `200` (el handler procesa)
  - `SC-MW-02` — `GET /api/test` sin cookie → `401 { error: "Unauthorized" }` (cubre NEGATIVE-02)
  - `SC-MW-03` — `GET /api/test` con token expirado → `401` (cubre NEGATIVE-03)
  - `SC-MW-04` — `GET /api/test` con token firmado con secret distinto (tampered) → `401`
  - `SC-MW-05` — `GET /api/test` con cookie `token = "not.a.jwt"` → `401` y NO `500` (cubre NEGATIVE-04)
  - `SC-MW-06` — `POST /api/auth/login` sin cookie → el middleware NO devuelve 401 (la request llega al handler)
  - `SC-MW-07` — `POST /api/auth/logout` sin cookie → el middleware NO devuelve 401

  > Para SC-MW-03: generar un JWT con `exp` en el pasado usando `fastify.jwt.sign` con `expiresIn: '-1s'` o similar.
  > Para SC-MW-04: firmar con un secret diferente.

### 3.4 — GREEN: implementar routes/auth.ts

- [ ] **3.4** `🟢 GREEN` — Crear `apps/backend/src/routes/auth.ts`:
  - Plugin Fastify que exporta `authRoutes`
  - `POST /api/auth/login`:
    - Schema Zod: `z.object({ password: z.string().min(1) })`
    - Llama `getPasswordHash()` y `verifyPassword(body.password, hash)`
    - Éxito: `fastify.jwt.sign({ sub: 'admin' }, { expiresIn: '24h' })`, emit cookie con atributos del §7 (Secure condicional por `NODE_ENV`)
    - Fallo: `reply.code(401).send({ error: "Unauthorized" })`
  - `POST /api/auth/logout`:
    - Limpia cookie con `Max-Age: 0`
    - Responde `200 { ok: true }` siempre

### 3.5 — GREEN: implementar plugins/auth.ts

- [ ] **3.5** `🟢 GREEN` — Crear `apps/backend/src/plugins/auth.ts`:
  - Importar `fp` de `fastify-plugin` — OBLIGATORIO para que el decorador sea visible en plugins hermanos
  - `fastify.decorate('authenticate', ...)` — preHandler que llama `request.jwtVerify({ onlyCookie: true })` y devuelve `401` si falla
  - Registrar `authRoutes` con prefix `/api/auth` **ANTES** de agregar el hook `onRequest`
  - Hook `onRequest`: skipea si el path NO empieza con `/api/` o SI empieza con `/api/auth/`; llama `fastify.authenticate` para todo lo demás
  - Exportar como `export default fp(authPlugin, { name: 'authPlugin' })`

### 3.6 — GREEN: integrar en index.ts

- [ ] **3.6** `🟢 GREEN` — Modificar `apps/backend/src/index.ts` para registrar los plugins en el orden EXACTO (no alterar):

  ```
  1. bootstrapAuth()               ← antes de crear la instancia Fastify
  2. fastify.register(@fastify/cookie, { secret: env.COOKIE_SECRET })
  3. fastify.register(@fastify/jwt, { secret: env.JWT_SECRET, cookie: { cookieName: 'token', signed: false } })
  4. fastify.register(authPlugin)
  5. fastify.register(healthPlugin)  ← ya existente, se mantiene
  ```

  > Verificar que `env.ts` ya tiene `JWT_SECRET` (min 32 chars) y `APP_PASSWORD`. Si falta `COOKIE_SECRET`, agregarlo al schema Zod de env con `z.string().min(16)`.

  > Correr TODOS los tests de las fases 2 y 3 — todos deben pasar.

### 3.7 — REFACTOR

- [ ] **3.7** `🔵 REFACTOR` — Revisar:
  - Que el error handler en `index.ts` no expone stack traces en prod (ya existente, confirmar que cubre `FastifyJWT` errors)
  - Que la cookie de logout también es `httpOnly` y no puede ser leída por JS (atributos consistentes con login)
  - Extraer los atributos de cookie a una función helper `getCookieOptions(isLogout: boolean)` si hay duplicación entre login y logout handlers
  - Re-correr todos los tests de fases 2 y 3

---

## Fase 4 — AuthContext + apiClient — frontend (TDD)

> Cubre: `apps/frontend/src/lib/auth-context.tsx` y `apps/frontend/src/lib/api-client.ts`
> Spec de referencia: `specs/auth-frontend/spec.md` §2 y §5

### 4.1 — RED: tests de AuthContext

- [ ] **4.1** `🔴 RED` — Crear `apps/frontend/tests/auth-context.test.tsx` con `renderHook` de `@testing-library/react`. Todos deben FALLAR:

  - `SC-CTX-01` — al montar `<AuthProvider>`, `isAuthenticated` es `false`
  - `SC-CTX-02` — llamar `login()` setea `isAuthenticated = true`
  - `SC-CTX-03` — llamar `redirectToLogin()` setea `isAuthenticated = false` y navega a `/login`; NO realiza fetch (verificar con `vi.spyOn(global, 'fetch')`)
  - `SC-CTX-04` — `useAuth()` fuera de `<AuthProvider>` lanza `Error("useAuth must be used within an AuthProvider")`
  - `SC-CTX-05` — llamar `logout()` hace `POST /api/auth/logout` con `credentials: 'include'`, setea `isAuthenticated = false`, y navega a `/login`

  > Usar `MemoryRouter` o el router de test de react-router-dom para que `useNavigate` esté disponible dentro de `AuthProvider`.
  > Mockear `fetch` con `vi.spyOn(global, 'fetch')` para SC-CTX-03 y SC-CTX-05.

### 4.2 — RED: tests de apiClient

- [ ] **4.2** `🔴 RED` — Crear `apps/frontend/tests/api-client.test.ts` con `vi.spyOn(global, 'fetch')`. Todos deben FALLAR:

  - `SC-API-01` — `apiClient.get('/api/wallets')` envía fetch con `credentials: 'include'`
  - `SC-API-02` — fetch retorna `401` en ruta no-login → llama `redirectToLogin()` y lanza `UnauthorizedError`
  - `SC-API-03` — fetch retorna `200` con `{ data: [1, 2, 3] }` → `apiClient.get()` resuelve con ese objeto
  - `SC-API-04` — fetch lanza `TypeError` (network error) → `apiClient.get()` lanza un Error que NO es `UnauthorizedError`; `redirectToLogin()` NO es llamado
  - `SC-API-05` — `apiClient.post('/api/auth/login', { password: 'wrong' }, { skipAuthRedirect: true })` con fetch retornando `401` → lanza `UnauthorizedError` pero `redirectToLogin()` NO es llamado (cubre NEGATIVE-FE-01 del lado del cliente)
  - `SC-API-06` — `apiClient.post('/api/auth/login', { password: 'abc' })` → fetch recibe `Content-Type: application/json` y body `'{"password":"abc"}'`

  > Para testear la integración con `redirectToLogin`, registrar un mock via `registerAuthBridge` antes de cada test.

### 4.3 — GREEN: implementar auth-context.tsx

- [ ] **4.3** `🟢 GREEN` — Crear `apps/frontend/src/lib/auth-context.tsx`:
  - Interfaz `AuthContextValue` con `isAuthenticated`, `login`, `logout`, `redirectToLogin`
  - `AuthProvider`: `isAuthenticated` arranca en `false`; `login()` setea `true`; `logout()` llama `POST /api/auth/logout` con `credentials: 'include'`, setea `false`, navega a `/login`; `redirectToLogin()` setea `false` y navega a `/login` sin backend
  - Montar un componente interno `AuthBridge` dentro del provider que llame `registerAuthBridge(navigateBasedRedirect)` en un `useEffect` — esto permite que `apiClient` acceda a `navigate` sin acoplarse a React
  - `useAuth()` — lanza si se usa fuera del provider

### 4.4 — GREEN: implementar api-client.ts

- [ ] **4.4** `🟢 GREEN` — Crear `apps/frontend/src/lib/api-client.ts`:
  - `export class UnauthorizedError extends Error {}`
  - `interface ApiOptions extends RequestInit { skipAuthRedirect?: boolean }`
  - `let _redirectToLogin: () => void` con fallback a `window.location.assign('/login')`
  - `export function registerAuthBridge(redirect: () => void): void`
  - `apiClient.get<T>(url, options?)` y `apiClient.post<T>(url, body, options?)`
  - Siempre incluir `credentials: 'include'`; POST/PUT/PATCH incluyen `Content-Type: application/json` + `JSON.stringify(body)`
  - Status 2xx → parsear JSON; status 401 → verificar `skipAuthRedirect`, llamar `_redirectToLogin()` si no está activado, lanzar `UnauthorizedError`; otros errores → lanzar `Error` con status

  > Correr los tests de 4.1 y 4.2 — todos deben pasar.

### 4.5 — REFACTOR

- [ ] **4.5** `🔵 REFACTOR` — Revisar:
  - El tipo de retorno de `apiClient.get<T>` y `apiClient.post<T>` es genérico y bien inferido
  - `UnauthorizedError` tiene `instanceof` que funciona correctamente en el bundle (herencia de `Error` en ESM)
  - Si `_redirectToLogin` fallback usa `window.location.assign`, confirmar que los tests de node no rompen (mockear `window` si hace falta)
  - Re-correr los tests de fase 4

---

## Fase 5 — LoginPage + ProtectedRoute (TDD)

> Cubre: `apps/frontend/src/pages/LoginPage.tsx`, `apps/frontend/src/routes/router.tsx` (incluye `ProtectedRoute`), `apps/frontend/src/pages/DashboardPlaceholder.tsx`, y la modificación de `apps/frontend/src/App.tsx`
> Spec de referencia: `specs/auth-frontend/spec.md` §3, §4, §6, §7

### 5.1 — RED: tests de LoginPage

- [ ] **5.1** `🔴 RED` — Crear `apps/frontend/tests/login-page.test.tsx` con `render` + `userEvent` y MSW (o `vi.spyOn(global, 'fetch')`) para mockear el backend. Todos deben FALLAR:

  - `SC-LOGIN-PAGE-01` — al montar `<LoginPage>`, se renderiza un input `type="password"` y un botón con texto "Entrar"; NO hay mensaje de error visible
  - `SC-LOGIN-PAGE-02` — submit con password correcto (mock 200) → se llama `POST /api/auth/login`, `auth.login()` es llamado, y el router navega a `/`
  - `SC-LOGIN-PAGE-03` — submit con password incorrecto (mock 401) → se muestra mensaje de error visible; `redirectToLogin()` NO es llamado (cubre NEGATIVE-FE-01)
  - `SC-LOGIN-PAGE-04` — submit con campo vacío → NO se realiza ningún fetch; se muestra mensaje de validación local "Ingresá tu password" (cubre NEGATIVE-FE-03)
  - `SC-LOGIN-PAGE-05` — durante el submit en vuelo, el botón "Entrar" está deshabilitado y el campo password está deshabilitado
  - `SC-LOGIN-PAGE-06` — error de red (TypeError en fetch) → se muestra "Error de conexión. Intentá nuevamente." sin crashear la app (cubre NEGATIVE-FE-04)

  > Usar un `MemoryRouter` con historia inicial `['/login']` para que `useNavigate` funcione.
  > Verificar SC-LOGIN-PAGE-03 con `expect(mockRedirectToLogin).not.toHaveBeenCalled()`.

### 5.2 — RED: tests de ProtectedRoute

- [ ] **5.2** `🔴 RED` — Crear `apps/frontend/tests/protected-route.test.tsx` con memory router. Todos deben FALLAR:

  - `SC-PROT-01` — con `isAuthenticated = true`, `ProtectedRoute` renderiza sus children
  - `SC-PROT-02` — con `isAuthenticated = false`, `ProtectedRoute` redirige a `/login` y NO renderiza children (cubre NEGATIVE-FE-05)
  - `SC-PROT-03` — reload de página (nueva instancia de `AuthProvider`) → `isAuthenticated` arranca en `false` → la ruta `/` redirige a `/login`

### 5.3 — GREEN: implementar LoginPage.tsx

- [ ] **5.3** `🟢 GREEN` — Crear `apps/frontend/src/pages/LoginPage.tsx`:
  - Estado local: `password`, `error`, `submitting`
  - Validación local: si `password.trim() === ''` → setea error "Ingresá tu password", no hace fetch
  - Submit: `setSubmitting(true)`, llama `apiClient.post('/api/auth/login', { password }, { skipAuthRedirect: true })`
  - Éxito (200): llama `auth.login()`, navega a `/`
  - Fallo `UnauthorizedError`: setea error `"Password incorrecto"`
  - Fallo network/otro: setea error `"Error de conexión. Intentá nuevamente."` o `"Ocurrió un error. Intentá nuevamente."`
  - Layout Tailwind 4: container centrado (`grid place-items-center min-h-dvh`), card `max-w-sm`
  - Accesibilidad: `<label htmlFor="password">`, `role="alert"` en el div de error, `aria-disabled={submitting}` en el botón

### 5.4 — GREEN: implementar router.tsx (con ProtectedRoute)

- [ ] **5.4** `🟢 GREEN` — Crear `apps/frontend/src/routes/router.tsx`:
  - `ProtectedRoute({ children })`: consume `useAuth()`; si `!isAuthenticated` devuelve `<Navigate to="/login" replace />`; si no, devuelve `<>{children}</>`
  - `createBrowserRouter` con rutas: `{ path: '/login', element: <LoginPage /> }` y `{ path: '/', element: <ProtectedRoute><DashboardPlaceholder /></ProtectedRoute> }`

- [ ] **5.5** `🟢 GREEN` — Crear `apps/frontend/src/pages/DashboardPlaceholder.tsx`:
  - Componente stub mínimo: `<div>Dashboard — US-004 pendiente</div>`
  - (Será reemplazado por la implementación real en US-004)

- [ ] **5.6** `🟢 GREEN` — Modificar `apps/frontend/src/App.tsx`:
  - Reemplazar el contenido actual por `<AuthProvider><RouterProvider router={router} /></AuthProvider>`
  - `AuthProvider` DEBE envolver `RouterProvider` — el orden es NO negociable (ver design §3.4)

  > Correr TODOS los tests de las fases 4 y 5 — todos deben pasar.

### 5.7 — REFACTOR

- [ ] **5.7** `🔵 REFACTOR` — Revisar:
  - Que `LoginPage` limpia el campo de error al iniciar un nuevo submit (`setError(null)` antes del fetch)
  - Que el botón "Entrar" tiene `type="submit"` (no `type="button"`) para que `Enter` en el input haga submit
  - Que el `<p role="alert">` está presente en el DOM siempre (aunque vacío) y se muestra solo cuando hay error — esto evita layout shifts
  - Re-correr todos los tests de fases 4 y 5

---

## Fase 6 — Quality gates

> Verificación final antes de marcar la story como completa. Ningún gate bloquea al siguiente si son independientes.

- [ ] **6.1** Ejecutar `npm run typecheck` en `apps/backend` y `apps/frontend` — ambos deben pasar sin errores. Corregir cualquier tipo faltante (principalmente el decorador `fastify.authenticate` que necesita declaración de tipo en `@types/fastify`).

- [ ] **6.2** Ejecutar `npm run lint` en raíz — debe pasar sin errores nuevos. Si el proyecto no tiene ESLint configurado todavía, documentar como pendiente sin bloquear.

- [ ] **6.3** Ejecutar el suite completo de tests (`npm run test:engine` o el comando vitest configurado) — todos los tests de las fases 2, 3, 4 y 5 deben pasar. Cero tests en rojo.

- [ ] **6.4** Ejecutar `npm run build` en `apps/backend` (`tsc`) y `apps/frontend` (`tsc -b && vite build`) — ambos deben compilar sin errores.

---

## Notas críticas para apply

### Orden de plugins (NON-NEGOTIABLE)

```
bootstrapAuth()          ← antes de new Fastify()
@fastify/cookie          ← 1ro
@fastify/jwt             ← 2do
authPlugin               ← 3ro (y DENTRO: authRoutes ANTES del onRequest hook)
```

Alterar este orden produce síntomas engañosos (500 con TypeError en lugar de 401). El test de middleware lo detecta.

### JWT sub claim

`sub: 'admin'` — literal. Cualquier otra variante rompe SC-JWT-01 y los tests de middleware que decodifican el payload.

### AuthProvider sobre RouterProvider

`<AuthProvider>` envuelve `<RouterProvider>`. Invertirlo rompe `useNavigate` con "must be used within a Router". El test de ProtectedRoute lo detecta.

### bcrypt nativo (Plan B)

Si `bcrypt` falla `node-gyp` en el entorno, reemplazar por `bcryptjs` en 1.1 y 1.2. La API es idéntica; solo cambia el import y los @types. Documentar el swap en el design (ADR-003).

### Declaración de tipos de Fastify

`fastify.authenticate` es un decorador custom. TypeScript necesita que se declare la extensión de tipo:

```typescript
// apps/backend/src/types/fastify.d.ts (o en plugins/auth.ts mismo)
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}
```

Sin esto, `6.1` falla en typecheck.

### isLoading en AuthContext

El design declara `isLoading` en la interfaz pero US-003 no lo usa. Se puede declarar como `isLoading: false as const` para no romper la API futura cuando US-003.1 lo active.
