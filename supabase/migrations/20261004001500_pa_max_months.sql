-- =====================================================================
-- 1500 · PA DE 1 A 3 MESES
-- =====================================================================
-- Mario (2026-10-07): PA es un evento de 1, 2 o 3 meses. Al terminar
-- se desmarca solo (su periodo tiene fecha de fin) y queda el registro
-- de esos meses en el historial y en los informes. PAI es el cargo que
-- dura todo el año, 30 h cada mes.
--
-- catalog_roles.max_months: tope de meses calendario de un periodo del
-- cargo (PA = 3). Un mes cuenta aunque el cargo cubra solo parte de él,
-- igual que en las métricas.
-- =====================================================================

alter table public.catalog_roles
  add column if not exists max_months smallint check (max_months between 1 and 120);

comment on column public.catalog_roles.max_months is
  'Máximo de meses calendario por periodo del cargo (PA = 3). Nulo = sin tope.';

update public.catalog_roles set max_months = 3 where code = 'PA' and max_months is null;

-- Meses calendario que toca un periodo (1 si empieza y termina en el mismo mes)
create or replace function public.months_spanned(p_start date, p_end date)
returns int
language sql
immutable
parallel safe
set search_path = public
as $$
  select ((extract(year from p_end) - extract(year from p_start)) * 12
          + extract(month from p_end) - extract(month from p_start))::int + 1;
$$;

create or replace function public.check_role_end_date()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_role catalog_roles%rowtype;
begin
  select * into v_role from catalog_roles where id = new.role_id;
  if new.end_date is null and v_role.requires_end_date then
    raise exception using
      errcode = 'check_violation',
      message = format('El cargo %s es por meses concretos: indica la fecha de fin.', v_role.code)
        || case when v_role.code = 'PA' then ' Si es indefinido, usa PAI.' else '' end;
  end if;
  if new.end_date is not null and v_role.max_months is not null
     and months_spanned(new.start_date, new.end_date) > v_role.max_months then
    raise exception using
      errcode = 'check_violation',
      message = format('El cargo %s dura como máximo %s meses; este periodo abarca %s.',
                       v_role.code, v_role.max_months, months_spanned(new.start_date, new.end_date))
        || case when v_role.code = 'PA' then ' Para todo el año usa PAI.' else '' end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_role_end_date on public.person_roles;
create trigger trg_check_role_end_date
before insert or update of role_id, start_date, end_date on public.person_roles
for each row execute function public.check_role_end_date();
