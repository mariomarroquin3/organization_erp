-- =====================================================================
-- 1300 · ÁREA "USUARIOS": gestionar cuentas sin ser super administrador
-- =====================================================================
-- Nueva área USUARIOS (lectura: ver cuentas y plantillas; edición:
-- crearlas y cambiar sus permisos). No da acceso a ningún dato de
-- personas: una cuenta con solo USUARIOS no ve personas, informes ni
-- métricas.
--
-- Límites de quien gestiona usuarios sin ser SUPERADMIN:
--   * no ve ni toca cuentas SUPERADMIN, ni puede crear una;
--   * no puede cambiar su propia cuenta ni sus propios permisos.
-- Sí puede dar cualquier área a otras cuentas (es su trabajo), así que
-- solo debe tenerla alguien de confianza. La bitácora sigue siendo solo
-- del SUPERADMIN.
-- =====================================================================

create or replace function public.app_areas()
returns text[] language sql immutable
as $$ select array['PERSONAS', 'MOVIMIENTOS', 'INFORMES', 'METRICAS', 'CONFIGURACION', 'USUARIOS'] $$;

-- USUARIOS tampoco da acceso a datos de personas
create or replace function public.has_any_data_area()
returns boolean language sql security definer stable set search_path = public
as $$
  select public.is_superadmin() or exists (
    select 1 from app_user_permissions p
    join app_users au on au.id = p.user_id
    where p.user_id = auth.uid() and au.is_active and p.area not in ('CONFIGURACION', 'USUARIOS'));
$$;

create or replace function public.is_superadmin_account(p_user_id uuid)
returns boolean language sql security definer stable set search_path = public
as $$
  select exists (select 1 from app_users au join catalog_system_roles r on r.id = au.system_role_id
                 where au.id = p_user_id and r.code = 'SUPERADMIN');
$$;

-- ¿Puede la cuenta en sesión ver / cambiar la cuenta p_user_id?
create or replace function public.can_see_account(p_user_id uuid)
returns boolean language sql security definer stable set search_path = public
as $$
  select p_user_id = auth.uid() or public.is_superadmin()
      or (public.has_area('USUARIOS') and not public.is_superadmin_account(p_user_id));
$$;

create or replace function public.can_manage_account(p_user_id uuid)
returns boolean language sql security definer stable set search_path = public
as $$
  select public.is_superadmin()
      or (public.has_area('USUARIOS', true) and p_user_id <> auth.uid()
          and not public.is_superadmin_account(p_user_id));
$$;

-- Nivel USER (para comprobar que un gestor no cree SUPERADMIN)
create or replace function public.user_role_id()
returns uuid language sql security definer stable set search_path = public
as $$ select id from catalog_system_roles where code = 'USER'; $$;

-- ---------------------------------------------------------------------
-- Políticas de cuentas, permisos, grupos y plantillas
-- ---------------------------------------------------------------------
drop policy app_users_select on public.app_users;
drop policy app_users_insert on public.app_users;
drop policy app_users_update on public.app_users;
drop policy app_users_delete on public.app_users;
create policy app_users_select on public.app_users
  for select to authenticated using (public.can_see_account(id));
create policy app_users_insert on public.app_users
  for insert to authenticated with check (
    public.is_superadmin()
    or (public.has_area('USUARIOS', true) and id <> auth.uid() and system_role_id = public.user_role_id()));
create policy app_users_update on public.app_users
  for update to authenticated using (public.can_manage_account(id))
  with check (public.is_superadmin() or system_role_id = public.user_role_id());
create policy app_users_delete on public.app_users
  for delete to authenticated using (public.can_manage_account(id));

drop policy app_user_permissions_select on public.app_user_permissions;
drop policy app_user_permissions_write on public.app_user_permissions;
drop policy app_user_groups_select on public.app_user_groups;
drop policy app_user_groups_write on public.app_user_groups;
create policy app_user_permissions_select on public.app_user_permissions
  for select to authenticated using (public.can_see_account(user_id));
create policy app_user_permissions_write on public.app_user_permissions
  for all to authenticated using (public.can_manage_account(user_id)) with check (public.can_manage_account(user_id));
create policy app_user_groups_select on public.app_user_groups
  for select to authenticated using (public.can_see_account(user_id));
create policy app_user_groups_write on public.app_user_groups
  for all to authenticated using (public.can_manage_account(user_id)) with check (public.can_manage_account(user_id));

drop policy permission_templates_all on public.permission_templates;
create policy permission_templates_select on public.permission_templates
  for select to authenticated using ((select public.has_area('USUARIOS')));
create policy permission_templates_write on public.permission_templates
  for all to authenticated
  using ((select public.has_area('USUARIOS', true))) with check ((select public.has_area('USUARIOS', true)));

insert into public.permission_templates (name, description, areas, group_scoped, sort_order) values
  ('Gestor de usuarios', 'Crea cuentas y cambia permisos. No ve datos de personas.', '{"USUARIOS":"edit"}', false, 60)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------
-- Funciones de cuentas
-- ---------------------------------------------------------------------
create or replace function public.fn_save_app_user(
  p_user_id uuid, p_display_name text, p_superadmin boolean, p_is_active boolean,
  p_all_groups boolean, p_group_ids uuid[], p_areas jsonb
) returns void
language plpgsql security invoker set search_path = public
as $$
begin
  if not public.has_area('USUARIOS', true) then
    raise exception 'No tienes permiso para gestionar cuentas.' using errcode = '42501';
  end if;
  if not public.is_superadmin() then
    if p_superadmin then
      raise exception 'Solo un super administrador puede crear otro super administrador.' using errcode = '42501';
    end if;
    if p_user_id = auth.uid() then
      raise exception 'No puedes cambiar tu propia cuenta; pídeselo a otro administrador.' using errcode = '42501';
    end if;
    if public.is_superadmin_account(p_user_id) then
      raise exception 'Solo un super administrador puede cambiar a otro super administrador.' using errcode = '42501';
    end if;
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

create or replace function public.fn_set_user_area(p_user_id uuid, p_area text, p_level text)
returns void
language plpgsql security invoker set search_path = public
as $$
begin
  if not public.has_area('USUARIOS', true) then
    raise exception 'No tienes permiso para gestionar cuentas.' using errcode = '42501';
  end if;
  if p_area <> all (public.app_areas()) or p_level not in ('read', 'edit') then
    raise exception 'Permiso inválido.';
  end if;
  if p_area = 'METRICAS' and p_level = 'edit' then p_level := 'read'; end if;
  if public.is_superadmin_account(p_user_id) then
    raise exception 'Un super administrador tiene acceso a todo.';
  end if;
  if p_user_id = auth.uid() and not public.is_superadmin() then
    raise exception 'No puedes cambiar tus propios permisos; pídeselo a otro administrador.' using errcode = '42501';
  end if;

  if p_level is null then
    delete from app_user_permissions where user_id = p_user_id and area = p_area;
  else
    insert into app_user_permissions (user_id, area, can_edit) values (p_user_id, p_area, p_level = 'edit')
    on conflict (user_id, area) do update set can_edit = excluded.can_edit;
  end if;
end;
$$;

revoke execute on function
  public.is_superadmin_account(uuid), public.can_see_account(uuid), public.can_manage_account(uuid), public.user_role_id()
from public, anon;
grant execute on function
  public.is_superadmin_account(uuid), public.can_see_account(uuid), public.can_manage_account(uuid), public.user_role_id()
to authenticated;
