# Spec — US-003 JWT Auth · Frontend

> **Change:** `US-003-jwt-auth`
> **Capability:** Autenticación JWT HS256 — frontend
> **Estado:** borrador
> **Última revisión:** 2026-04-27

---

## Índice

1. [Alcance de esta spec](#1-alcance)
2. [AuthContext](#2-authcontext)
3. [LoginPage](#3-loginpage)
4. [ProtectedRoute](#4-protectedroute)
5. [apiClient — wrapper de fetch](#5-apiclient)
6. [Router — configuración de rutas](#6-router)
7. [Escenarios NEGATIVOS](#7-escenarios-negativos)
8. [Contratos de error y UX](#8-contratos-de-error-y-ux)

---

## 1. Alcance

Esta spec cubre **únicamente** los componentes de frontend de US-003. Los componentes de backend se especifican en `specs/auth-backend/spec.md`.

Archivos afectados:

| Archivo | Acción |
|---------|--------|
| `apps/frontend/src/lib/auth-context.tsx` | NUEVO |
| `apps/frontend/src/lib/api-client.ts` | NUEVO |
| `apps/frontend/src/pages/LoginPage.tsx` | NUEVO |
| `apps/frontend/src/routes/router.tsx` | NUEVO |
| `apps/frontend/src/App.tsx` | MODIFICADO |
| `apps/frontend/tests/` | NUEVO (tests) |

Dependencias agregadas al `package.json` de frontend:

- `react-router-dom@^7`

---

## 2. AuthContext

### 2.1. Descripción

`AuthContext` es el React Context que provee estado de autenticación y la capacidad de redirigir al login a cualquier componente del árbol. Se implementa como un provider (`AuthProvider`) y un hook de consumo (`useAuth`).

### 2.2. API pública

```typescript
// apps/frontend/src/lib/auth-context.tsx

interface AuthContextValue {
  isAuthenticated: boolean
  login: () => void          // marca estado como autenticado (llamado internamente por LoginPage)
  logout: () => void         // llama POST /api/auth/logout y redirige a /login
  redirectToLogin: () => void // navega a /login sin llamar al backend (usado por apiClient)
}

export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element
export function useAuth(): AuthContextValue
```

### 2.3. Estado inicial

- `isAuthenticated` DEBE inicializarse en `false`.
- Al montar `AuthProvider`, NO se realiza ninguna llamada de red para verificar sesión existente. La sesión se considera válida únicamente después de un login exitoso dentro de la misma sesión de browser.
- Si el usuario recarga la página, `isAuthenticated` vuelve a `false`. La cookie httpOnly sigue siendo enviada por el browser en cada request; la validación real ocurre en el backend via `authPlugin`.

### 2.4. Comportamiento de `redirectToLogin`

`redirectToLogin()` DEBE:
1. Setear `isAuthenticated = false`.
2. Navegar a `/login` usando el router (`useNavigate` o equivalente de react-router-dom v7).
3. NO llamar al backend (no hace POST /api/auth/logout).

Se diferencia de `logout()` en que es el path de error (401 recibido) mientras que `logout()` es el path intencional.

### 2.5. Escenarios — AuthContext

#### SC-CTX-01: estado inicial

**Given** se monta `<AuthProvider>`
**When** un componente hijo consume `useAuth()`
**Then** `isAuthenticated` es `false`

#### SC-CTX-02: login marca autenticado

**Given** `isAuthenticated` es `false`
**When** se llama a `login()`
**Then** `isAuthenticated` pasa a `true`

#### SC-CTX-03: redirectToLogin redirige sin backend

**Given** `isAuthenticated` es `true`
**When** se llama a `redirectToLogin()`
**Then** `isAuthenticated` pasa a `false`
**And** el router navega a `/login`
**And** NO se realizó ninguna llamada de red a `POST /api/auth/logout`

#### SC-CTX-04: useAuth fuera de AuthProvider lanza error

**Given** un componente llama a `useAuth()` fuera del árbol de `<AuthProvider>`
**When** el componente renderiza
**Then** se lanza `Error("useAuth must be used within an AuthProvider")`

#### SC-CTX-05: logout llama al backend y redirige

**Given** `isAuthenticated` es `true`
**When** se llama a `logout()`
**Then** se envía `POST /api/auth/logout` con `credentials: 'include'`
**And** `isAuthenticated` pasa a `false`
**And** el router navega a `/login`

---

## 3. LoginPage

### 3.1. Descripción

`LoginPage` es la pantalla de autenticación. Renderiza un formulario con un único campo de password y un botón "Entrar". Al autenticar exitosamente, redirige a `/`.

### 3.2. Requisitos de renderizado

La página DEBE renderizar:
- Un campo `<input type="password">` con `name="password"` y `placeholder` descriptivo.
- Un botón de tipo `submit` con texto visible `"Entrar"`.
- Una zona de error que SOLO se muestra si existe un error (inicialmente oculta).

La página NO DEBE renderizar campos de usuario/email — es single-user.

### 3.3. Flujo de login exitoso

1. El usuario ingresa el password y hace click en "Entrar" (o presiona Enter).
2. `LoginPage` deshabilita el botón y/o muestra un estado de carga.
3. Llama a `POST /api/auth/login` via `apiClient` con `{ password }`.
4. Si la respuesta es `200 { ok: true }`:
   a. Llama a `auth.login()` para actualizar el contexto.
   b. Navega a `/` usando el router.

### 3.4. Flujo de login fallido (password incorrecto)

1. `apiClient` recibe `401`.
2. **EXCEPCIÓN al comportamiento normal de apiClient:** en `LoginPage`, un 401 del endpoint de login NO DEBE disparar `redirectToLogin()`. En cambio, DEBE mostrarse un mensaje de error al usuario.
3. La zona de error DEBE mostrar un mensaje genérico (p. ej. `"Password incorrecto"`). No revelar si el usuario existe.
4. El campo password DEBE limpiarse (o quedar enfocado) para reintentar.
5. El botón DEBE volver a habilitarse.

> **Nota de implementación:** para evitar que el interceptor de 401 en `apiClient` redirija durante el login, `LoginPage` DEBE manejar el 401 de forma directa (atrapando la excepción `UnauthorizedError`) antes de que `apiClient` pueda llamar a `redirectToLogin`. Ver §5.4 para la excepción del interceptor.

### 3.5. Escenarios — LoginPage

#### SC-LOGIN-PAGE-01: renderizado inicial

**Given** el usuario navega a `/login`
**When** `LoginPage` monta
**Then** se renderiza un input `type="password"`
**And** se renderiza un botón con texto "Entrar"
**And** NO se muestra ningún mensaje de error

#### SC-LOGIN-PAGE-02: submit con password correcto → redirect a /

**Given** el backend responde `200 { ok: true }` para `POST /api/auth/login`
**When** el usuario ingresa el password y hace submit
**Then** se llama a `POST /api/auth/login` con body `{ password: <valor ingresado> }`
**And** `auth.login()` es llamado
**And** el router navega a `/`

#### SC-LOGIN-PAGE-03: submit con password incorrecto → mensaje de error

**Given** el backend responde `401 { error: "Unauthorized" }` para `POST /api/auth/login`
**When** el usuario ingresa un password y hace submit
**Then** se muestra un mensaje de error visible en la pantalla
**And** el mensaje NO revela si el usuario existe ni la razón exacta del rechazo
**And** el botón "Entrar" queda habilitado
**And** `redirectToLogin()` NO es llamado

#### SC-LOGIN-PAGE-04: submit con campo vacío

**Given** el campo password está vacío
**When** el usuario hace click en "Entrar"
**Then** NO se realiza ninguna llamada de red
**And** se muestra un mensaje de validación local (p. ej. "Ingresá tu password")

#### SC-LOGIN-PAGE-05: estado de carga durante submit

**Given** el usuario hace submit con un password
**And** el backend no respondió aún
**When** la request está en vuelo
**Then** el botón "Entrar" está deshabilitado (o muestra indicador de carga)
**And** el campo password está deshabilitado

#### SC-LOGIN-PAGE-06: error de red → mensaje de error genérico

**Given** el backend no está disponible (network error)
**When** el usuario hace submit
**Then** se muestra un mensaje de error genérico (p. ej. `"Error de conexión. Intentá nuevamente."`)
**And** el botón "Entrar" queda habilitado

---

## 4. ProtectedRoute

### 4.1. Descripción

`ProtectedRoute` es un wrapper de ruta que verifica si el usuario está autenticado. Si no lo está, redirige a `/login`. Si lo está, renderiza el componente hijo.

```typescript
// apps/frontend/src/routes/router.tsx (o componente separado)

function ProtectedRoute({ children }: { children: React.ReactNode }): JSX.Element
```

### 4.2. Lógica

1. Consume `useAuth()`.
2. Si `isAuthenticated === false` → renderiza `<Navigate to="/login" replace />`.
3. Si `isAuthenticated === true` → renderiza `children`.

### 4.3. Consideración de recarga de página

Dado que `isAuthenticated` se inicializa en `false` (ver §2.3), una recarga de página redirigirá al usuario a `/login` aunque tenga una cookie válida. Para US-003 esto es **comportamiento aceptado**. Si en el futuro se quiere persistir sesión, se agregaría un endpoint `GET /api/auth/me` —fuera del scope de esta story.

### 4.4. Escenarios — ProtectedRoute

#### SC-PROT-01: usuario autenticado ve contenido protegido

**Given** `isAuthenticated = true`
**When** `ProtectedRoute` renderiza con un componente hijo
**Then** el componente hijo es renderizado

#### SC-PROT-02: usuario no autenticado redirigido a /login

**Given** `isAuthenticated = false`
**When** `ProtectedRoute` renderiza
**Then** el usuario es redirigido a `/login`
**And** el componente hijo NO es renderizado

#### SC-PROT-03: recarga de página redirige a /login

**Given** el usuario refresca el browser (o abre una nueva pestaña)
**When** navega directamente a una ruta protegida (p. ej. `/`)
**Then** es redirigido a `/login` (porque `isAuthenticated` arranca en `false`)

---

## 5. apiClient — wrapper de fetch

### 5.1. Descripción

`apiClient` es el wrapper sobre `fetch` que centraliza:
- El header `credentials: 'include'` (necesario para enviar la cookie httpOnly).
- El manejo automático de respuestas `401` → `redirectToLogin()`.
- El serializado de body como JSON.

### 5.2. API pública

```typescript
// apps/frontend/src/lib/api-client.ts

export class UnauthorizedError extends Error {}

export const apiClient = {
  get<T>(url: string, options?: RequestInit): Promise<T>
  post<T>(url: string, body: unknown, options?: RequestInit): Promise<T>
  // put, delete, patch — MAY agregarse en stories futuras
}
```

### 5.3. Comportamiento base

- Cada llamada DEBE incluir `credentials: 'include'` en las opciones de fetch.
- Cada llamada POST/PUT/PATCH DEBE setear `Content-Type: application/json` y serializar el body con `JSON.stringify`.
- Si la respuesta tiene status `2xx`, DEBE retornar el body parseado como JSON (o `undefined` si no hay body).
- Si la respuesta tiene status `401`, DEBE lanzar `UnauthorizedError` y llamar a `authContext.redirectToLogin()` —salvo la excepción del §5.4—.
- Si la respuesta tiene cualquier otro status de error (`4xx`, `5xx`), DEBE lanzar un error con el status code.

### 5.4. Excepción del interceptor para el endpoint de login

El endpoint `POST /api/auth/login` es la única ruta donde un `401` NO DEBE disparar `redirectToLogin()`. De lo contrario, se produciría un loop: el usuario intenta loguearse, el 401 del login dispara una redirección a `/login`, que ya es la pantalla actual.

**Mecánica sugerida:** `apiClient.post` acepta una opción `skipAuthRedirect?: boolean`. `LoginPage` llama con `skipAuthRedirect: true` y maneja el `UnauthorizedError` directamente.

Alternativa aceptable: que `LoginPage` llame directamente a `fetch` para el login, sin pasar por `apiClient`. En ese caso la excepción del interceptor no aplica porque `apiClient` no participa.

### 5.5. Escenarios — apiClient

#### SC-API-01: request exitosa incluye credentials

**Given** el browser tiene cookie `token` seteada
**When** se llama a `apiClient.get('/api/wallets')`
**Then** el fetch subyacente se envía con `credentials: 'include'`
**And** la cookie es incluida en el request

#### SC-API-02: respuesta 401 en ruta protegida dispara redirectToLogin

**Given** el mock de fetch retorna `401` para cualquier ruta que no sea el login
**When** se llama a `apiClient.get('/api/wallets')`
**Then** `redirectToLogin()` es llamado
**And** se lanza `UnauthorizedError`
**And** el componente que consumió `apiClient.get()` recibe el error (puede capturarlo o no)

#### SC-API-03: respuesta 200 retorna JSON parseado

**Given** el mock de fetch retorna `200` con body `{ "data": [1, 2, 3] }`
**When** se llama a `apiClient.get('/api/wallets')`
**Then** el retorno es `{ data: [1, 2, 3] }`

#### SC-API-04: error de red lanza Error sin redirigir

**Given** el mock de fetch lanza un `TypeError` (network error)
**When** se llama a `apiClient.get('/api/wallets')`
**Then** se lanza un error (no `UnauthorizedError`)
**And** `redirectToLogin()` NO es llamado

#### SC-API-05: 401 en login con skipAuthRedirect no redirige

**Given** el mock de fetch retorna `401` para `POST /api/auth/login`
**When** se llama a `apiClient.post('/api/auth/login', { password: 'wrong' }, { skipAuthRedirect: true })`
**Then** se lanza `UnauthorizedError`
**And** `redirectToLogin()` NO es llamado

#### SC-API-06: POST serializa body como JSON

**Given** se llama a `apiClient.post('/api/auth/login', { password: 'abc' })`
**When** se realiza el fetch
**Then** el `Content-Type` del request es `application/json`
**And** el body del request es `'{"password":"abc"}'`

---

## 6. Router — configuración de rutas

### 6.1. Rutas declaradas

| Path | Componente | Acceso |
|------|-----------|--------|
| `/login` | `LoginPage` | Público (siempre accesible) |
| `/` | `DashboardPage` (placeholder US-004) | Protegido via `ProtectedRoute` |

En US-003, el dashboard puede ser un componente placeholder (p. ej. `<div>Dashboard</div>`) ya que US-004 no está implementado. Lo importante es que la ruta `/` exista y esté protegida.

### 6.2. Estructura del router

```tsx
// apps/frontend/src/routes/router.tsx

const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <DashboardPage />
      </ProtectedRoute>
    ),
  },
])
```

### 6.3. Integración en App.tsx

```tsx
// apps/frontend/src/App.tsx

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  )
}
```

`AuthProvider` DEBE ser el ancestro de `RouterProvider` para que `redirectToLogin()` pueda usar `useNavigate()` internamente.

### 6.4. Escenarios — Router

#### SC-ROUTER-01: /login es accesible sin autenticación

**Given** `isAuthenticated = false`
**When** el usuario navega a `/login`
**Then** `LoginPage` renderiza (no hay redirect)

#### SC-ROUTER-02: / redirige a /login si no autenticado

**Given** `isAuthenticated = false`
**When** el usuario navega a `/`
**Then** es redirigido a `/login`

#### SC-ROUTER-03: / muestra dashboard si autenticado

**Given** `isAuthenticated = true`
**When** el usuario navega a `/`
**Then** `DashboardPage` (o placeholder) renderiza

#### SC-ROUTER-04: login exitoso redirige a /

**Given** el usuario está en `/login`
**And** ingresa el password correcto
**When** el backend responde `200`
**Then** el router navega a `/`

---

## 7. Escenarios NEGATIVOS (del PRD)

Esta sección agrupa los casos de error explícitamente requeridos por el PRD acceptance criteria. Son **obligatorios** para que US-003 se considere completa.

### NEGATIVE-FE-01: password incorrecto en login → mensaje de error visible

**Given** el usuario está en `/login`
**And** ingresa un password incorrecto
**When** el backend responde `401`
**Then** `LoginPage` muestra un mensaje de error visible (sin revelar que el usuario no existe)
**And** el usuario permanece en `/login`
**And** el campo password está disponible para reintentar

### NEGATIVE-FE-02: API call con 401 desde componente protegido → redirect automático a /login

**Given** `isAuthenticated = true` (usuario logueado)
**And** el usuario está en una ruta protegida
**When** `apiClient` recibe `401` de cualquier API call
**Then** `redirectToLogin()` es llamado automáticamente
**And** el router navega a `/login`
**And** `isAuthenticated` pasa a `false`

### NEGATIVE-FE-03: campo vacío en login → no se llama al backend

**Given** el campo password está vacío o en blanco
**When** el usuario hace submit del formulario
**Then** NO se realiza ninguna llamada a `POST /api/auth/login`
**And** se muestra un mensaje de validación local

### NEGATIVE-FE-04: error de red en login → mensaje genérico (no pantalla rota)

**Given** el servidor no está disponible
**When** el usuario intenta loguearse
**Then** `LoginPage` muestra un mensaje de error genérico
**And** la app NO muestra un stack trace ni crashea
**And** el usuario puede reintentar

### NEGATIVE-FE-05: ruta protegida después de logout → redirect a /login

**Given** el usuario cerró sesión (llamó a `logout()`)
**And** intenta navegar a `/`
**When** `ProtectedRoute` evalúa `isAuthenticated`
**Then** `isAuthenticated = false` → redirige a `/login`

---

## 8. Contratos de error y UX

### 8.1. Mensajes de error en LoginPage

| Situación | Mensaje sugerido |
|-----------|-----------------|
| Password incorrecto (401) | `"Password incorrecto"` |
| Campo vacío | `"Ingresá tu password"` |
| Error de red | `"Error de conexión. Intentá nuevamente."` |
| Error inesperado (5xx) | `"Ocurrió un error. Intentá nuevamente."` |

Los mensajes DEBEN ser genéricos: no revelan si el usuario existe, ni el motivo exacto del rechazo del backend.

### 8.2. Accesibilidad mínima

- El campo password DEBE tener `aria-label` o `<label>` asociado.
- El mensaje de error DEBE renderizarse en un elemento con `role="alert"` para lectores de pantalla.
- El botón "Entrar" deshabilitado DEBE tener `aria-disabled="true"`.

### 8.3. Persistencia de sesión (fuera de scope US-003)

La sesión NO se persiste entre recargas de página en esta story. Esta es una limitación conocida y aceptada. La cookie httpOnly sigue siendo válida en el backend, pero el frontend no tiene forma de saber si existe sin hacer una llamada al servidor. Un endpoint `GET /api/auth/me` que retorne `isAuthenticated: true` si la cookie es válida resolvería esto —queda para story de mejora de UX posterior.

---

## Notas de testing (Strict TDD activo)

- Tests de `AuthContext` con `renderHook` de `@testing-library/react`.
- Tests de `LoginPage` con `render` + `userEvent` (formulario completo) y MSW para mockear `POST /api/auth/login`.
- Tests de `apiClient` con `vi.spyOn(global, 'fetch')` o MSW.
- Tests de `ProtectedRoute` con memory router de react-router-dom.
- Cada escenario de esta spec corresponde a UN test (o un `it` dentro de un `describe`).
