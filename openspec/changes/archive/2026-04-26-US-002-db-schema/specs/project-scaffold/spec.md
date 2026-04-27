# Delta for project-scaffold

## MODIFIED Requirements

### Requirement: DB placeholders

`npm run db:migrate` MUST aplicar la migración inicial `0001_initial_schema.sql` (provista por `database-schema`) usando node-pg-migrate, creando el schema híbrido on-chain/CEX completo. `npm run db:seed` MUST insertar los fixtures determinísticos del seed real (1 user + 3 wallets + tokens + transacciones de prueba). Los placeholders introducidos por US-001 quedan reemplazados por la implementación real.

(Previously: ambos scripts existían como placeholders que solo imprimían `"placeholder: US-002 will implement"` y terminaban exit 0, sin tocar la DB.)

#### Scenario: Migrate aplica schema sobre DB limpia

- GIVEN scripts declarados en `db/package.json` y expuestos en la raíz, con `DATABASE_URL` apuntando a una DB Postgres vacía
- WHEN se ejecuta `npm run db:migrate`
- THEN exit code MUST ser 0
- AND la DB MUST contener las tablas, ENUMs, índices y constraints definidos en el spec `database-schema`
- AND stdout MUST NOT contener la cadena `"placeholder"` (evidencia de que ya no es el stub de US-001)

#### Scenario: Seed inserta fixtures sobre schema migrado

- GIVEN schema migrado en DB limpia
- WHEN se ejecuta `npm run db:seed`
- THEN exit code MUST ser 0
- AND `SELECT COUNT(*) FROM wallets` MUST devolver `3` (1 ETH + 1 BSC + 1 CEX_BINANCE)
- AND stdout MUST NOT contener la cadena `"placeholder"`
