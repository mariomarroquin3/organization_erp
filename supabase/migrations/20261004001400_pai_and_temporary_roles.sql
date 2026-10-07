-- =====================================================================
-- 1400 · PAI (PA INDEFINIDO) Y CARGOS POR MESES CONCRETOS
-- =====================================================================
-- Distinción pedida por Mario (2026-10-07):
--   * PA: cargo por un mes o por los meses que se decidan (por ejemplo,
--     solo septiembre). Siempre tiene fecha de fin.
--   * PAI: PA indefinido. Sigue vigente hasta que se cierre, con meta
--     de 30 h cada mes (360 h el año completo) y avance comparable al
--     de PR: meta del año, meta a la fecha, horas faltantes y estado.
--
-- Las vistas y funciones de métricas (0400/0800) ya tratan igual a
-- todo cargo "con horas", así que PAI entra en el cumplimiento de
-- metas, la matriz, los resúmenes y las exportaciones sin cambiarlas.
-- =====================================================================

-- 1. Cargos que solo se dan por meses concretos: exigen fecha de fin
alter table public.catalog_roles
  add column if not exists requires_end_date boolean not null default false;

comment on column public.catalog_roles.requires_end_date is
  'El cargo se da por meses concretos (PA): todo periodo debe tener fecha de fin.';

-- 2. Catálogo: PAI con horas, entre PR y PA; PA queda como cargo por meses
insert into public.catalog_roles (code, name, requires_hours_report, sort_order) values
  ('PAI', 'PA indefinido', true, 15)
on conflict (code) do update set requires_hours_report = true;

update public.catalog_roles set requires_end_date = true where code = 'PA';

-- 3. Meta de PAI: 30 h por mes con el cargo, 360 h el año completo
insert into public.role_hour_goals (role_id, effective_from_sy, annual_hours, monthly_hours, notes)
select id, 2026, 360, 30, 'PA indefinido: 30 h cada mes, 360 h el año completo.'
from public.catalog_roles where code = 'PAI'
on conflict (role_id, effective_from_sy) do nothing;

-- 4. Un cargo por meses no puede quedar abierto
create or replace function public.check_role_end_date()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_code text;
begin
  if new.end_date is not null then
    return new;
  end if;
  select code into v_code from catalog_roles where id = new.role_id and requires_end_date;
  if v_code is not null then
    raise exception using
      errcode = 'check_violation',
      message = format('El cargo %s es por meses concretos: indica la fecha de fin.', v_code)
        || case when v_code = 'PA' then ' Si es indefinido, usa PAI.' else '' end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_role_end_date on public.person_roles;
create trigger trg_check_role_end_date
before insert or update of role_id, end_date on public.person_roles
for each row execute function public.check_role_end_date();
