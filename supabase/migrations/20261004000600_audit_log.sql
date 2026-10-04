-- =====================================================================
-- 0600 · BITÁCORA DE CAMBIOS
-- =====================================================================
-- Quién cambió qué y cuándo, en las tablas que alimentan informes.
-- Solo ADMIN/SUPERADMIN la leen; nadie la escribe directamente.
-- =====================================================================

create table public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  row_id      uuid,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data    jsonb,
  new_data    jsonb,
  changed_by  uuid default auth.uid(),
  changed_at  timestamptz not null default now()
);

create index idx_audit_log_row on public.audit_log (table_name, row_id);
create index idx_audit_log_changed_at on public.audit_log (changed_at desc);

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into audit_log (table_name, row_id, action, old_data, new_data)
  values (
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'persons','person_group_history','person_roles','monthly_reports',
    'role_hour_goals','catalog_roles','app_users'
  ] loop
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
       for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

alter table public.audit_log enable row level security;
create policy audit_log_select on public.audit_log
  for select to authenticated using (public.is_admin_or_above());

revoke all on public.audit_log from anon;
grant select on public.audit_log to authenticated;
revoke execute on function public.audit_row_change() from public, anon, authenticated;
