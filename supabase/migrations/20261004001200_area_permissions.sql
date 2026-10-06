-- =====================================================================
-- 1200 · PERMISOS POR ÁREA Y ALCANCE POR GRUPO
-- =====================================================================
-- Reemplaza los niveles ADMIN / READER por permisos por cuenta:
--
--   * SUPERADMIN: todo, incluido gestionar cuentas y plantillas.
--   * USER: lo que digan sus permisos por área (app_user_permissions):
--       PERSONAS       fichas: datos, contactos, fechas, cargos, grupos
--       MOVIMIENTOS    altas y bajas
--       INFORMES       captura de los informes del mes
--       METRICAS       panel, métricas, informe anual y exportes (solo lectura)
--       CONFIGURACION  grupos, cargos, metas y tipos
--     Sin fila = sin acceso al área; can_edit = false lectura; true edición.
--   * Alcance: app_users.all_groups = true ve a todas las personas; si es
--     false solo a las de sus grupos (app_user_groups). El grupo de una
--     persona es el de su periodo más reciente (el vigente o, si ya no
--     tiene, el último), así que el historial de alguien dado de baja
--     sigue visible para el encargado de su último grupo.
--
-- Todo se aplica en la base (RLS); la interfaz solo oculta lo que no
-- se puede usar. Leer cualquier área de datos deja ver nombres, grupos,
-- cargos, altas/bajas e informes de las personas del alcance (cada
-- pantalla los necesita); contactos y fechas personales solo con PERSONAS.
--
-- Las cuentas ADMIN pasan a USER con edición en todas las áreas y las
-- READER a USER con lectura en todas: nadie gana ni pierde acceso.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------
insert into public.catalog_system_roles (code, name)
values ('USER', 'Usuario con permisos por área')
on conflict (code) do nothing;

create or replace function public.app_areas()
returns text[] language sql immutable
as $$ select array['PERSONAS', 'MOVIMIENTOS', 'INFORMES', 'METRICAS', 'CONFIGURACION'] $$;

-- {"PERSONAS": "edit", "INFORMES": "read", ...}. METRICAS solo se lee.
create or replace function public.is_valid_area_map(p jsonb)
returns boolean language sql immutable
as $$
  select jsonb_typeof(p) = 'object' and not exists (
    select 1 from jsonb_each_text(p) e
    where e.key <> all (public.app_areas())
       or e.value not in ('read', 'edit')
       or (e.key = 'METRICAS' and e.value = 'edit')
  );
$$;

alter table public.app_users add column all_groups boolean not null default true;

create table public.app_user_permissions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.app_users(id) on delete cascade,
  area       text not null check (area = any (public.app_areas())),
  can_edit   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_app_user_permissions unique (user_id, area),
  constraint chk_metricas_read_only check (area <> 'METRICAS' or not can_edit)
);
create trigger trg_app_user_permissions_updated_at
before update on public.app_user_permissions
for each row execute function public.set_updated_at();

create table public.app_user_groups (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.app_users(id) on delete cascade,
  group_id   uuid not null references public.catalog_groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint uq_app_user_groups unique (user_id, group_id)
);
create index idx_app_user_groups_group_id on public.app_user_groups (group_id);

-- Plantillas para crear cuentas: se copian al crear, no quedan ligadas.
create table public.permission_templates (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique check (btrim(name) <> ''),
  description  text,
  areas        jsonb not null default '{}' check (public.is_valid_area_map(areas)),
  group_scoped boolean not null default false, -- se elige a qué grupos ve
  sort_order   smallint not null default 100,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_permission_templates_updated_at
before update on public.permission_templates
for each row execute function public.set_updated_at();

insert into public.permission_templates (name, description, areas, group_scoped, sort_order) values
  ('Administrador', 'Edita todo y ve todas las personas. No gestiona cuentas.',
   '{"PERSONAS":"edit","MOVIMIENTOS":"edit","INFORMES":"edit","METRICAS":"read","CONFIGURACION":"edit"}', false, 10),
  ('Lector', 'Consulta y exporta todo, sin editar.',
   '{"PERSONAS":"read","MOVIMIENTOS":"read","INFORMES":"read","METRICAS":"read","CONFIGURACION":"read"}', false, 20),
  ('Capturista de informes', 'Captura los informes del mes; consulta personas y métricas.',
   '{"PERSONAS":"read","INFORMES":"edit","METRICAS":"read"}', false, 30),
  ('Encargado de grupo', 'Edita las personas y los informes de sus grupos.',
   '{"PERSONAS":"edit","MOVIMIENTOS":"read","INFORMES":"edit","METRICAS":"read"}', true, 40),
  ('Solo personas (lectura)', 'Solo consulta las fichas de personas.',
   '{"PERSONAS":"read"}', false, 50);

-- Cuentas existentes: mismo acceso que tenían
insert into public.app_user_permissions (user_id, area, can_edit)
select au.id, a.area, csr.code = 'ADMIN' and a.area <> 'METRICAS'
from public.app_users au
join public.catalog_system_roles csr on csr.id = au.system_role_id
cross join unnest(public.app_areas()) a(area)
where csr.code in ('ADMIN', 'READER');

update public.app_users
set system_role_id = (select id from public.catalog_system_roles where code = 'USER')
where system_role_id in (select id from public.catalog_system_roles where code in ('ADMIN', 'READER'));

delete from public.catalog_system_roles where code in ('ADMIN', 'READER');

-- ---------------------------------------------------------------------
-- 2. Funciones de permisos (SECURITY DEFINER: leen las tablas de
--    permisos sin pasar por su propio RLS)
-- ---------------------------------------------------------------------

-- NULL sin acceso, 'read' o 'edit'
create or replace function public.auth_area_level(p_area text)
returns text language sql security definer stable set search_path = public
as $$
  select case
    when public.is_superadmin() then case when p_area = 'METRICAS' then 'read' else 'edit' end
    else (select case when p.can_edit then 'edit' else 'read' end
          from app_user_permissions p
          join app_users au on au.id = p.user_id
          where p.user_id = auth.uid() and au.is_active and p.area = p_area)
  end;
$$;

create or replace function public.has_area(p_area text, p_edit boolean default false)
returns boolean language sql security definer stable set search_path = public
as $$
  select coalesce(case public.auth_area_level(p_area)
                    when 'edit' then true
                    when 'read' then not p_edit
                  end, false);
$$;

-- Alguna área de datos de personas (todas menos CONFIGURACION)
create or replace function public.has_any_data_area()
returns boolean language sql security definer stable set search_path = public
as $$
  select public.is_superadmin() or exists (
    select 1 from app_user_permissions p
    join app_users au on au.id = p.user_id
    where p.user_id = auth.uid() and au.is_active and p.area <> 'CONFIGURACION');
$$;

create or replace function public.auth_all_groups()
returns boolean language sql security definer stable set search_path = public
as $$
  select public.is_superadmin()
      or coalesce((select all_groups from app_users where id = auth.uid() and is_active), false);
$$;

create or replace function public.group_in_scope(p_group_id uuid)
returns boolean language sql security definer stable set search_path = public
as $$
  select public.auth_all_groups() or exists (
    select 1 from app_user_groups where user_id = auth.uid() and group_id = p_group_id);
$$;

-- Grupo de la persona para el alcance: el del periodo más reciente
create or replace function public.person_scope_group(p_person_id uuid)
returns uuid language sql security definer stable set search_path = public
as $$
  select group_id from person_group_history
  where person_id = p_person_id
  order by start_date desc
  limit 1;
$$;

-- Solo para cuentas limitadas a grupos (las políticas comprueban antes
-- auth_all_groups() una sola vez por consulta).
create or replace function public.person_in_my_groups(p_person_id uuid)
returns boolean language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from app_user_groups
    where user_id = auth.uid() and group_id = public.person_scope_group(p_person_id));
$$;

create or replace function public.person_has_groups(p_person_id uuid)
returns boolean language sql security definer stable set search_path = public
as $$ select exists (select 1 from person_group_history where person_id = p_person_id); $$;

create or replace function public.person_has_movements(p_person_id uuid)
returns boolean language sql security definer stable set search_path = public
as $$ select exists (select 1 from person_movements where person_id = p_person_id); $$;

-- Antes: ADMIN o SUPERADMIN. Ahora lo usan la importación de personas y
-- las reagrupaciones, que tocan a cualquiera: edición de PERSONAS con
-- alcance a todos los grupos.
create or replace function public.is_admin_or_above()
returns boolean language sql security definer stable set search_path = public
as $$ select public.has_area('PERSONAS', true) and public.auth_all_groups(); $$;

-- Una baja cierra cargos y grupo y cambia is_active: quien puede
-- registrar altas y bajas no necesita además editar PERSONAS.
alter function public.apply_person_movement() security definer;

-- ---------------------------------------------------------------------
-- 3. Políticas
-- ---------------------------------------------------------------------
do $$
declare
  t   text;
  pol record;
  -- persona dentro del alcance (auth_all_groups se evalúa una vez)
  scope constant text := '((select public.auth_all_groups()) or public.person_in_my_groups(%s))';
  any_read  constant text := '(select public.has_any_data_area())';
begin
  foreach t in array array[
    'catalog_groups','catalog_roles','catalog_contact_types','catalog_date_types','catalog_movement_types',
    'role_hour_goals','persons','person_contacts','person_dates','person_group_history','person_roles',
    'person_movements','monthly_reports','app_users','audit_log'
  ] loop
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
  end loop;

  -- Catálogos y metas: los lee cualquier cuenta; los edita CONFIGURACION
  foreach t in array array[
    'catalog_groups','catalog_roles','catalog_contact_types','catalog_date_types','catalog_movement_types','role_hour_goals'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_app_user())', t || '_select', t);
    execute format($p$create policy %I on public.%I for all to authenticated
                     using ((select public.has_area('CONFIGURACION', true)))
                     with check ((select public.has_area('CONFIGURACION', true)))$p$, t || '_write', t);
  end loop;

  -- persons
  execute format('create policy persons_select on public.persons for select to authenticated using (%s and %s)',
                 any_read, format(scope, 'id'));
  execute $p$create policy persons_insert on public.persons for insert to authenticated
            with check ((select public.has_area('PERSONAS', true)))$p$;
  execute format($p$create policy persons_update on public.persons for update to authenticated
                   using ((select public.has_area('PERSONAS', true)) and %1$s)
                   with check ((select public.has_area('PERSONAS', true)) and %1$s)$p$, format(scope, 'id'));
  execute format($p$create policy persons_delete on public.persons for delete to authenticated
                   using ((select public.has_area('PERSONAS', true)) and %s)$p$, format(scope, 'id'));

  -- Contactos y fechas: solo con PERSONAS
  foreach t in array array['person_contacts', 'person_dates'] loop
    execute format($p$create policy %I on public.%I for select to authenticated
                     using ((select public.has_area('PERSONAS')) and %s)$p$, t || '_select', t, format(scope, 'person_id'));
    execute format($p$create policy %1$I on public.%2$I for all to authenticated
                     using ((select public.has_area('PERSONAS', true)) and %3$s)
                     with check ((select public.has_area('PERSONAS', true)) and %3$s)$p$, t || '_write', t, format(scope, 'person_id'));
  end loop;

  -- Cargos
  execute format('create policy person_roles_select on public.person_roles for select to authenticated using (%s and %s)',
                 any_read, format(scope, 'person_id'));
  execute format($p$create policy person_roles_write on public.person_roles for all to authenticated
                   using ((select public.has_area('PERSONAS', true)) and %1$s)
                   with check ((select public.has_area('PERSONAS', true)) and %1$s)$p$, format(scope, 'person_id'));

  -- Grupos de cada persona: un encargado solo asigna grupos suyos; a una
  -- persona recién creada (sin grupos) le puede dar el primero.
  execute format('create policy person_group_history_select on public.person_group_history for select to authenticated using (%s and %s)',
                 any_read, format(scope, 'person_id'));
  execute format($p$create policy person_group_history_insert on public.person_group_history for insert to authenticated
                   with check ((select public.has_area('PERSONAS', true)) and public.group_in_scope(group_id)
                               and (%s or not public.person_has_groups(person_id)))$p$, format(scope, 'person_id'));
  execute format($p$create policy person_group_history_update on public.person_group_history for update to authenticated
                   using ((select public.has_area('PERSONAS', true)) and %s)
                   with check ((select public.has_area('PERSONAS', true)) and public.group_in_scope(group_id))$p$, format(scope, 'person_id'));
  execute format($p$create policy person_group_history_delete on public.person_group_history for delete to authenticated
                   using ((select public.has_area('PERSONAS', true)) and %s and public.group_in_scope(group_id))$p$, format(scope, 'person_id'));

  -- Altas y bajas. Quien crea una persona (PERSONAS) registra su alta
  -- inicial aunque no tenga MOVIMIENTOS.
  execute format('create policy person_movements_select on public.person_movements for select to authenticated using (%s and %s)',
                 any_read, format(scope, 'person_id'));
  execute format($p$create policy person_movements_insert on public.person_movements for insert to authenticated
                   with check (%s and ((select public.has_area('MOVIMIENTOS', true))
                                       or ((select public.has_area('PERSONAS', true)) and not public.person_has_movements(person_id))))$p$,
                 format(scope, 'person_id'));
  execute format($p$create policy person_movements_update on public.person_movements for update to authenticated
                   using ((select public.has_area('MOVIMIENTOS', true)) and %1$s)
                   with check ((select public.has_area('MOVIMIENTOS', true)) and %1$s)$p$, format(scope, 'person_id'));
  execute format($p$create policy person_movements_delete on public.person_movements for delete to authenticated
                   using ((select public.has_area('MOVIMIENTOS', true)) and %s)$p$, format(scope, 'person_id'));

  -- Informes del mes
  execute format('create policy monthly_reports_select on public.monthly_reports for select to authenticated using (%s and %s)',
                 any_read, format(scope, 'person_id'));
  execute format($p$create policy monthly_reports_write on public.monthly_reports for all to authenticated
                   using ((select public.has_area('INFORMES', true)) and %1$s)
                   with check ((select public.has_area('INFORMES', true)) and %1$s)$p$, format(scope, 'person_id'));
end $$;

-- Cuentas: cada quien ve la suya; solo SUPERADMIN gestiona
create policy app_users_select on public.app_users
  for select to authenticated using (id = auth.uid() or public.is_superadmin());
create policy app_users_insert on public.app_users
  for insert to authenticated with check (public.is_superadmin());
create policy app_users_update on public.app_users
  for update to authenticated using (public.is_superadmin()) with check (public.is_superadmin());
create policy app_users_delete on public.app_users
  for delete to authenticated using (public.is_superadmin());

alter table public.app_user_permissions enable row level security;
alter table public.app_user_groups      enable row level security;
alter table public.permission_templates enable row level security;

create policy app_user_permissions_select on public.app_user_permissions
  for select to authenticated using (user_id = auth.uid() or public.is_superadmin());
create policy app_user_permissions_write on public.app_user_permissions
  for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());
create policy app_user_groups_select on public.app_user_groups
  for select to authenticated using (user_id = auth.uid() or public.is_superadmin());
create policy app_user_groups_write on public.app_user_groups
  for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());
create policy permission_templates_all on public.permission_templates
  for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());

-- La bitácora incluye cambios de cuentas y datos de todos: solo SUPERADMIN
create policy audit_log_select on public.audit_log
  for select to authenticated using (public.is_superadmin());

do $$
declare t text;
begin
  foreach t in array array['app_user_permissions', 'app_user_groups', 'permission_templates'] loop
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
       for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. Funciones para la app
-- ---------------------------------------------------------------------

-- Acceso de la cuenta en sesión; NULL si no tiene cuenta activa.
create or replace function public.fn_my_access()
returns jsonb language sql security definer stable set search_path = public
as $$
  select case when public.auth_system_role_code() is null then null else jsonb_build_object(
    'role', public.auth_system_role_code(),
    'superadmin', public.is_superadmin(),
    'all_groups', public.auth_all_groups(),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name)
      from app_user_groups ug join catalog_groups g on g.id = ug.group_id
      where ug.user_id = auth.uid() and not public.auth_all_groups()), '[]'::jsonb),
    'areas', coalesce((
      select jsonb_object_agg(a.area, public.auth_area_level(a.area))
      from unnest(public.app_areas()) a(area)
      where public.auth_area_level(a.area) is not null), '{}'::jsonb)
  ) end;
$$;

-- Crea o actualiza la cuenta con todos sus permisos de una vez.
-- p_areas: {"PERSONAS": "edit", ...}; se ignora si p_superadmin.
create or replace function public.fn_save_app_user(
  p_user_id uuid, p_display_name text, p_superadmin boolean, p_is_active boolean,
  p_all_groups boolean, p_group_ids uuid[], p_areas jsonb
) returns void
language plpgsql security invoker set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Solo un super administrador gestiona cuentas.' using errcode = '42501';
  end if;
  if not public.is_valid_area_map(coalesce(p_areas, '{}')) then
    raise exception 'Permisos inválidos.';
  end if;
  if not p_superadmin and not p_all_groups and coalesce(cardinality(p_group_ids), 0) = 0 then
    raise exception 'Elige al menos un grupo o marca "Todos los grupos".';
  end if;

  insert into app_users (id, system_role_id, display_name, is_active, all_groups)
  values (p_user_id,
          (select id from catalog_system_roles where code = case when p_superadmin then 'SUPERADMIN' else 'USER' end),
          nullif(btrim(p_display_name), ''), p_is_active, p_superadmin or p_all_groups)
  on conflict (id) do update set
    system_role_id = excluded.system_role_id, display_name = excluded.display_name,
    is_active = excluded.is_active, all_groups = excluded.all_groups;

  delete from app_user_permissions where user_id = p_user_id;
  delete from app_user_groups where user_id = p_user_id;
  if p_superadmin then return; end if;

  insert into app_user_permissions (user_id, area, can_edit)
  select p_user_id, e.key, e.value = 'edit' from jsonb_each_text(coalesce(p_areas, '{}')) e;

  if not p_all_groups then
    insert into app_user_groups (user_id, group_id)
    select distinct p_user_id, g from unnest(p_group_ids) g;
  end if;
end;
$$;

-- Interruptor de un área: p_level NULL quita el acceso, 'read' o 'edit'.
create or replace function public.fn_set_user_area(p_user_id uuid, p_area text, p_level text)
returns void
language plpgsql security invoker set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Solo un super administrador gestiona cuentas.' using errcode = '42501';
  end if;
  if p_area <> all (public.app_areas()) or p_level not in ('read', 'edit') then
    raise exception 'Permiso inválido.';
  end if;
  if p_area = 'METRICAS' and p_level = 'edit' then p_level := 'read'; end if;
  if exists (select 1 from app_users au join catalog_system_roles r on r.id = au.system_role_id
             where au.id = p_user_id and r.code = 'SUPERADMIN') then
    raise exception 'Un super administrador tiene acceso a todo.';
  end if;

  if p_level is null then
    delete from app_user_permissions where user_id = p_user_id and area = p_area;
  else
    insert into app_user_permissions (user_id, area, can_edit) values (p_user_id, p_area, p_level = 'edit')
    on conflict (user_id, area) do update set can_edit = excluded.can_edit;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Privilegios
-- ---------------------------------------------------------------------
revoke all on public.app_user_permissions, public.app_user_groups, public.permission_templates from anon;
grant select, insert, update, delete on public.app_user_permissions, public.app_user_groups, public.permission_templates to authenticated;

revoke execute on function
  public.app_areas(), public.is_valid_area_map(jsonb), public.auth_area_level(text), public.has_area(text, boolean),
  public.has_any_data_area(), public.auth_all_groups(), public.group_in_scope(uuid), public.person_scope_group(uuid),
  public.person_in_my_groups(uuid), public.person_has_groups(uuid), public.person_has_movements(uuid),
  public.fn_my_access(), public.fn_save_app_user(uuid, text, boolean, boolean, boolean, uuid[], jsonb),
  public.fn_set_user_area(uuid, text, text)
from public, anon;
grant execute on function
  public.app_areas(), public.is_valid_area_map(jsonb), public.auth_area_level(text), public.has_area(text, boolean),
  public.has_any_data_area(), public.auth_all_groups(), public.group_in_scope(uuid), public.person_scope_group(uuid),
  public.person_in_my_groups(uuid), public.person_has_groups(uuid), public.person_has_movements(uuid),
  public.fn_my_access(), public.fn_save_app_user(uuid, text, boolean, boolean, boolean, uuid[], jsonb),
  public.fn_set_user_area(uuid, text, text)
to authenticated;
