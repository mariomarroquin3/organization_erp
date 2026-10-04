-- =====================================================================
-- 0200 · AÑO DE SERVICIO Y METAS DE HORAS
-- =====================================================================
-- Año de servicio: de septiembre a agosto. Se nombra por el año en
-- que CIERRA: el año de servicio 2026 va de sep-2025 a ago-2026.
-- (Resuelve el pendiente "Meta anual de horas" del contexto.)
-- =====================================================================

-- Año de servicio al que pertenece un mes calendario
create or replace function public.service_year_of(p_year int, p_month int)
returns smallint
language sql
immutable
parallel safe
set search_path = public
as $$
  select (case when p_month >= 9 then p_year + 1 else p_year end)::smallint;
$$;

create or replace function public.service_year_of(p_date date)
returns smallint
language sql
immutable
parallel safe
set search_path = public
as $$
  select public.service_year_of(extract(year from p_date)::int, extract(month from p_date)::int);
$$;

-- Primer y último día de un año de servicio
create or replace function public.service_year_bounds(p_service_year int)
returns daterange
language sql
immutable
parallel safe
set search_path = public
as $$
  select daterange(make_date(p_service_year - 1, 9, 1), make_date(p_service_year, 9, 1), '[)');
$$;

-- ---------------------------------------------------------------------
-- Metas de horas por cargo, con vigencia desde un año de servicio.
-- Una fila aplica desde effective_from_sy hasta que otra fila más
-- reciente del mismo cargo la reemplace, así no hay que repetirla
-- cada año.
--
-- La meta se expresa por mes o por año:
--   * monthly_hours: meta fija por cada mes con el cargo (típico PA).
--   * annual_hours:  meta del año completo (típico PR). Si la persona
--     tiene el cargo solo parte del año, se prorratea: annual/12 por
--     cada mes con el cargo.
-- Si ambas están, manda monthly_hours para el cálculo mensual y
-- annual_hours se usa solo como referencia del año completo.
-- ---------------------------------------------------------------------
create table public.role_hour_goals (
  id                uuid primary key default gen_random_uuid(),
  role_id           uuid not null references public.catalog_roles(id) on delete cascade,
  effective_from_sy smallint not null check (effective_from_sy between 2000 and 2100),
  annual_hours      numeric(6,2) check (annual_hours > 0),
  monthly_hours     numeric(5,2) check (monthly_hours > 0),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint chk_goal_present check (annual_hours is not null or monthly_hours is not null),
  constraint uq_role_goal_year unique (role_id, effective_from_sy)
);
create trigger trg_role_hour_goals_updated_at
before update on public.role_hour_goals
for each row execute function public.set_updated_at();

-- Solo los cargos con informe de horas pueden tener meta
create or replace function public.check_goal_role_reports_hours()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from catalog_roles where id = new.role_id and requires_hours_report) then
    raise exception 'Solo los cargos con informe de horas (PR/PA) pueden tener meta de horas.';
  end if;
  return new;
end;
$$;

create trigger trg_check_goal_role_reports_hours
before insert or update of role_id on public.role_hour_goals
for each row execute function public.check_goal_role_reports_hours();

-- Meta mensual aplicable a un cargo en un año de servicio dado
create or replace function public.monthly_goal_for(p_role_id uuid, p_service_year int)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(g.monthly_hours, g.annual_hours / 12.0)
  from role_hour_goals g
  where g.role_id = p_role_id
    and g.effective_from_sy <= p_service_year
  order by g.effective_from_sy desc
  limit 1;
$$;
