# Spec — US-003 JWT Auth · Backend

> **Change:** `US-003-jwt-auth`
> **Capability:** Autenticación JWT HS256 — backend
> **Estado:** borrador
> **Última revisión:** 2026-04-27

---

## Índice

1. [Alcance de esta spec](#1-alcance)
2. [AppPasswordService](#2-apppasswordservice)
3. [Endpoint POST /api/auth/login](#3-endpoint-post-apiauthlogin)
4. [Endpoint POST /api/auth/logout](#4-endpoint-post-apiauthlogout)
5. [authPlugin — middleware de autenticación](#5-authplugin)
6. [JWT — estructura del token](#6-jwt)
7. [Cookie — atributos y variantes por entorno](#7-cookie)
8. [Escenarios NEGATIVOS](#8-escenarios-negativos)
9. [Contratos de error](#9-contratos-de-error)

---

## 1. Alcance

Esta spec cubre **únicamente** los componentes de backend de US-003. Los componentes de frontend se especifican en `specs/auth-frontend/spec.md`.

Archivos afectados:

| Archivo | Acción |
|---------|--------|
| `apps/backend/src/services/password.ts` | NUEVO |
| `apps/backend/src/services/auth-bootstrap.ts` | NUEVO |
| `apps/backend/src/plugins/auth.ts` | NUEVO |
| `apps/backend/src/routes/auth.ts` | NUEVO |
| `apps/backend/src/index.ts` | MODIFICADO |
| `apps/backend/tests/auth/` | NUEVO (tests) |

---

## 2. AppPasswordService

### 2.1. Descripción

`AppPasswordService` es el módulo responsable de (a) hashear `APP_PASSWORD` al inicio del proceso y (b) verificar passwords en tiempo de login. El hash DEBE vivir **en memoria del proceso** —no en DB ni en disco—. En cada arranque se recalcula.

### 2.2. API del módulo

```typescript
// apps/backend/src/services/password.ts

export async function hashPassword(plain: string): Promise<string>
export async function verifyPassword(plain: string, hash: string): Promise<boolean>
```

### 2.3. Invariantes

- `hashPassword` DEBE usar `bcrypt` (plan A) o `bcryptjs` (plan B si falla compilación nativa) con `saltRounds = 12`.
- `hashPassword` NO DEBE ser llamado más de una vez por proceso. El resultado se cachea en `auth-bootstrap.ts`.
- `verifyPassword` DEBE ser tiempo-constante (propiedad inherente de `bcrypt.compare`).
- `verifyPassword` NO DEBE lanzar excepción si `hash` es una cadena válida de bcrypt. Para cualquier otro fallo del comparador, DEBE retornar `false`.

### 2.4. auth-bootstrap.ts — startup hook

```typescript
// apps/backend/src/services/auth-bootstrap.ts

let _passwordHash: string | null = null

export async function bootstrapAuth(): Promise<void>
export function getPasswordHash(): string   // throws if called before bootstrapAuth
```

`bootstrapAuth()`:
1. Lee `process.env.APP_PASSWORD`.
2. Si `APP_PASSWORD` está vacío o ausente, DEBE lanzar un error con mensaje `"APP_PASSWORD env var is required"` que aborte el proceso.
3. Llama a `hashPassword(APP_PASSWORD)` y guarda el resultado en `_passwordHash`.
4. Es idempotente dentro del mismo proceso: llamadas subsiguientes NO DEBEN re-hashear.

`getPasswordHash()`:
- Si `bootstrapAuth()` no fue llamado previamente, DEBE lanzar `Error("Auth not bootstrapped")`.

---

### 2.5. Escenarios — AppPasswordService

#### SC-PASS-01: hash exitoso

**Given** `APP_PASSWORD = "SecurePassword123!"`
**When** se llama a `hashPassword("SecurePassword123!")`
**Then** retorna un string que comienza con `"$2b$12$"` (bcrypt factor 12)

#### SC-PASS-02: verificación correcta

**Given** un hash `h` generado con `hashPassword("SecurePassword123!")`
**When** se llama a `verifyPassword("SecurePassword123!", h)`
**Then** retorna `true`

#### SC-PASS-03: verificación incorrecta

**Given** un hash `h` generado con `hashPassword("SecurePassword123!")`
**When** se llama a `verifyPassword("WrongPassword", h)`
**Then** retorna `false`

#### SC-PASS-04: bootstrap sin APP_PASSWORD

**Given** `process.env.APP_PASSWORD` es `undefined`
**When** se llama a `bootstrapAuth()`
**Then** lanza un error con mensaje `"APP_PASSWORD env var is required"`

#### SC-PASS-05: getPasswordHash antes de bootstrap

**Given** `bootstrapAuth()` no fue llamado
**When** se llama a `getPasswordHash()`
**Then** lanza `Error("Auth not bootstrapped")`

#### SC-PASS-06: bootstrap idempotente

**Given** `bootstrapAuth()` fue llamado una primera vez exitosamente
**When** se llama a `bootstrapAuth()` por segunda vez
**Then** retorna sin error y NO llama a `bcrypt.hash` nuevamente (el hash previo se mantiene)

---

## 3. Endpoint POST /api/auth/login

### 3.1. Request

| Campo | Tipo | Requerido | Validación |
|-------|------|-----------|------------|
| `password` | `string` | MUST | `min(1)` — no vacío |

Schema Zod (TypeScript):

```typescript
const LoginBodySchema = z.object({
  password: z.string().min(1),
})
```

El endpoint DEBE rechazar content-type distinto de `application/json` con `400`.

### 3.2. Flujo de autenticación (éxito)

1. Deserializar body con `LoginBodySchema`.
2. Obtener `getPasswordHash()`.
3. `verifyPassword(body.password, hash)` → `true`.
4. Firmar JWT: `fastify.jwt.sign({ sub: 'admin' }, { expiresIn: '24h' })`.
5. Emitir cookie `token` con los atributos del §7.
6. Responder `200 { ok: true }`.

### 3.3. Flujo de autenticación (fallo)

1. Deserializar body (si falla Zod → `400`).
2. `verifyPassword(body.password, hash)` → `false`.
3. Responder `401 { error: "Unauthorized" }` sin revelar si el password fue "casi correcto" ni si el usuario existe.

### 3.4. Escenarios — login

#### SC-LOGIN-01: login exitoso

**Given** el servidor arrancó con `APP_PASSWORD = "SecurePassword123!"`
**And** el body es `{ "password": "SecurePassword123!" }`
**When** se envía `POST /api/auth/login` con `Content-Type: application/json`
**Then** la respuesta es `200 { ok: true }`
**And** el header `Set-Cookie` contiene un token JWT firmado con los atributos del §7
**And** el token decodificado tiene `sub = "admin"` y `exp` dentro de 24h

#### SC-LOGIN-02: password incorrecto

**Given** el servidor arrancó con `APP_PASSWORD = "SecurePassword123!"`
**And** el body es `{ "password": "wrong" }`
**When** se envía `POST /api/auth/login`
**Then** la respuesta es `401 { error: "Unauthorized" }`
**And** el body NO contiene el campo `password` ni ninguna pista sobre el valor correcto
**And** NO se emite `Set-Cookie`

#### SC-LOGIN-03: body vacío

**Given** el body de la request es `{}`
**When** se envía `POST /api/auth/login`
**Then** la respuesta es `400` con un error de validación Zod

#### SC-LOGIN-04: content-type incorrecto

**Given** el body es `password=SecurePassword123!` (form-encoded)
**And** el `Content-Type` es `application/x-www-form-urlencoded`
**When** se envía `POST /api/auth/login`
**Then** la respuesta es `400`

#### SC-LOGIN-05: endpoint accesible sin cookie (el login en sí es ruta pública)

**Given** el cliente no tiene cookie `token`
**When** se envía `POST /api/auth/login` con password correcto
**Then** la respuesta es `200` (no `401` por el middleware)

---

## 4. Endpoint POST /api/auth/logout

### 4.1. Comportamiento

El endpoint DEBE:
1. Limpiar la cookie `token` estableciendo `Max-Age=0` (y/o `Expires` en el pasado).
2. Responder `200 { ok: true }`.
3. NO requerir que exista una cookie previa (logout idempotente).
4. NO realizar invalidación server-side (no hay blacklist en V1).

### 4.2. Escenarios — logout

#### SC-LOGOUT-01: logout exitoso con sesión activa

**Given** el cliente tiene una cookie `token` válida
**When** se envía `POST /api/auth/logout`
**Then** la respuesta es `200 { ok: true }`
**And** el header `Set-Cookie` limpia la cookie con `Max-Age=0`

#### SC-LOGOUT-02: logout sin cookie (idempotente)

**Given** el cliente NO tiene cookie `token`
**When** se envía `POST /api/auth/logout`
**Then** la respuesta es `200 { ok: true }` (no `401`)
**And** el header `Set-Cookie` limpia igualmente la cookie (no causa error)

#### SC-LOGOUT-03: endpoint accesible sin autenticación (ruta pública)

**Given** el cliente no tiene cookie `token`
**When** se envía `POST /api/auth/logout`
**Then** el `authPlugin` NO intercepta la request con 401

---

## 5. authPlugin

### 5.1. Descripción

`authPlugin` es el plugin Fastify que aplica la verificación del JWT en todas las rutas bajo el prefijo `/api/`, **excepto** `/api/auth/login` y `/api/auth/logout`.

El plugin DEBE:
- Registrar `@fastify/cookie` y `@fastify/jwt` (si no están registrados globalmente).
- Exponer el decorador `fastify.authenticate` como preHandler.
- Ser registrado con `fastify.register(apiPlugin, { prefix: '/api' })` de modo que todas las rutas hijas hereden el hook `onRequest`.
- Las rutas de auth (`/api/auth/login`, `/api/auth/logout`) DEBEN registrarse **fuera** del scope protegido o con `config.public = true`.

El plugin NO DEBE:
- Bloquear `/api/auth/login` ni `/api/auth/logout`.
- Dejar ninguna ruta `/api/*` futura en estado "pública por defecto" — el modelo es **fail-closed**.

### 5.2. Lógica de autenticación

`fastify.authenticate` (preHandler):
1. Leer cookie `token` de la request.
2. Si la cookie no existe → `401 { error: "Unauthorized" }`.
3. Verificar el JWT con `fastify.jwt.verify(token)`.
4. Si el JWT es inválido o expirado → `401 { error: "Unauthorized" }`.
5. Si es válido → continuar al handler.

### 5.3. Escenarios — authPlugin

#### SC-MW-01: request con token válido

**Given** el cliente tiene cookie `token` con un JWT válido y no expirado
**When** se envía `GET /api/wallets` (ruta protegida de ejemplo)
**Then** el preHandler invoca `next()` y el handler procesa la request normalmente

#### SC-MW-02: request sin cookie

**Given** el cliente no tiene cookie `token`
**When** se envía `GET /api/wallets`
**Then** la respuesta es `401 { error: "Unauthorized" }`
**And** el handler de la ruta NO es invocado

#### SC-MW-03: token expirado

**Given** el cliente tiene cookie `token` con un JWT expirado (exp en el pasado)
**When** se envía `GET /api/wallets`
**Then** la respuesta es `401 { error: "Unauthorized" }`

#### SC-MW-04: token con firma inválida (tampered)

**Given** el cliente tiene cookie `token` con un JWT cuya firma no coincide con `JWT_SECRET`
**When** se envía `GET /api/wallets`
**Then** la respuesta es `401 { error: "Unauthorized" }`

#### SC-MW-05: token malformado (no es JWT)

**Given** el cliente tiene cookie `token = "not.a.jwt"`
**When** se envía `GET /api/wallets`
**Then** la respuesta es `401 { error: "Unauthorized" }` (no `500`)

#### SC-MW-06: login es ruta pública (no bloqueada por middleware)

**Given** el cliente no tiene cookie `token`
**When** se envía `POST /api/auth/login`
**Then** el `authPlugin` NO devuelve 401 — la request llega al handler de login

#### SC-MW-07: logout es ruta pública (no bloqueada por middleware)

**Given** el cliente no tiene cookie `token`
**When** se envía `POST /api/auth/logout`
**Then** el `authPlugin` NO devuelve 401 — la request llega al handler de logout

---

## 6. JWT — estructura del token

### 6.1. Algoritmo y claims

| Campo | Valor |
|-------|-------|
| Algoritmo | `HS256` |
| `sub` | `"admin"` (literal — single-user, no hay userId en DB) |
| `iat` | timestamp Unix de emisión (segundos) |
| `exp` | `iat + 86400` (24 horas) |

El token NO DEBE incluir datos de sesión adicionales (no password, no roles).

### 6.2. Secreto

- `JWT_SECRET` DEBE ser leído desde `process.env.JWT_SECRET`.
- Si `JWT_SECRET` tiene menos de 32 caracteres, el startup DEBE fallar con mensaje de error claro.
- La validación de longitud DEBE ocurrir en `apps/backend/src/env.ts` (schema Zod del env).

### 6.3. Escenarios — JWT

#### SC-JWT-01: token válido decodifica correctamente

**Given** un token generado por `fastify.jwt.sign({ sub: 'admin' }, { expiresIn: '24h' })`
**When** se decodifica con `fastify.jwt.verify(token)`
**Then** el payload contiene `{ sub: 'admin', iat: <número>, exp: <iat + 86400> }`

#### SC-JWT-02: secreto corto falla en startup

**Given** `JWT_SECRET = "short"` (menos de 32 caracteres)
**When** el servidor intenta arrancar
**Then** el proceso termina con error antes de aceptar conexiones

---

## 7. Cookie — atributos y variantes por entorno

### 7.1. Tabla de atributos

| Atributo | `NODE_ENV=production` | `NODE_ENV=development` | `NODE_ENV=test` |
|----------|-----------------------|------------------------|-----------------|
| `httpOnly` | `true` | `true` | `true` |
| `Secure` | `true` | `false` | `false` |
| `SameSite` | `Strict` | `Lax` | `Lax` |
| `Path` | `/` | `/` | `/` |
| `Max-Age` (login) | `86400` | `86400` | `86400` |
| `Max-Age` (logout) | `0` | `0` | `0` |

### 7.2. Justificación de `Secure` condicional

En `NODE_ENV=development` el frontend corre en `localhost:5173` y el backend en `localhost:3000`. El protocolo es HTTP (no HTTPS). Si `Secure=true` se aplica en HTTP, el browser descarta silenciosamente la cookie y ningún request posterior incluirá el token. Por eso `Secure` se activa únicamente en producción, donde Render sirve sobre HTTPS.

Esta es una **desviación intencional** del PRD (que requiere `Secure` sin calificadores de entorno). Está documentada en la propuesta §3.4 y NO debe ser marcada como bug por el verificador.

### 7.3. Escenarios — Cookie

#### SC-COOKIE-01: cookie de login en producción

**Given** `NODE_ENV = "production"`
**And** el login es exitoso
**When** se lee el header `Set-Cookie` de la respuesta
**Then** la cookie tiene `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, `Max-Age=86400`

#### SC-COOKIE-02: cookie de login en desarrollo

**Given** `NODE_ENV = "development"`
**And** el login es exitoso
**When** se lee el header `Set-Cookie` de la respuesta
**Then** la cookie tiene `HttpOnly`, NO tiene `Secure`, `SameSite=Lax`, `Path=/`

#### SC-COOKIE-03: cookie limpiada en logout

**Given** `NODE_ENV = "production"`
**When** se envía `POST /api/auth/logout`
**Then** el header `Set-Cookie` contiene la cookie con `Max-Age=0`

---

## 8. Escenarios NEGATIVOS (del PRD)

Esta sección agrupa los casos de error explícitamente requeridos por el PRD acceptance criteria. Son **obligatorios** para que US-003 se considere completa.

### NEGATIVE-01: password incorrecto → 401 sin revelar existencia de usuario

**Given** el body es `{ "password": "wrongpassword" }`
**When** se envía `POST /api/auth/login`
**Then** la respuesta es exactamente `401 { "error": "Unauthorized" }`
**And** el body de respuesta NO contiene los campos: `"user"`, `"hint"`, `"message"` con contenido informativo
**And** el tiempo de respuesta DEBE ser similar al de un login exitoso (bcrypt.compare se ejecuta igualmente — no early-exit)

### NEGATIVE-02: cookie ausente → 401

**Given** el cliente no envía cookie `token`
**When** se envía `GET /api/wallets` (o cualquier ruta protegida)
**Then** la respuesta es `401 { "error": "Unauthorized" }`

### NEGATIVE-03: token expirado → 401

**Given** el cliente envía cookie `token` con JWT expirado
**When** se envía cualquier request a una ruta protegida
**Then** la respuesta es `401 { "error": "Unauthorized" }` (no `403`, no `500`)

### NEGATIVE-04: token malformado → 401 (no 500)

**Given** el cliente envía cookie `token = "garbage"` (string arbitrario, no JWT)
**When** se envía cualquier request a una ruta protegida
**Then** la respuesta es `401 { "error": "Unauthorized" }`
**And** el servidor NO lanza una excepción no capturada (no `500`)

### NEGATIVE-05: body inválido en login → 400

**Given** el body de `POST /api/auth/login` es `{ "password": "" }` (string vacío)
**When** se envía la request
**Then** la respuesta es `400` con error de validación (Zod)
**And** NO se llama a `verifyPassword` (early rejection)

---

## 9. Contratos de error

Todos los errores de autenticación DEBEN usar el siguiente body:

```json
{ "error": "Unauthorized" }
```

Errores de validación (400) siguen el formato estándar de Fastify + Zod:

```json
{
  "error": "Bad Request",
  "message": "<descripción del error de validación>"
}
```

El servidor NUNCA DEBE exponer stack traces en respuestas de producción. Fastify `setErrorHandler` en `index.ts` es responsable de esto (ya existente desde US-001).

---

## Notas de implementación (NO son requisitos)

- Usar `@fastify/jwt` v9 y `@fastify/cookie` v11 (versiones fijadas en la propuesta §4).
- El orden de registro en `index.ts` importa: `env` → `bootstrapAuth()` → `@fastify/cookie` → `@fastify/jwt` → `authPlugin` → rutas públicas (`/api/auth`) → rutas protegidas.
- Para tests unitarios de `authPlugin`, usar `fastify.inject()` sin levantar un servidor HTTP real.
- En `NODE_ENV=test`, `APP_PASSWORD` y `JWT_SECRET` DEBEN poder ser configurados con valores de test cortos vía `.env.test`.
