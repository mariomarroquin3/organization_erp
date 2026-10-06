-- Pruebas del esquema. Requiere migraciones + supabase/seed.sql.
-- Cada bloque lanza excepción si falla. Se ejecuta con psql -v ON_ERROR_STOP=1.
\set QUIET on

create or replace function pg_temp.expect_error(p_sql text, p_like text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike p_like then
      raise notice 'OK (error esperado): %', left(sqlerrm, 90);
      return;
    end if;
    raise exception 'Error distinto al esperado. Esperado %, obtenido: %', p_like, sqlerrm;
  end;
  raise exception 'Se esperaba error (%) y la sentencia pasó: %', p_like, p_sql;
end $$;

create or replace function pg_temp.check(p_ok boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FALLA: %', p_msg; end if;
  raise notice 'OK: %', p_msg;
end $$;

-- ---------------------------------------------------------------------
-- Integridad
-- ---------------------------------------------------------------------
\echo '== Integridad =='
begin;
-- Ana es PR vigente: no puede ser PA al mismo tiempo
select pg_temp.expect_error($$
  insert into person_roles (person_id, role_id, start_date)
  select '00000000-0000-0000-0000-000000000001', id, '2026-03-01' from catalog_roles where code = 'PA'
$$, '%cargo PR en un periodo que se solapa%');

-- Beto fue PR feb-ago 2026: un PA cerrado dentro de ese rango también choca
select pg_temp.expect_error($$
  insert into person_roles (person_id, role_id, start_date, end_date)
  select '00000000-0000-0000-0000-000000000002', id, '2026-04-01', '2026-04-30' from catalog_roles where code = 'PA'
$$, '%se solapa%');

-- PB + PR simultáneos sí está permitido (Beto ya lo tiene en el seed)
select pg_temp.check(
  (select count(*) from view_role_history where first_name = 'Beto' and is_current) = 1,
  'Beto conserva PB vigente mientras su PR ya terminó');

-- Mismo cargo con periodos cerrados solapados
select pg_temp.expect_error($$
  insert into person_roles (person_id, role_id, start_date, end_date)
  select '00000000-0000-0000-0000-000000000003', id, '2025-10-01', '2025-12-31' from catalog_roles where code = 'PB'
$$, '%ex_pr_same_role_no_overlap%');

-- Grupos solapados
select pg_temp.expect_error($$
  insert into person_group_history (person_id, group_id, start_date, end_date)
  values ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', '2026-02-15', '2026-03-15')
$$, '%ex_pgh_no_overlap%');

-- Informe sin horas en un mes con PR
select pg_temp.expect_error($$
  insert into monthly_reports (person_id, year, month, participated, hours)
  values ('00000000-0000-0000-0000-000000000001', 2026, 9, true, null)
$$, '%era PR: el informe debe incluir horas%');

-- Horas > 0 implica participó
select pg_temp.expect_error($$
  insert into monthly_reports (person_id, year, month, participated, hours)
  values ('00000000-0000-0000-0000-000000000004', 2026, 9, false, 5)
$$, '%chk_hours_implies_participation%');

-- Tope mensual
select pg_temp.expect_error($$
  insert into monthly_reports (person_id, year, month, participated, hours)
  values ('00000000-0000-0000-0000-000000000004', 2026, 10, true, 800)
$$, '%monthly_reports_hours_check%');

-- Meta solo para cargos con horas
select pg_temp.expect_error($$
  insert into role_hour_goals (role_id, effective_from_sy, annual_hours)
  select id, 2026, 100 from catalog_roles where code = 'PB'
$$, '%Solo los cargos con informe de horas%');

-- No se puede volver "de horas" a PB si Beto tuvo PB y PA/PR a la vez
select pg_temp.expect_error($$
  update catalog_roles set requires_hours_report = true where code = 'PB'
$$, '%periodos solapados%');
rollback;

-- ---------------------------------------------------------------------
-- Año de servicio y métricas
-- ---------------------------------------------------------------------
\echo '== Métricas =='
select pg_temp.check(service_year_of(2025, 9) = 2026 and service_year_of(2026, 8) = 2026
                     and service_year_of(date '2026-09-01') = 2027, 'año de servicio sep-ago');

select pg_temp.check(
  (select goal_hours = 600 and hours_done = 600 and status = 'CUMPLIDA' and months_missing = 0
     from view_goal_compliance where first_name = 'Ana' and service_year = 2026),
  'Ana PR 2026: 600/600 CUMPLIDA');

select pg_temp.check(
  (select goal_hours = 150 and hours_done = 200 and status = 'CUMPLIDA'
     from view_goal_compliance where first_name = 'Beto' and service_year = 2026 and role_code = 'PA'),
  'Beto PA 2026: meta 5x30=150, 200 h, CUMPLIDA');

select pg_temp.check(
  (select goal_hours = 350 and hours_done = 280 and hours_remaining = 70 and status = 'NO CUMPLIDA'
     from view_goal_compliance where first_name = 'Beto' and service_year = 2026 and role_code = 'PR'),
  'Beto PR 2026: meta prorrateada 7x50=350, 280 h, NO CUMPLIDA');

select pg_temp.check(
  (select months_in_role = 12 and goal_hours = 600 and months_closed >= 1
          and months_missing = months_closed and status in ('ATRASADO', 'NO CUMPLIDA')
     from view_goal_compliance where first_name = 'Ana' and service_year = 2027),
  'Ana PR 2027: meta proyectada 600, sin informes cerrados, ATRASADO');

select pg_temp.check(
  (select months_expected = 12 and months_reported = 10 and pct_reported = 83.3 and total_hours = 0
     from fn_service_year_summary(2026) where first_name = 'Carla'),
  'Carla (solo PB) 2026: 10 de 12 informes, sin horas');

select pg_temp.check(
  (select months_reported = 6 and months_participated = 3
     from fn_service_year_summary(2026) where first_name = 'Diego'),
  'Diego 2026: 6 informes, 3 con participación');

select pg_temp.check(
  (select count(distinct group_name) = 2 from fn_report_matrix(2026) where first_name = 'Carla'),
  'La matriz usa el grupo que la persona tenía cada mes');

select pg_temp.check(
  (select persons = 3 and reports_received = 3 and hours_role_persons = 2 and total_hours = 90
     from fn_monthly_summary(2026) where period = '2025-09-01' and group_name = 'Grupo 1'),
  'Resumen sep-2025, Grupo 1: 3 personas, 3 informes, 90 h');

select pg_temp.check((select count(*) = 1 from view_current_pr), 'Solo Ana es PR actual');

-- ---------------------------------------------------------------------
-- Altas, bajas y traslados
-- ---------------------------------------------------------------------
\echo '== Altas y bajas =='
create or replace function pg_temp.mov(p_person text, p_code text, p_date date, p_cong text default null)
returns void language sql as $$
  insert into person_movements (person_id, movement_type_id, movement_date, congregation)
  select p_person::uuid, id, p_date, p_cong from catalog_movement_types where code = p_code
$$;

begin;
select pg_temp.expect_error($$select pg_temp.mov('00000000-0000-0000-0000-000000000004', 'TRASLADO_SALIDA', '2026-03-01')$$,
  '%indica la congregación de destino%');
select pg_temp.expect_error($$select pg_temp.mov('00000000-0000-0000-0000-000000000004', 'OTRA_BAJA', current_date + 1)$$,
  '%no puede ser futura%');
select pg_temp.expect_error($$update persons set is_active = false where first_name = 'Diego'$$,
  '%registrando una baja o un alta%');
select pg_temp.expect_error($$insert into persons (first_name, last_name, is_active) values ('X', 'Y', false)$$,
  '%se crea activa%');
rollback;

begin;
-- Diego (sin cargo) se traslada en marzo: deja de contar desde ese mes
select pg_temp.mov('00000000-0000-0000-0000-000000000004', 'TRASLADO_SALIDA', '2026-03-01', 'Congregación Norte');
select pg_temp.check((select not is_active from persons where first_name = 'Diego'), 'la baja marca inactivo');
select pg_temp.check(
  (select end_date = '2026-02-28' from person_group_history
    where person_id = '00000000-0000-0000-0000-000000000004'),
  'la baja cierra el grupo el día anterior');
select pg_temp.check(
  (select months_expected = 6 and months_reported = 6 and pct_reported = 100
     from fn_service_year_summary(2026) where first_name = 'Diego'),
  'Diego 2026: solo cuentan sep-feb (6 de 6)');
select pg_temp.check((select count(*) = 0 from fn_report_matrix(2027) where first_name = 'Diego'),
  'Diego no aparece en el año siguiente a su baja');
select pg_temp.check(
  (select persons = 1 from fn_monthly_summary(2026) where period = '2026-03-01' and group_name = 'Grupo 2'),
  'resumen mar-2026, Grupo 2: ya no cuenta a Diego');
select pg_temp.expect_error($$select pg_temp.mov('00000000-0000-0000-0000-000000000004', 'FALLECIMIENTO', '2026-04-01')$$,
  '%deben alternarse%');

-- Reingreso: vuelve a estar activo y tiene dos periodos
select pg_temp.mov('00000000-0000-0000-0000-000000000004', 'REINGRESO', '2026-06-15');
select pg_temp.check((select is_active from persons where first_name = 'Diego'), 'el reingreso reactiva');
select pg_temp.check(
  (select count(*) = 2 from view_membership_periods where person_id = '00000000-0000-0000-0000-000000000004'),
  'dos periodos de pertenencia');
select pg_temp.check(
  not was_member_during('00000000-0000-0000-0000-000000000004', '2026-03-01', '2026-05-31')
  and was_member_during('00000000-0000-0000-0000-000000000004', '2026-06-01', '2026-06-30'),
  'fuera de mar-may, dentro en junio (alta a mitad de mes)');
select pg_temp.mov('00000000-0000-0000-0000-000000000004', 'NUEVO_INGRESO', '2024-01-01');
select pg_temp.expect_error($$delete from person_movements
  where person_id = '00000000-0000-0000-0000-000000000004' and movement_date = '2026-03-01'$$,
  '%deben alternarse%');
rollback;

begin;
-- Ana (PR) se da de baja en marzo: su meta 2026 se recorta a sep-feb
select pg_temp.mov('00000000-0000-0000-0000-000000000001', 'TRASLADO_SALIDA', '2026-03-01', 'Congregación Sur');
select pg_temp.check(
  (select end_date = '2026-02-28' from person_roles pr join catalog_roles cr on cr.id = pr.role_id
    where pr.person_id = '00000000-0000-0000-0000-000000000001' and cr.code = 'PR'),
  'la baja cierra el cargo PR el día anterior');
select pg_temp.check(
  (select months_in_role = 6 and goal_hours = 300 from view_goal_compliance
    where first_name = 'Ana' and service_year = 2026),
  'Ana 2026: meta prorrateada a 6 meses');
select pg_temp.check((select count(*) = 0 from view_goal_compliance where first_name = 'Ana' and service_year = 2027),
  'Ana no tiene meta 2027');
select pg_temp.check((select count(*) = 0 from view_current_pr), 'ya no hay PR vigente');
select pg_temp.check(
  (select last_movement_type = 'Traslado a otra congregación' from view_persons_overview where first_name = 'Ana'),
  'la ficha resumida muestra la última alta/baja');

-- Borrar la baja (corrección) la reactiva
delete from person_movements where person_id = '00000000-0000-0000-0000-000000000001';
select pg_temp.check((select is_active from persons where first_name = 'Ana'), 'borrar la baja reactiva');
rollback;

begin;
-- Persona nueva con alta por traslado: no cuenta antes de su alta
insert into persons (id, first_name, last_name) values ('00000000-0000-0000-0000-000000000009', 'Eva', 'Gil');
select pg_temp.mov('00000000-0000-0000-0000-000000000009', 'TRASLADO_ENTRADA', '2026-05-10', 'Congregación Este');
select pg_temp.check(
  (select months_expected = 4 from fn_service_year_summary(2026) where first_name = 'Eva'),
  'Eva (alta en mayo) 2026: cuenta may-ago');
select pg_temp.expect_error($$select pg_temp.mov('00000000-0000-0000-0000-000000000009', 'OTRA_BAJA', '2026-05-10')$$,
  '%uq_person_movements_date%');

-- Borrado físico
select pg_temp.expect_error($$delete from persons where first_name = 'Ana'$$, '%con historial%');
select pg_temp.expect_error($$delete from persons where first_name = 'Eva'$$, '%con historial%');
insert into persons (id, first_name, last_name) values ('00000000-0000-0000-0000-000000000008', 'Por', 'Error');
delete from persons where id = '00000000-0000-0000-0000-000000000008';
select pg_temp.check(not exists (select 1 from persons where id = '00000000-0000-0000-0000-000000000008'),
  'se puede borrar a alguien capturado por error, sin historial');
select pg_temp.check(
  (select confdeltype = 'r' from pg_constraint where conname = 'monthly_reports_person_id_fkey'),
  'los informes ya no se borran en cascada');
rollback;

-- ---------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------
\echo '== Seguridad =='
-- Cuentas de prueba (como postgres, sin RLS):
--   01 super  SUPERADMIN
--   02 admin  USER, edita todas las áreas, todos los grupos
--   03 reader USER, lee todas las áreas
--   04 g2     USER, plantilla "Encargado de grupo" limitada al Grupo 2 (Carla y Diego)
--   05 inf    USER, solo INFORMES (edición)
--   06 movs   USER, solo MOVIMIENTOS (edición)
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'super@demo'),
  ('10000000-0000-0000-0000-000000000002', 'admin@demo'),
  ('10000000-0000-0000-0000-000000000003', 'reader@demo'),
  ('10000000-0000-0000-0000-000000000004', 'g2@demo'),
  ('10000000-0000-0000-0000-000000000005', 'inf@demo'),
  ('10000000-0000-0000-0000-000000000006', 'movs@demo');
insert into app_users (id, system_role_id, display_name, all_groups)
select u.id, csr.id, u.email, u.all_groups
from (values ('10000000-0000-0000-0000-000000000001'::uuid, 'SUPERADMIN', 'super', true),
             ('10000000-0000-0000-0000-000000000002'::uuid, 'USER', 'admin', true),
             ('10000000-0000-0000-0000-000000000003'::uuid, 'USER', 'reader', true),
             ('10000000-0000-0000-0000-000000000004'::uuid, 'USER', 'g2', false),
             ('10000000-0000-0000-0000-000000000005'::uuid, 'USER', 'inf', true),
             ('10000000-0000-0000-0000-000000000006'::uuid, 'USER', 'movs', true)) u(id, code, email, all_groups)
join catalog_system_roles csr on csr.code = u.code;
insert into app_user_permissions (user_id, area, can_edit)
select '10000000-0000-0000-0000-000000000002'::uuid, a, a <> 'METRICAS' from unnest(app_areas()) a
union all
select '10000000-0000-0000-0000-000000000003', a, false from unnest(app_areas()) a
union all
select '10000000-0000-0000-0000-000000000004', e.key, e.value = 'edit'
from permission_templates t, jsonb_each_text(t.areas) e where t.name = 'Encargado de grupo'
union all
select '10000000-0000-0000-0000-000000000005', 'INFORMES', true
union all
select '10000000-0000-0000-0000-000000000006', 'MOVIMIENTOS', true;
insert into app_user_groups (user_id, group_id) values
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a2');
insert into person_contacts (person_id, contact_type_id, value, is_primary)
select '00000000-0000-0000-0000-000000000004', id, '555-0004', true from catalog_contact_types where code = 'PHONE';

select pg_temp.check((select count(*) = 0 from catalog_system_roles where code in ('ADMIN', 'READER')),
                     'ya no existen los niveles ADMIN y READER');

-- anon no ve nada (ni tablas ni vistas)
begin;
set local role anon;
select pg_temp.expect_error('select * from persons', '%permission denied%');
select pg_temp.expect_error('select * from view_goal_compliance', '%permission denied%');
rollback;

-- authenticated sin fila en app_users: no ve filas
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-0000000000ff';
select pg_temp.check((select count(*) = 0 from persons), 'usuario sin cuenta en app_users no ve personas');
select pg_temp.check(fn_my_access() is null, 'sin cuenta: fn_my_access es NULL');
rollback;

-- Lector: lee todo, no escribe, ve solo su cuenta
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
select pg_temp.check((select count(*) = 4 from persons), 'lector lee personas');
select pg_temp.check((select count(*) = 1 from person_contacts), 'lector con PERSONAS lee contactos');
select pg_temp.check((select count(*) = 3 from view_goal_compliance where service_year = 2026), 'lector lee cumplimiento (vista respeta RLS)');
select pg_temp.check((select count(*) = 1 from app_users), 'lector solo ve su cuenta');
select pg_temp.check((select count(*) = 5 from app_user_permissions), 'lector ve sus propios permisos');
select pg_temp.check((select count(*) = 0 from permission_templates), 'lector no ve plantillas');
select pg_temp.expect_error($$insert into persons (first_name, last_name) values ('X', 'Y')$$, '%row-level security%');
select pg_temp.check((select count(*) = 0 from audit_log), 'lector no ve la bitácora');
select pg_temp.check((select count(*) = 8 from catalog_movement_types), 'lector lee tipos de alta/baja (incluye Sacado)');
select pg_temp.expect_error($$select pg_temp.mov('00000000-0000-0000-0000-000000000004', 'OTRA_BAJA', '2026-03-01')$$, '%row-level security%');
select pg_temp.expect_error($$insert into catalog_groups (name) values ('Nuevo')$$, '%row-level security%');
select pg_temp.check((fn_my_access()->'areas') = '{"PERSONAS":"read","MOVIMIENTOS":"read","INFORMES":"read","METRICAS":"read","CONFIGURACION":"read"}'::jsonb,
                     'fn_my_access del lector: lectura en las cinco áreas');
rollback;

-- Administrador (USER con edición en todo): escribe datos, no gestiona cuentas
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
insert into persons (first_name, last_name) values ('Nueva', 'Persona');
insert into catalog_groups (name) values ('Grupo 3');
select pg_temp.check((select count(*) = 1 from app_users), 'administrador solo ve su cuenta');
update app_users set display_name = 'hack' where id = '10000000-0000-0000-0000-000000000003';
select pg_temp.expect_error($$insert into app_user_permissions (user_id, area, can_edit)
  values ('10000000-0000-0000-0000-000000000003', 'PERSONAS', true)$$, '%row-level security%');
select pg_temp.expect_error($$select fn_set_user_area('10000000-0000-0000-0000-000000000003', 'PERSONAS', 'edit')$$, '%Solo un super administrador%');
reset role;
select pg_temp.check((select display_name from app_users where id = '10000000-0000-0000-0000-000000000003') = 'reader',
                     'administrador no puede modificar cuentas');
select pg_temp.check((select count(*) > 0 from audit_log where table_name = 'persons'
                        and changed_by = '10000000-0000-0000-0000-000000000002'),
                     'La bitácora registra quién creó la persona');
rollback;

-- Super administrador: gestiona cuentas, permisos y plantillas
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) = 6 from app_users), 'super ve todas las cuentas');
select pg_temp.check((select count(*) = 5 from permission_templates), 'super ve las plantillas');
select fn_save_app_user('10000000-0000-0000-0000-000000000003', 'Lectora', false, true, false,
                        array['00000000-0000-0000-0000-0000000000a1']::uuid[], '{"PERSONAS":"edit","METRICAS":"read"}');
select pg_temp.check((select count(*) = 2 from app_user_permissions where user_id = '10000000-0000-0000-0000-000000000003'),
                     'fn_save_app_user reemplaza los permisos');
select pg_temp.check((select not all_groups and display_name = 'Lectora' from app_users where id = '10000000-0000-0000-0000-000000000003'),
                     'fn_save_app_user guarda nombre y alcance');
select pg_temp.expect_error($$select fn_save_app_user('10000000-0000-0000-0000-000000000003', 'x', false, true, false, '{}', '{}')$$,
                            '%al menos un grupo%');
select pg_temp.expect_error($$select fn_save_app_user('10000000-0000-0000-0000-000000000003', 'x', false, true, true, '{}', '{"METRICAS":"edit"}')$$,
                            '%Permisos inválidos%');
select fn_set_user_area('10000000-0000-0000-0000-000000000004', 'INFORMES', null);
select fn_set_user_area('10000000-0000-0000-0000-000000000004', 'CONFIGURACION', 'read');
select pg_temp.check((select string_agg(area || ':' || can_edit, ',' order by area) from app_user_permissions
                       where user_id = '10000000-0000-0000-0000-000000000004')
                     = 'CONFIGURACION:false,METRICAS:false,MOVIMIENTOS:false,PERSONAS:true',
                     'el interruptor quita INFORMES y da lectura de CONFIGURACION');
select pg_temp.expect_error($$select fn_set_user_area('10000000-0000-0000-0000-000000000001', 'INFORMES', null)$$, '%acceso a todo%');
select pg_temp.expect_error($$insert into permission_templates (name, areas) values ('Mala', '{"METRICAS":"edit"}')$$, '%permission_templates_areas_check%');
insert into permission_templates (name, areas, group_scoped) values ('Auxiliar', '{"INFORMES":"edit"}', true);
rollback;

select pg_temp.expect_error($$
  do $d$ begin
    set local role authenticated;
    set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
    perform fn_save_app_user('10000000-0000-0000-0000-000000000001', 'super', false, true, true, '{}', '{}');
    set constraints all immediate;
  end $d$
$$, '%al menos un SUPERADMIN%');

-- Cuenta desactivada pierde el acceso
begin;
update app_users set is_active = false where id = '10000000-0000-0000-0000-000000000003';
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
select pg_temp.check((select count(*) = 0 from persons), 'cuenta desactivada no ve datos');
select pg_temp.check(fn_my_access() is null, 'cuenta desactivada: fn_my_access es NULL');
rollback;

-- Encargado del Grupo 2: solo ve y edita a Carla y Diego
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';
select pg_temp.check((select string_agg(first_name, ',' order by first_name) from persons) = 'Carla,Diego', 'encargado ve solo su grupo');
select pg_temp.check((select count(distinct person_id) = 2 from fn_report_matrix(2026)), 'la matriz del informe solo trae su grupo');
select pg_temp.check((select count(*) = 0 from view_goal_compliance where first_name in ('Ana', 'Beto')), 'no ve el cumplimiento de otro grupo');
select pg_temp.check((select count(*) = 1 from person_contacts), 've contactos de su grupo');
select pg_temp.check((select (fn_my_access()->'groups'->0->>'name') = 'Grupo 2' and not (fn_my_access()->>'all_groups')::boolean),
                     'fn_my_access trae su grupo');
insert into monthly_reports (person_id, year, month, participated)
values ('00000000-0000-0000-0000-000000000004', 2026, 9, true);
select pg_temp.expect_error($$insert into monthly_reports (person_id, year, month, participated, hours)
  values ('00000000-0000-0000-0000-000000000001', 2026, 9, true, 10)$$, '%row-level security%');
update persons set notes = 'hack' where id = '00000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($$insert into person_group_history (person_id, group_id, start_date)
  values ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', '2026-09-01')$$, '%row-level security%');
select pg_temp.expect_error($$select fn_import_persons('[{"row": 2, "first_name": "X", "last_name": "Y"}]')$$, '%No tienes permiso%');
select pg_temp.expect_error($$select fn_reassign_groups('2026-09-01', '[]')$$, '%No tienes permiso%');
-- Alta de una persona nueva en su grupo, con su alta inicial
insert into persons (id, first_name, last_name) values ('00000000-0000-0000-0000-0000000000e1', 'Eva', 'Nueva');
select pg_temp.expect_error($$insert into person_group_history (person_id, group_id, start_date)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '2026-09-01')$$, '%row-level security%');
insert into person_group_history (person_id, group_id, start_date)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2', '2026-09-01');
select pg_temp.mov('00000000-0000-0000-0000-0000000000e1', 'NUEVO_INGRESO', '2026-09-01');
select pg_temp.check((select count(*) = 3 from persons), 've a la persona que acaba de crear');
-- Sin MOVIMIENTOS (edición) no registra bajas
select pg_temp.expect_error($$select pg_temp.mov('00000000-0000-0000-0000-0000000000e1', 'OTRA_BAJA', '2026-09-20')$$, '%row-level security%');
reset role;
select pg_temp.check((select notes is distinct from 'hack' from persons where id = '00000000-0000-0000-0000-000000000001'),
                     'no puede editar a alguien de otro grupo');
rollback;

-- Solo INFORMES: captura informes, no ve contactos ni edita personas
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000005';
select pg_temp.check((select count(*) = 4 from persons), 'capturista ve los nombres de todos');
select pg_temp.check((select count(*) = 0 from person_contacts), 'sin PERSONAS no ve contactos');
insert into monthly_reports (person_id, year, month, participated)
values ('00000000-0000-0000-0000-000000000004', 2026, 9, true);
select pg_temp.expect_error($$insert into persons (first_name, last_name) values ('X', 'Y')$$, '%row-level security%');
select pg_temp.check((fn_my_access()->'areas') = '{"INFORMES":"edit"}'::jsonb, 'fn_my_access: solo INFORMES');
rollback;

-- Solo MOVIMIENTOS: la baja cierra cargo y grupo aunque no edite PERSONAS
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000006';
select pg_temp.mov('00000000-0000-0000-0000-000000000001', 'OTRA_BAJA', '2026-09-15');
reset role;
select pg_temp.check((select not is_active from persons where id = '00000000-0000-0000-0000-000000000001'), 'la baja deja inactiva a Ana');
select pg_temp.check((select count(*) = 0 from person_roles where person_id = '00000000-0000-0000-0000-000000000001' and end_date is null),
                     'la baja cerró sus cargos');
rollback;

-- ---------------------------------------------------------------------
-- Importación de personas (0900)
-- ---------------------------------------------------------------------
\echo '== Importación =='
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select pg_temp.check(fn_import_persons(jsonb_build_array(
  jsonb_build_object('row', 2, 'first_name', ' Imp ', 'last_name', 'Uno', 'birth_date', '1990-05-01',
    'group_id', '00000000-0000-0000-0000-0000000000a1', 'group_start', '2026-09-01',
    'role_ids', (select jsonb_agg(id) from catalog_roles where code in ('PR', 'PB')), 'roles_start', '2026-09-01',
    'contacts', jsonb_build_array(jsonb_build_object('contact_type_id', (select id from catalog_contact_types where code = 'PHONE'), 'value', '555'))),
  jsonb_build_object('row', 3, 'first_name', 'Imp', 'last_name', 'Dos',
    'alta', jsonb_build_object('movement_type_id', (select id from catalog_movement_types where code = 'NUEVO_INGRESO'),
                               'movement_date', '2026-09-15'))
)) = 2, 'ADMIN importa dos personas');
select pg_temp.check((select first_name = 'Imp' and birth_date = '1990-05-01' from persons where last_name = 'Uno'), 'nombre recortado y fecha de nacimiento');
select pg_temp.check((select count(*) = 2 from view_current_roles r join persons p on p.id = r.person_id where p.last_name = 'Uno'), 'cargos PR y PB vigentes');
select pg_temp.check((select group_id = '00000000-0000-0000-0000-0000000000a1' from view_current_group g join persons p on p.id = g.person_id where p.last_name = 'Uno'), 'grupo asignado');
select pg_temp.check((select count(*) = 1 from person_contacts c join persons p on p.id = c.person_id where p.last_name = 'Uno' and c.is_primary), 'teléfono principal');
select pg_temp.check((select count(*) = 1 from view_person_movements where last_name = 'Dos' and direction = 'ALTA'), 'alta registrada');
rollback;

-- Una fila mala no deja nada a medias y el error dice cuál
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select pg_temp.expect_error($$
  select fn_import_persons(jsonb_build_array(
    jsonb_build_object('row', 2, 'first_name', 'Bien', 'last_name', 'Uno'),
    jsonb_build_object('row', 7, 'first_name', 'Mal', 'last_name', 'Dos',
      'role_ids', (select jsonb_agg(id) from catalog_roles where code in ('PR', 'PA')), 'roles_start', '2026-09-01')))
$$, 'Fila 7:%');
select pg_temp.check((select count(*) = 0 from persons where first_name in ('Bien', 'Mal')), 'importación fallida no guarda ninguna fila');
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
select pg_temp.expect_error($$ select fn_import_persons('[{"row": 2, "first_name": "X", "last_name": "Y"}]') $$,
                            '%No tienes permiso%');
rollback;

-- ---------------------------------------------------------------------
-- Cursos bíblicos
-- ---------------------------------------------------------------------
\echo '== Cursos bíblicos =='
select pg_temp.check(
  (select sum(bible_studies) = 25 from fn_report_matrix(2026)),
  'la matriz trae los cursos (Ana 2 x 12 + Carla 1)');
select pg_temp.check(
  (select sum(bible_studies) = 3 from fn_monthly_summary(2026) where period = '2025-09-01'),
  'el resumen mensual suma los cursos de septiembre');
select pg_temp.check(
  (select count(*) = 0 from fn_report_matrix(2026) where not has_report and bible_studies <> 0),
  'sin informe, cursos = 0');
begin;
-- Diego no participó en septiembre: no puede tener cursos
select pg_temp.expect_error($$
  update monthly_reports set bible_studies = 1
  where person_id = '00000000-0000-0000-0000-000000000004' and year = 2025 and month = 9
$$, '%chk_studies_imply_participation%');
select pg_temp.expect_error($$
  update monthly_reports set bible_studies = -1
  where person_id = '00000000-0000-0000-0000-000000000001' and year = 2025 and month = 9
$$, '%chk_monthly_reports_bible_studies%');
-- Informe nuevo sin el dato: queda en 0
insert into monthly_reports (person_id, year, month, participated)
values ('00000000-0000-0000-0000-000000000004', 2026, 9, true);
select pg_temp.check(
  (select bible_studies = 0 from monthly_reports
    where person_id = '00000000-0000-0000-0000-000000000004' and year = 2026 and month = 9),
  'cursos vale 0 por omisión');
rollback;

-- Baja por Sacado: deja de ser miembro y no se le esperan informes
begin;
insert into person_movements (person_id, movement_type_id, movement_date)
select '00000000-0000-0000-0000-000000000004', id, '2026-03-10'
from catalog_movement_types where code = 'SACADO';
select pg_temp.check(
  (select not is_active from persons where id = '00000000-0000-0000-0000-000000000004'),
  'Sacado es una baja: la persona queda inactiva');
rollback;

\echo '== Todas las pruebas pasaron =='
