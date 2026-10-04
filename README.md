# ERP de gestión de personal (Javier)

Base de datos en Supabase (PostgreSQL) para gestionar personas, grupos, cargos (PR, PA y otros), informes mensuales, metas anuales de horas por año de servicio (sep-ago) y métricas de cumplimiento y completitud.

El diseño y sus decisiones están en [`docs/MODELO_DATOS.md`](docs/MODELO_DATOS.md).

## Estructura

```
supabase/
  migrations/   esquema en orden (núcleo, metas, informes, vistas, seguridad, bitácora, catálogos)
  seed.sql      datos de demostración, solo para desarrollo local
tests/
  00_supabase_stub.sql   simula auth/roles de Supabase en un Postgres normal
  10_schema_tests.sql    pruebas de integridad, métricas y RLS
  run.sh                 aplica todo en una base nueva y corre las pruebas
```

## Aplicar en Supabase

```bash
npm i -g supabase            # o brew install supabase/tap/supabase
supabase login
supabase link --project-ref <ref-del-proyecto>
supabase db push             # aplica supabase/migrations
```

Después crea el primer SUPERADMIN (en el SQL editor de Supabase, que corre como `postgres`):

```sql
-- 1) Crea el usuario en Authentication > Users y copia su UUID
insert into app_users (id, system_role_id, display_name)
select '<uuid-del-usuario>', id, 'Javier'
from catalog_system_roles where code = 'SUPERADMIN';
```

## Desarrollo local

Con Supabase CLI: `supabase start` y `supabase db reset` (aplica migraciones y `seed.sql`).

Solo las pruebas, con cualquier Postgres 15+:

```bash
PGHOST=localhost PGUSER=postgres bash tests/run.sh
```
