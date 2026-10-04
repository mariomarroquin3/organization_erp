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
-- Seguridad
-- ---------------------------------------------------------------------
\echo '== Seguridad =='
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'super@demo'),
  ('10000000-0000-0000-0000-000000000002', 'admin@demo'),
  ('10000000-0000-0000-0000-000000000003', 'reader@demo');
insert into app_users (id, system_role_id, display_name)
select u.id, csr.id, u.email
from (values ('10000000-0000-0000-0000-000000000001'::uuid, 'SUPERADMIN', 'super'),
             ('10000000-0000-0000-0000-000000000002'::uuid, 'ADMIN', 'admin'),
             ('10000000-0000-0000-0000-000000000003'::uuid, 'READER', 'reader')) u(id, code, email)
join catalog_system_roles csr on csr.code = u.code;

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
rollback;

-- READER: lee todo, no escribe, ve solo su cuenta
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
select pg_temp.check((select count(*) = 4 from persons), 'READER lee personas');
select pg_temp.check((select count(*) = 3 from view_goal_compliance where service_year = 2026), 'READER lee cumplimiento (vista respeta RLS)');
select pg_temp.check((select count(*) = 1 from app_users), 'READER solo ve su cuenta');
select pg_temp.expect_error($$insert into persons (first_name, last_name) values ('X', 'Y')$$, '%row-level security%');
select pg_temp.check((select count(*) = 0 from audit_log), 'READER no ve la bitácora');
rollback;

-- ADMIN: escribe datos, ve cuentas, no las modifica
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
insert into persons (first_name, last_name) values ('Nueva', 'Persona');
select pg_temp.check((select count(*) = 3 from app_users), 'ADMIN ve todas las cuentas');
update app_users set display_name = 'hack' where id = '10000000-0000-0000-0000-000000000003';
select pg_temp.check((select display_name from app_users where id = '10000000-0000-0000-0000-000000000003') = 'reader',
                     'ADMIN no puede modificar cuentas');
select pg_temp.check((select count(*) > 0 from audit_log where table_name = 'persons'
                        and changed_by = '10000000-0000-0000-0000-000000000002'),
                     'La bitácora registra quién creó la persona');
rollback;

-- SUPERADMIN: gestiona cuentas, pero no puede dejar el sistema sin SUPERADMIN
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
update app_users set system_role_id = (select id from catalog_system_roles where code = 'ADMIN')
 where id = '10000000-0000-0000-0000-000000000003';
select pg_temp.check((select count(*) = 2 from app_users a join catalog_system_roles c on c.id = a.system_role_id where c.code = 'ADMIN'),
                     'SUPERADMIN asciende a READER a ADMIN');
rollback;

select pg_temp.expect_error($$
  do $d$ begin
    set local role authenticated;
    set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
    update app_users set system_role_id = (select id from catalog_system_roles where code = 'READER')
     where id = '10000000-0000-0000-0000-000000000001';
    set constraints all immediate;
  end $d$
$$, '%al menos un SUPERADMIN%');

-- Cuenta desactivada pierde el acceso
begin;
update app_users set is_active = false where id = '10000000-0000-0000-0000-000000000003';
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
select pg_temp.check((select count(*) = 0 from persons), 'cuenta desactivada no ve datos');
rollback;

\echo '== Todas las pruebas pasaron =='
