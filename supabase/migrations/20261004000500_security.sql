-- =====================================================================
-- 0500 · SEGURIDAD: helpers, RLS, privilegios
-- =====================================================================
-- SUPERADMIN: lee/escribe datos; único que crea cuentas y cambia niveles.
-- ADMIN:      lee/escribe datos; ve las cuentas, no las modifica.
-- READER:     solo lectura de datos; solo ve su propia cuenta.
-- Una cuenta con is_active = false no tiene acceso.
-- =====================================================================

create or replace function public.auth_system_role_code()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select csr.code
  from app_users au
  join catalog_system_roles csr on csr.id = au.system_role_id
  where au.id = auth.uid() and au.is_active;
$$;

create or replace function public.is_superadmin()
returns boolean language sql security definer stable set search_path = public
as $$ select coalesce(auth_system_role_code() = 'SUPERADMIN', false); $$;

create or replace function public.is_admin_or_above()
returns boolean language sql security definer stable set search_path = public
as $$ select coalesce(auth_system_role_code() in ('SUPERADMIN', 'ADMIN'), false); $$;

create or replace function public.is_app_user()
returns boolean language sql security definer stable set search_path = public
as $$ select auth_system_role_code() is not null; $$;

-- Nunca dejar el sistema sin un SUPERADMIN activo (evita autobloqueo)
create or replace function public.ensure_superadmin_remains()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from app_users au
    join catalog_system_roles csr on csr.id = au.system_role_id
    where csr.code = 'SUPERADMIN' and au.is_active
  ) and exists (select 1 from app_users) then
    raise exception 'Debe quedar al menos un SUPERADMIN activo.';
  end if;
  return null;
end;
$$;

create constraint trigger trg_ensure_superadmin_remains
after update or delete on public.app_users
deferrable initially deferred
for each row execute function public.ensure_superadmin_remains();

-- ---------------------------------------------------------------------
-- RLS en todas las tablas
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'catalog_groups','catalog_roles','catalog_contact_types','catalog_date_types',
    'catalog_system_roles','persons','person_contacts','person_dates',
    'person_group_history','person_roles','role_hour_goals','monthly_reports','app_users'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- Datos de la organización y catálogos: lectura para cualquier
  -- usuario de la app; escritura para ADMIN o SUPERADMIN.
  foreach t in array array[
    'catalog_groups','catalog_roles','catalog_contact_types','catalog_date_types',
    'persons','person_contacts','person_dates','person_group_history',
    'person_roles','role_hour_goals','monthly_reports'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_app_user())', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_admin_or_above())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_admin_or_above()) with check (public.is_admin_or_above())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_admin_or_above())', t || '_delete', t);
  end loop;
end $$;

-- Niveles del sistema: solo SUPERADMIN los modifica
create policy catalog_system_roles_select on public.catalog_system_roles
  for select to authenticated using (public.is_app_user());
create policy catalog_system_roles_write on public.catalog_system_roles
  for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());

-- Cuentas
create policy app_users_select on public.app_users
  for select to authenticated using (id = auth.uid() or public.is_admin_or_above());
create policy app_users_insert on public.app_users
  for insert to authenticated with check (public.is_superadmin());
create policy app_users_update on public.app_users
  for update to authenticated using (public.is_superadmin()) with check (public.is_superadmin());
create policy app_users_delete on public.app_users
  for delete to authenticated using (public.is_superadmin());

-- ---------------------------------------------------------------------
-- Privilegios. Supabase concede por defecto todo a anon en public;
-- se revoca explícitamente para que anon no vea ni tablas ni vistas.
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  catalog_groups, catalog_roles, catalog_contact_types, catalog_date_types,
  catalog_system_roles, persons, person_contacts, person_dates,
  person_group_history, person_roles, role_hour_goals, monthly_reports, app_users
to authenticated;

grant select on
  view_current_group, view_current_roles, view_current_pr, view_current_pa,
  view_persons_overview, view_role_history, view_annual_hours,
  view_service_year_hours, view_hours_role_months, view_goal_compliance
to authenticated;

grant execute on function
  fn_report_matrix(int), fn_service_year_summary(int), fn_monthly_summary(int),
  service_year_of(int, int), service_year_of(date), service_year_bounds(int),
  monthly_goal_for(uuid, int), hours_role_in_month(uuid, date), reporting_cutoff(),
  auth_system_role_code(), is_superadmin(), is_admin_or_above(), is_app_user()
to authenticated;
