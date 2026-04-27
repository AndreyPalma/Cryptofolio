# Setup Supabase para continuar US-002

> Guía temporal — borrar (o moverla a `docs/`) cuando US-002 esté archivado.

## Objetivo

Necesitamos **dos** bases de datos accesibles desde tu máquina:

| Variable de entorno | Para qué | Recomendación |
|---------------------|----------|---------------|
| `DATABASE_URL`      | Dev local (`npm run db:migrate`, `npm run db:seed`, `npm run dev` del backend) | Supabase Cloud (free tier) |
| `DATABASE_URL_TEST` | Suite e2e (`npm run test:e2e`) — se borra y migra antes de cada corrida | Postgres local en Docker |

> **Por qué dos**: el setup de e2e dropea y recrea el schema en cada corrida (`globalSetup` en `tests/e2e/setup.ts`). Si apuntás los tests al mismo Postgres que tu dev, **vas a perder los datos del seed cada vez que corras los tests**. Mantenelas separadas.

---

## Paso 1 — Crear el proyecto Supabase Cloud (DATABASE_URL)

1. Andá a https://supabase.com y entrá con GitHub (o email).
2. **New Project**:
   - **Name**: `cryptoledger-dev`
   - **Database password**: generá uno fuerte y guardalo en tu password manager. Lo vas a necesitar en el connection string.
   - **Region**: la más cercana (South America — São Paulo si estás en LATAM).
   - **Plan**: Free.
3. Esperá ~2 minutos a que el proyecto quede `Healthy` (luz verde).
4. En el dashboard del proyecto, sidebar → **Project Settings** (engranaje) → **Database** → sección **Connection string** → tab **URI**.
5. Copiá la URL. Va a verse así:
   ```
   postgresql://postgres.[ref]:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
   ```
   - Reemplazá `[YOUR-PASSWORD]` con la contraseña del paso 2.
   - **IMPORTANTE para `node-pg-migrate`**: usá el connection string del **Session pooler** (puerto `5432`, NO el `6543` del Transaction pooler). El Transaction pooler no soporta sesiones largas que las migraciones necesitan. En el dropdown de Supabase, elegí **Session mode**.

   Resultado típico (Session mode, puerto 5432):
   ```
   postgresql://postgres.[ref]:TU_PASSWORD@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require
   ```

6. Asegurate de que la URL termine con `?sslmode=require` (Supabase exige SSL). Nuestro pool ya lo detecta y configura.

---

## Paso 2 — Levantar Postgres local con Docker (DATABASE_URL_TEST)

Si no tenés Docker Desktop, instalalo: https://www.docker.com/products/docker-desktop/

```bash
docker run -d --name cryptoledger-test-pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=cryptoledger_test -p 5433:5432 postgres:16-alpine
```

Notas:
- Uso puerto `5433` para no chocar con un Postgres local que pudieras tener en `5432`.
- Si preferís otro puerto, cambialo y ajustá el `DATABASE_URL_TEST` abajo.

Verificá que arrancó:
```bash
docker ps --filter name=cryptoledger-test-pg
```

Para parar/arrancar después:
```bash
docker stop cryptoledger-test-pg
docker start cryptoledger-test-pg
```

---

## Paso 3 — Llenar el `.env`

En la raíz del repo, copiá `.env.example` a `.env` (si todavía no existe) y completá:

```env
# Supabase Cloud — Session mode, puerto 5432
DATABASE_URL=postgresql://postgres.turef:TU_PASSWORD@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require

# Postgres local (Docker) para tests
DATABASE_URL_TEST=postgresql://postgres:postgres@localhost:5433/cryptoledger_test
```

> **No commitees `.env`**. Está en `.gitignore`.

---

## Paso 4 — Aplicar la migración inicial sobre la DB de dev

```bash
npm run db:migrate
```

Salida esperada:
```
> @cryptoledger/db@0.1.0 migrate
> node-pg-migrate up --config-file .node-pg-migrate.json

> Migrating files:
> - 0001_initial_schema
### MIGRATION 0001_initial_schema (UP) ###
...
Migrations complete!
```

Verificá en Supabase: dashboard → **Table Editor** (sidebar) → vas a ver las 7 tablas (`users`, `wallets`, `tokens`, `positions`, `transactions`, `wallet_sync_cursors`, `api_credentials`) más la tabla `pgmigrations` que crea node-pg-migrate.

---

## Paso 5 — Sembrar fixtures de dev

```bash
npm run db:seed
```

Salida esperada:
```
seed: OK — 1 user, 3 wallets, 4 tokens, 1 position, 5 transactions
```

Si te da `seed: DB already seeded — run 'npm run db:migrate:down' to reset...`, es porque ya corriste el seed. Para reiniciar:

```bash
npm run db:migrate:down   # (correr varias veces hasta vaciar)
npm run db:migrate
npm run db:seed
```

> Ojo: `db:migrate:down -- -1` (con `-1`) revierte solo la última. Sin args, igual.

---

## Paso 6 — Confirmar que el Postgres de tests responde

```bash
# Desde la raíz, sin migrar — solo conexión
docker exec -it cryptoledger-test-pg psql -U postgres -d cryptoledger_test -c "SELECT 1"
```

Si devuelve `1` → estás listo para Batch 2.

---

## Paso 7 — Avisarme y continuamos US-002

Cuando tengas:
- ✅ `DATABASE_URL` apuntando a Supabase Cloud, migración aplicada, seed corrido
- ✅ `DATABASE_URL_TEST` apuntando al Postgres en Docker, vacío

Decime "dale, continuá US-002" y yo:

1. **Batch 2** — Escribo los 13 tests e2e (Phases 7-8 del `tasks.md`) y los corro contra `DATABASE_URL_TEST`.
2. **Phase 9** — Verifico typecheck, lint, test:engine, test:e2e, dist hygiene.
3. **sdd-verify** — Reviso que la implementación cumpla cada requirement del spec.
4. **sdd-archive** — Cierro el change y muevo a `openspec/changes/archive/`.

---

## Troubleshooting

| Síntoma | Causa probable | Fix |
|---------|----------------|-----|
| `password authentication failed` al migrar | Password mal copiado o caracteres especiales no escapados en la URL | Reescapá `@`, `#`, `:` en la password con encoding URL (`%40`, `%23`, `%3A`) |
| `connection terminated unexpectedly` desde Supabase | Estás usando el Transaction pooler (puerto 6543) | Cambiá a Session mode (puerto 5432) en el connection string |
| `relation "pgmigrations" does not exist` después de `migrate:down` | node-pg-migrate borra esa tabla en el primer down | Es normal — `db:migrate` la recrea |
| Docker dice puerto `5433` ocupado | Otro contenedor o servicio lo tiene | Cambiá el puerto host: `-p 5434:5432` y actualizá `DATABASE_URL_TEST` |
| `npm run db:migrate` corre en el workspace equivocado | Workspace no fue agregado al root `package.json` | Verificá que `"db"` esté en el array `workspaces` (ya debería estar) |

---

## Limpieza después de archivar US-002

```bash
docker stop cryptoledger-test-pg && docker rm cryptoledger-test-pg
# Borrá este archivo
rm openspec/changes/US-002-db-schema/SETUP-SUPABASE.md
```

El proyecto Supabase Cloud lo mantenés — lo vas a usar en US-003+ y en producción.
