# Propuesta — US-003: JWT Auth (backend + pantalla de login)

> **Estado:** propuesta inicial
> **Change name:** `US-003-jwt-auth`
> **Depende de:** `US-001-scaffold`, `US-002-db-schema`
> **Stack target:** Fastify 5 + TypeScript + Zod 4 (backend) · React 19 + Vite 6 + Tailwind 4 (frontend)

---

## 1. Intent

Hoy el backend escaffoldeado en US-001 expone únicamente `/health` sin ningún tipo de protección, y el frontend es una landing estática. La US-003 incorpora la **única barrera de seguridad** del producto: una autenticación de password único que hashea contra `APP_PASSWORD`, emite un JWT HS256 de 24h en cookie httpOnly y exige ese token en todas las rutas `/api/*`.

Esto es bloqueante para cualquier story posterior (`US-004` wallets en adelante) porque:

- Sin `AuthMiddleware` registrado, las APIs futuras nacerían **públicas** y refactorizarlas después implica reabrir cada plugin.
- Sin login en el frontend no hay forma de mantener sesión ni de probar flujos autenticados end-to-end.
- El flag `Secure` y `SameSite=Strict` afectan la estrategia de testing E2E (vitest project `e2e`), entonces conviene fijar el contrato ahora.

El alcance es deliberadamente chico —es un app **single-user**, no hay tabla `users`, no hay roles, no hay refresh tokens— pero todas las decisiones de cookie, middleware y manejo de 401 quedan congeladas acá.

---

## 2. Scope

### Archivos nuevos

**Backend (`apps/backend/src/`):**

- `plugins/auth.ts` — plugin Fastify que registra `@fastify/cookie` + `@fastify/jwt` y expone el decorador `request.authenticate` (preHandler).
- `routes/auth.ts` — plugin con `POST /api/auth/login` y `POST /api/auth/logout`.
- `services/password.ts` — utilitario para hashear `APP_PASSWORD` (bcrypt factor 12) y comparar passwords en login.
- `services/auth-bootstrap.ts` — startup hook: al primer arranque, hashea `APP_PASSWORD` y persiste el hash (ver §3 para destino).
- `tests/auth/login.test.ts`, `tests/auth/logout.test.ts`, `tests/auth/middleware.test.ts` — vitest project `engine`/`e2e`.

**Frontend (`apps/frontend/src/`):**

- `pages/LoginPage.tsx` — formulario con un único campo password + botón Entrar.
- `lib/api-client.ts` — wrapper sobre `fetch` con `credentials: 'include'` y interceptor de 401 → redirect.
- `lib/auth-context.tsx` — React Context con estado `isAuthenticated` + `redirectToLogin()`.
- `routes/router.tsx` — router mínimo (ver §3 sobre librería).
- Tests: `tests/login-page.test.tsx`, `tests/api-client.test.ts`.

### Archivos modificados

- `apps/backend/src/index.ts` — registrar `authPlugin` y `authRoutes` antes de cualquier otra ruta `/api/*`; invocar el bootstrap.
- `apps/backend/src/env.ts` — sin cambios funcionales (las claves ya existen), pero validamos que `JWT_SECRET ≥ 32` chars sigue activo y agregamos un `cookieSecret` derivado (ver §3).
- `apps/frontend/src/App.tsx` — montar el `<AuthProvider>` y router.
- `apps/frontend/src/main.tsx` — sin cambios salvo entrypoint del provider.
- `package.json` (backend) — agregar `@fastify/cookie`, `@fastify/jwt`, `bcrypt` (+ `@types/bcrypt`).
- `package.json` (frontend) — agregar la lib de routing elegida (ver Open Questions).

### Fuera de scope

- Recuperación de password (no aplica, single-user).
- Refresh tokens / rotación de JWT.
- Rate limiting del endpoint de login (queda para una story de hardening posterior).
- 2FA / TOTP.
- Logout server-side con blacklist (con cookie httpOnly y JWT 24h alcanza para V1).

---

## 3. Approach

### 3.1. Hash de `APP_PASSWORD` — startup hook, no comando separado

**Decisión:** se hashea en el startup hook del servidor, no en un `npm run setup` separado.

**Razón:** este es un app single-user que ya lee `APP_PASSWORD` desde `.env`. Exigir un comando manual aparte agrega fricción en deploys de Render (que ejecutan `npm start` directamente) sin beneficio real. El hook detecta si ya existe un hash persistido para esa password (comparando un fingerprint, ver §3.2) y lo reusa; si la password cambió en `.env`, regenera el hash.

**Alternativa descartada:** `npm run setup` separado. Lo descartamos porque obligaría a documentar un paso pre-deploy en Render y a manejar el caso "olvidé correr setup" → 401 misterioso al primer login.

### 3.2. Persistencia del hash

`APP_PASSWORD` viene en plano por env. El hash bcrypt vive **en memoria del proceso** durante todo su ciclo de vida —no lo persistimos en DB ni en disco—. En cada arranque:

1. Leemos `APP_PASSWORD` de env.
2. Calculamos `bcrypt.hash(APP_PASSWORD, 12)` una sola vez.
3. Lo guardamos en una variable módulo-scoped expuesta como `getPasswordHash()`.

Esto evita una migración nueva (no hay tabla `app_config` aún) y simplifica el modelo. Si en algún momento se quiere rotar password sin reiniciar, será una nueva story.

### 3.3. AuthMiddleware — plugin Fastify con `onRequest` hook

**Decisión:** registrar como **plugin** que aplica a un prefix `/api/*` mediante `fastify.register(apiPlugin, { prefix: '/api' })` con `onRequest: fastify.authenticate` configurado en el plugin padre. NO usamos decorador por ruta porque obliga a recordar declararlo en cada handler nuevo —y olvidarlo deja la ruta pública sin warning.

`/api/auth/login` y `/api/auth/logout` se registran **fuera** del prefix protegido (en `/api/auth` con su propio plugin sin el hook), o usan `request.routeOptions.config.public = true` para optar por salirse del middleware.

**Alternativa descartada:** decorador por ruta. Inseguro por defecto (fail-open) — la US-003 NEGATIVE obliga a fail-closed.

### 3.4. Cookie — `Secure` condicional por entorno

**Decisión:**

| Entorno | `Secure` | `SameSite` | `httpOnly` |
|---------|----------|------------|------------|
| `NODE_ENV=production` | `true` | `Strict` | `true` |
| `NODE_ENV=development` | `false` | `Lax` | `true` |
| `NODE_ENV=test` | `false` | `Lax` | `true` |

`Secure=true` con HTTP local rompe el flujo de dev (el browser descarta la cookie). En prod en Render se sirve sobre HTTPS, así que el flag activa naturalmente. `SameSite=Strict` en dev también es problemático cuando frontend (`localhost:5173`) y backend (`localhost:3000`) están en puertos distintos —técnicamente same-site, pero algunos browsers lo tratan como cross-site en localhost—; bajamos a `Lax` en dev/test.

**Trade-off aceptado:** en dev el modelo de seguridad es laxo, pero el PRD exige el modelo estricto solo "en producción" implícitamente (el flag `Secure` sin HTTPS es contradictorio).

### 3.5. Frontend — interceptor en api-client + Context

**Decisión:** wrapper `fetch` propio en `lib/api-client.ts` (no axios). Dos motivos:

1. El proyecto no tiene axios instalado y agregar 30KB para un wrapper que solo necesita 401-handling es desproporcionado.
2. `fetch` con `credentials: 'include'` ya cumple para enviar la cookie httpOnly; no necesitamos lógica de refresh token.

El wrapper:

- Inyecta `credentials: 'include'` siempre.
- Si la respuesta es 401, llama a `authContext.redirectToLogin()` y rechaza la promesa con un error tipado `UnauthorizedError`.
- Cualquier componente que use `apiClient.get/post/etc.` queda automáticamente protegido.

`AuthContext` expone `isAuthenticated` (derivado de "el último call no falló con 401") y `redirectToLogin()` que usa el router. Esto evita que cada componente tenga que manejar 401 a mano.

### 3.6. Routing en frontend

Agregamos `react-router-dom` (v7). Es la opción standard, y necesitamos al menos dos rutas (`/login` y `/`) más capacidad de redirect programático. Tanstack Router es una alternativa pero pesa más en bundle y es overkill para 2 rutas. Ver Open Questions §8.

### 3.7. Login flow

```
Browser              Frontend                Backend
   │                    │                        │
   │  GET /login        │                        │
   ├───────────────────>│                        │
   │  <LoginPage>       │                        │
   │<───────────────────│                        │
   │                    │                        │
   │  submit password   │                        │
   ├───────────────────>│  POST /api/auth/login  │
   │                    ├───────────────────────>│
   │                    │                        │  bcrypt.compare
   │                    │                        │  jwt.sign(HS256, 24h)
   │                    │  Set-Cookie: token=…   │
   │                    │<───────────────────────│
   │                    │  router.push('/')      │
   │                    │                        │
   │  GET /api/health   │                        │
   │  (cookie atada)    ├───────────────────────>│  authPlugin verifica
   │                    │  200 OK                │
```

### 3.8. Testing strategy (Strict TDD activo)

- **Unit (vitest project `engine`):** `services/password.ts` (hash + compare), `plugins/auth.ts` con un Fastify mock.
- **E2E (vitest project `e2e`):** flujo completo login → request protegido → logout → request protegido falla. Usa `DATABASE_URL_TEST` aunque US-003 no toque DB —para reproducir el ambiente real.
- **Frontend (vitest + RTL):** `LoginPage` renderiza, valida campo vacío, dispara POST con MSW mock; `api-client` intercepta 401 y llama `redirectToLogin`.

Cada test se escribe **antes** del código (rojo → verde → refactor).

---

## 4. Affected modules / packages

| Módulo | Cambio | Notas |
|--------|--------|-------|
| `apps/backend/src/plugins/auth.ts` | NUEVO | Plugin Fastify con `@fastify/jwt` + `@fastify/cookie`, decorador `authenticate`. |
| `apps/backend/src/routes/auth.ts` | NUEVO | Endpoints `login` y `logout`. Excluido del middleware. |
| `apps/backend/src/services/password.ts` | NUEVO | `hashPassword(plain)`, `verifyPassword(plain, hash)`. Wrappers de bcrypt. |
| `apps/backend/src/services/auth-bootstrap.ts` | NUEVO | Hashea `APP_PASSWORD` al startup. Idempotente por proceso. |
| `apps/backend/src/index.ts` | MODIFICADO | Registra plugins en orden: env → bootstrap → cookie → jwt → auth → routes públicas → routes protegidas. |
| `apps/frontend/src/pages/LoginPage.tsx` | NUEVO | Form Tailwind 4. |
| `apps/frontend/src/lib/api-client.ts` | NUEVO | Wrapper `fetch` con `credentials: 'include'` + 401 interceptor. |
| `apps/frontend/src/lib/auth-context.tsx` | NUEVO | Provider + hook `useAuth()`. |
| `apps/frontend/src/routes/router.tsx` | NUEVO | `react-router-dom` con guard. |
| `apps/frontend/src/App.tsx` | MODIFICADO | Monta `<AuthProvider><RouterProvider/></AuthProvider>`. |
| `package.json` (backend) | MODIFICADO | + `@fastify/cookie@^11`, `@fastify/jwt@^9`, `bcrypt@^5`, `@types/bcrypt`. |
| `package.json` (frontend) | MODIFICADO | + `react-router-dom@^7`. |

---

## 5. Dependencies

- **US-001-scaffold (archivado 2026-04-22):** este change asume que existen `apps/backend/src/index.ts` con buildServer + setErrorHandler, `apps/frontend/src/App.tsx` con Tailwind 4 funcionando, vitest configurado con projects `engine`/`sync`/`e2e`, y `.env.example` con `JWT_SECRET` y `APP_PASSWORD`.
- **US-002-db-schema (archivado 2026-04-26):** sin dependencia funcional directa —US-003 no toca DB—. Se mantiene en el orden histórico para no recortar el grafo del PRD.

---

## 6. Rollback plan

El change es aditivo: no modifica DB ni borra archivos. Para revertir:

1. `git revert` de los commits del change → vuelve a `index.ts` sin auth registrado.
2. Eliminar las dependencias agregadas: `npm uninstall @fastify/cookie @fastify/jwt bcrypt -w apps/backend` y `npm uninstall react-router-dom -w apps/frontend`.
3. **No hace falta migración inversa** porque no se tocó schema.
4. Si el rollback ocurre **después** de tener wallets persistidas (US-004+), las APIs quedarían públicas — bloqueante. Por eso el rollback solo es seguro **antes** de mergear cualquier story dependiente que asuma rutas protegidas.

Si solo falla la pieza de frontend, se puede dejar el backend con auth y rollbackear únicamente `apps/frontend/`. El backend con auth funciona standalone (testeable por curl con cookies).

---

## 7. Risks

### R1 — `Secure=true` rompe el login en dev (alta probabilidad, bajo impacto)

**Riesgo:** si copio el modelo "Secure + SameSite=Strict" tal como dice el PRD y lo aplico literal en `NODE_ENV=development`, el browser descarta la cookie y nadie puede loguearse local.

**Mitigación:** estrategia explícita §3.4 — cookie `Secure` condicional. Documentado en spec/design para que el verifier no lo marque como desviación del PRD.

### R2 — bcrypt nativo falla al instalar en Render Linux (media probabilidad, alto impacto)

**Riesgo:** `bcrypt` requiere compilación nativa. En Render free tier puede fallar el `node-gyp` build.

**Mitigación:** plan A → usar `bcrypt` y testear en pipeline antes de mergear. Plan B → si rompe, swap a `bcryptjs` (puro JS, ~3x más lento pero suficiente para un solo login). Levanto issue separado si pasa; no bloqueante.

### R3 — Olvido de marcar rutas como públicas → login mismo queda detrás del middleware (media probabilidad, alto impacto)

**Riesgo:** el middleware es fail-closed por diseño (§3.3). Si registramos `authRoutes` dentro del prefix protegido por error, el endpoint de login pide token para emitir token → bootstrap loop imposible.

**Mitigación:** test E2E explícito que valida `POST /api/auth/login` sin cookie devuelve 200 con cookie seteada (no 401). El test corre en CI antes de mergear.

---

## 8. Open questions

1. **Router:** ¿`react-router-dom@7` está aprobado o preferís un router más liviano (wouter, tanstack-router, o ruteo manual con `useState` como en el prototipo)? El PRD no lo fija. **Default sugerido:** `react-router-dom@7` por ergonomía y porque la story de wallets va a sumar `/wallets`, `/token/:address/:network`, `/transactions/new`, etc.

2. **Logout:** ¿alcanza con limpiar la cookie (clear `Set-Cookie` con `Max-Age=0`) o el PRD espera además invalidación server-side? Acceptance criterion 2 dice "limpia la cookie" textual, así que asumo no-blacklist. Confirmar antes de spec.

3. **`/api/auth/login` rate-limit:** el PRD no lo pide explícitamente para US-003 pero NEGATIVE clause #7 ("no revelar si el usuario existe") sugiere endurecimiento. ¿Lo dejamos out-of-scope para una story de hardening, o agregamos un rate-limit básico (5 intentos/min) ahora? **Default sugerido:** out-of-scope, dado que es single-user y el ataque tiene superficie mínima. Documentar como tech-debt.

4. **Hash en memoria vs DB:** §3.2 propone hash en memoria. ¿Hay objeción a no persistir el hash? Lo único que cambia si persistimos es que detectaríamos cambio de `APP_PASSWORD` entre reinicios (hoy se rehashea cada arranque, lo cual es irrelevante con bcrypt factor 12 → ~250ms una sola vez).
