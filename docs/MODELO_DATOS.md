# Modelo de datos

Iteración sobre el `schema.sql` y el `CONTEXTO_PROYECTO.md` originales. Se conserva todo su diseño (catálogos sin ENUMs, historial por periodos, separación persona/usuario, tres niveles de acceso, RLS) y se resuelven sus pendientes más los requisitos nuevos: metas anuales que cierran en agosto, métricas de completitud, informes sí/no para quien no es PR ni PA y datos listos para exportar.

## Conceptos clave

**Año de servicio.** Va de septiembre a agosto y se nombra por el año en que cierra: el año de servicio 2026 es sep-2025 a ago-2026. `service_year_of(fecha)` lo calcula.

**Metas (`role_hour_goals`).** Una meta por cargo con vigencia desde un año de servicio; sigue aplicando hasta que se registre otra más reciente. Puede ser anual (PR, se prorratea: meta/12 por cada mes con el cargo) o mensual (PAI y PA, meta fija por mes con el cargo). Solo los cargos con `requires_hours_report` pueden tener meta.

**PA y PAI (migración 1400).** PA es un cargo por meses concretos (por ejemplo, solo septiembre): `catalog_roles.requires_end_date` lo marca y un trigger no deja guardar un periodo de PA sin fecha de fin. PAI (PA indefinido) sigue vigente hasta que se cierre, con meta de 30 h por mes (360 h el año completo); como cualquier cargo con horas abierto, se proyecta hasta el cierre del año de servicio, así que su avance (meta del año, meta a la fecha, faltan, estado) se mide igual que el de PR. PR, PAI y PA no pueden solaparse entre sí. Desde la migración 1500, `catalog_roles.max_months` limita PA a 3 meses calendario por periodo: en la ficha se da con "Dar PA" (mes inicial y 1, 2 o 3 meses); al terminar se desmarca solo y sus meses quedan en el historial y los informes.

**Informe mensual (`monthly_reports`).** Reemplaza `service_hours`. Un registro por persona y mes para todos:

| Quién | `participated` | `hours` | `bible_studies` |
|---|---|---|---|
| PR / PAI / PA ese mes | obligatorio | obligatorio (0 si no hubo) | 0 por omisión |
| Cualquier otra persona (PNB, PB, otros cargos) | obligatorio (sí/no) | vacío | 0 por omisión |

`bible_studies` son los cursos bíblicos del mes (0 a 99, migración 1100); si es mayor que 0, la persona participó.

El cargo de cada mes se deduce del historial (`person_roles`), así que alguien que fue PA en marzo y PR desde abril queda bien medido en cada tramo.

**Altas, bajas y traslados (`person_movements`).** Cada persona tiene un historial de altas (nuevo ingreso, traslado desde otra congregación, reingreso) y bajas (traslado a otra congregación, fallecimiento, dejó de participar, sacado, otra), con fecha y congregación de origen o destino (obligatoria en los traslados). Los tipos están en `catalog_movement_types`. Reglas:

- Altas y bajas se alternan; no hay dos en la misma fecha ni fechas futuras.
- La fecha de una baja es el primer día en que ya no pertenece. Una baja que es el último movimiento cierra el cargo y el grupo vigentes el día anterior.
- `persons.is_active` es derivado: activo si su último movimiento es un alta o si no tiene ninguno. No se cambia a mano.
- `view_membership_periods` da los periodos de pertenencia. Un mes cuenta para métricas e informes si la persona fue miembro al menos un día de ese mes; los meses con informe se muestran siempre.
- Borrado lógico: no se puede borrar a una persona con informes, cargos, grupos o altas/bajas, y sus FKs ya no borran en cascada. Solo se borra a alguien capturado por error sin historial.

**Grupos y reagrupaciones.** El grupo de cada mes sale de `person_group_history`, y el cumplimiento de metas es por persona, no por grupo. Por eso cambiar a alguien de grupo o disolver un grupo no altera nada de los meses anteriores. Un grupo que desaparece se desactiva (no se borra) y conserva su historial. Cambiar el nombre de un grupo sí cambia cómo aparece en los informes pasados: es solo para corregir.

**Cargos sin horas: A, SM, PB, PNB.** Nombramientos largos con historial por periodos. Regla del bautismo (trigger `check_baptism_rule`): al registrar PB, un PNB vigente se cierra el día anterior; nadie puede tener un PNB que termine en o después de su primer PB.

**Mes cerrado.** Cualquier mes anterior al mes en curso. Las métricas "a la fecha" y la completitud se calculan sobre meses cerrados.

## Tablas

| Tabla | Cambio respecto al original |
|---|---|
| `catalog_groups`, `catalog_contact_types`, `catalog_date_types`, `catalog_system_roles` | Igual (códigos en mayúsculas forzados). |
| `catalog_roles` | + `sort_order`. Trigger que impide marcar un cargo "con horas" si eso genera solapamientos. |
| `persons`, `person_contacts`, `person_dates` | Igual; un solo contacto principal por tipo. |
| `person_group_history` | Exclusion constraint: ningún par de periodos se solapa (antes solo se impedían dos abiertos). |
| `person_roles` | Exclusion constraint para el mismo cargo; el trigger PR/PA ahora compara rangos completos, no solo periodos abiertos, y bloquea por persona para evitar carreras. |
| `role_hour_goals` | **Nueva.** Metas por cargo y año de servicio. |
| `monthly_reports` | **Nueva** (reemplaza `service_hours`). `participated` + `hours` opcional, tope 744 h/mes, columnas generadas `period` y `service_year`. |
| `app_users` | `person_id` ahora opcional (cuentas técnicas), + `display_name`, `is_active`, `all_groups` (1200). Nunca puede quedar sin un SUPERADMIN activo. |
| `app_user_permissions`, `app_user_groups`, `permission_templates` | **Nuevas** (migración 1200). Permisos por área, grupos visibles y plantillas. |
| `catalog_movement_types`, `person_movements` | **Nuevas** (migración 0800). Altas, bajas y traslados. |
| `audit_log` | **Nueva.** Bitácora automática de cambios en personas, cargos, grupos, informes, metas y cuentas. |

## Vistas y funciones para el dashboard y los informes

Todas las vistas usan `security_invoker`, así que respetan el RLS (en el original, las vistas de Supabase se saltaban el RLS y quedaban expuestas a `anon`).

| Objeto | Uso |
|---|---|
| `view_current_pr`, `view_current_pa`, `view_current_roles`, `view_current_group` | Estado actual. |
| `view_persons_overview` | Persona + grupo + cargos actuales (listado principal). |
| `view_role_history` | Historial de cargos legible. |
| `view_person_movements`, `view_membership_periods`, `was_member_during()` | Altas y bajas legibles; periodos de pertenencia que usan las métricas. |
| `view_goal_compliance` | **Cumplimiento** por persona, año de servicio y cargo: meta, meta a la fecha, horas, % de meta, horas que faltan, horas por mes necesarias, informes faltantes y estado (`CUMPLIDA`, `AL DIA`, `ATRASADO`, `NO CUMPLIDA`, `SIN META`). |
| `view_service_year_hours`, `view_annual_hours` | Totales por año de servicio y calendario. |
| `fn_report_matrix(año)` | Matriz persona × mes: informó, participó, horas, cargo y grupo de ese mes. Base de la exportación a Excel. |
| `fn_service_year_summary(año)` | **Completitud** por persona: meses esperados, informados, con participación y porcentajes. Es la métrica de quien no es PR, PAI ni PA. |
| `fn_monthly_summary(año)` | Resumen de la organización por mes y grupo. |
| `fn_reassign_groups(fecha, cambios, grupos_a_desactivar)` | Reagrupación (migración 1000): cambia de grupo a varias personas desde una fecha en una transacción y desactiva los grupos que desaparecen. Los periodos anteriores se cierran el día antes, así que los meses pasados conservan su grupo. Un grupo con personas no se puede desactivar. |
| `fn_import_persons(filas)` | Alta masiva desde Excel (migración 0900): persona, alta, grupo, cargos y contactos de varias filas en una sola transacción; si una fila falla no se guarda ninguna y el error indica la fila. |

Desde el cliente: `supabase.from('view_goal_compliance').select().eq('service_year', 2026)` y `supabase.rpc('fn_service_year_summary', { p_service_year: 2026 })`.

## Seguridad

Permisos por área y alcance por grupo (migración 1200; antes eran tres niveles SUPERADMIN / ADMIN / READER):

- `SUPERADMIN`: todo, incluida la bitácora. Además puede gestionar cuentas quien tenga el área `USUARIOS` (migración 1300), sin ver datos de personas, sin tocar cuentas SUPERADMIN ni la propia y sin poder crear SUPERADMIN.
- `USER`: lo que diga `app_user_permissions` por área (`PERSONAS`, `MOVIMIENTOS`, `INFORMES`, `METRICAS`, `CONFIGURACION`, `USUARIOS`), sin fila = sin acceso, `can_edit` = edición. `METRICAS` es solo lectura.
- Alcance: `app_users.all_groups`, o solo las personas cuyo grupo más reciente está en `app_user_groups`. Aplica a personas, cargos, grupos, contactos, fechas, altas/bajas e informes, y por tanto a todas las vistas, métricas y exportes (son `security_invoker`).
- Leer cualquier área de datos deja ver nombres, grupos, cargos, altas/bajas e informes de las personas del alcance; contactos y fechas solo con `PERSONAS`. Catálogos: los lee cualquier cuenta y los edita `CONFIGURACION`.
- Un encargado solo asigna grupos suyos y puede dar el primer grupo a una persona nueva; quien crea a una persona registra su alta inicial aunque no tenga `MOVIMIENTOS`. Importar y reagrupar exigen editar `PERSONAS` con todos los grupos.
- `permission_templates`: plantillas para crear cuentas (se copian, no quedan ligadas). `fn_save_app_user` y `fn_set_user_area` guardan permisos; `fn_my_access` los devuelve a la app.
- Las cuentas ADMIN pasaron a USER con edición en todo y las READER a USER con lectura en todo.

Además: cuentas desactivables, `anon` sin acceso a tablas ni vistas, funciones con `search_path` fijo.

## Decisiones tomadas por defecto (confirmar con Javier)

1. Metas: PR 600 h al año (por confirmar), PAI 30 h por mes (360 h al año), PA 30 h por mes, desde el año de servicio 2026. Se cambian editando `role_hour_goals`.
2. Si alguien tiene el cargo solo parte de un mes, ese mes cuenta completo para la meta. Si cambió de PA a PR dentro del mes, cuenta el cargo que empezó más tarde.
3. Un cargo vigente se proyecta hasta agosto para calcular la meta del año.
4. La completitud y las metas consideran solo los meses en que la persona era miembro (según sus altas y bajas), más los meses en que sí informó.
5. Las horas de meses sin cargo PR/PAI/PA se guardan pero no suman a ninguna meta.
