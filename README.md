# ERP de gestión de personal (Javier)

Aplicación web (Next.js) sobre una base de datos en Supabase (PostgreSQL) para gestionar personas, grupos, cargos (PR, PA y otros), informes mensuales, metas anuales de horas por año de servicio (sep-ago), métricas de cumplimiento y completitud, e informes en Excel y PDF.

El diseño y sus decisiones están en [`docs/MODELO_DATOS.md`](docs/MODELO_DATOS.md).

## Estructura

```
web/            aplicación (Next.js + supabase-js), ver "Aplicación web"
supabase/
  migrations/   esquema en orden (núcleo, metas, informes, vistas, seguridad, bitácora, catálogos, altas/bajas, importación, reagrupaciones y bautismo)
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

## Aplicación web (`web/`)

Pantallas:

| Pantalla | Qué hace |
|---|---|
| Panel | Personas activas, informes del último mes cerrado, completitud promedio, avance de metas PR/PA y quién va atrasado. |
| Informes del mes | Hoja de captura mensual: Sí / No / Sin informe para todos y horas para quien era PR o PA ese mes (obligatorias); cursos bíblicos para todos (vacío = 0). Guarda solo lo que cambió. |
| Personas | Listado con filtros; ficha con metas del año, informes mes a mes, altas/bajas/traslados, cargos, grupos, contactos y fechas. |
| Reagrupar | En Personas: cambia de grupo a varias personas desde una fecha y desactiva los grupos que desaparecen; el historial de meses pasados no cambia. |
| Importar desde Excel | En Personas: plantilla descargable (con listas de grupos, cargos y motivos de alta), vista previa con los errores de cada fila y guardado en una sola transacción (`fn_import_persons`). Omite a quien ya existe con el mismo nombre. |
| Altas y bajas | Altas, bajas y traslados del año de servicio con totales; exportable a Excel o PDF. |
| Métricas | Cumplimiento de metas PR/PA, completitud por persona (con filtro "solo quienes no son PR ni PA") y resumen mensual por grupo. |
| Informe anual | Cierre del año de servicio (1 sep – 31 ago): estado del año, informes recibidos, horas, resultado de cada PR y PA, totales por grupo; descarga en Excel o PDF con el detalle mes a mes y las altas/bajas. |
| Exportar | Cada informe en Excel o PDF, o todos juntos en un solo archivo. |
| Configuración | Metas de horas por cargo y año, grupos, cargos y cuentas de acceso. |

Los permisos los aplica la base (RLS): un Lector puede consultar y exportar; Administrador y Super administrador editan; solo el Super administrador cambia cuentas. La app oculta los controles de edición a quien no puede usarlos.

Código:

```
web/
  app/              páginas, acciones de servidor y /api/export
  lib/services/     capa de servicios: personas, informes, métricas, catálogos, sesión
  lib/export/       tablas de informes -> Excel (exceljs) y PDF (jsPDF); annual.ts = informe anual
  lib/import/       plantilla, lectura y validación de la importación de personas
  tests/            pruebas unitarias (vitest)
```

### Correr en local

```bash
cd web
cp .env.example .env.local   # URL y anon key del proyecto (o de `supabase start`)
npm install
npm run dev                  # http://localhost:3000
```

Pruebas: `npm test` (unitarias), `npm run typecheck` y `npm run build`.

### Desplegar

1. Aplica las migraciones en Supabase y crea el primer SUPERADMIN (sección anterior).
2. En Supabase, Authentication > Providers: deja Email habilitado y desactiva "Allow new users to sign up" para que solo entren las cuentas que crees.
3. Importa el repositorio en Vercel con **Root Directory = `web`** y define `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`.

`SUPABASE_SERVICE_ROLE_KEY` (Supabase > Project Settings > API > `service_role`) permite crear usuarios y cambiar contraseñas desde la pantalla **Usuarios**. Es secreta: va sin `NEXT_PUBLIC_` para que nunca llegue al navegador y la app solo la usa para Supabase Auth, nunca para leer datos. Sin ella, la pantalla igual gestiona permisos, pero el usuario hay que crearlo a mano en Authentication > Users (luego se le da acceso con su correo desde la app).

### Usuarios y permisos

Solo el super administrador ve **Usuarios**. Cada cuenta tiene un interruptor por área (Personas, Altas y bajas, Informes del mes, Métricas, Configuración) con lectura o edición, y un alcance: todas las personas o solo las de ciertos grupos. Las plantillas (Administrador, Lector, Capturista de informes, Encargado de grupo, Solo personas) llenan los permisos al crear un usuario. Todo se aplica en la base con RLS (migración 1200), no solo en la interfaz.
