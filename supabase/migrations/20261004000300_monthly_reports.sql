-- =====================================================================
-- 0300 · INFORMES MENSUALES
-- =====================================================================
-- Reemplaza service_hours del esquema original. Un solo registro
-- mensual por persona para TODOS:
--   * PR / PA (cargo con informe de horas): participated + hours.
--     hours es obligatorio si ese mes tenía un cargo con horas.
--   * Resto de personas: solo participated (sí/no). hours queda NULL.
-- Las horas siguen ligadas a la persona, no al cargo; el cargo de
-- cada mes se deduce de person_roles en las vistas.
-- =====================================================================

create table public.monthly_reports (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references public.persons(id) on delete cascade,
  year          smallint not null check (year between 2000 and 2100),
  month         smallint not null check (month between 1 and 12),
  participated  boolean not null,
  -- 744 = 31 días * 24 h: tope físico de un mes
  hours         numeric(5,2) check (hours >= 0 and hours <= 744),
  notes         text,
  registered_at timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Columnas generadas (no editables) para filtrar y unir por periodo
  period        date generated always as (make_date(year, month, 1)) stored,
  service_year  smallint generated always as (
                  (case when month >= 9 then year + 1 else year end)::smallint
                ) stored,
  constraint uq_monthly_reports_period unique (person_id, year, month),
  -- Si reportó horas > 0, participó
  constraint chk_hours_implies_participation check (hours is null or hours = 0 or participated)
);
create trigger trg_monthly_reports_updated_at
before update on public.monthly_reports
for each row execute function public.set_updated_at();

create index idx_monthly_reports_period on public.monthly_reports (period);
create index idx_monthly_reports_sy on public.monthly_reports (service_year, person_id);

-- Cargo con informe de horas que una persona tenía en un mes.
-- Si hubo un cambio dentro del mes (p. ej. PA hasta el 15 y PR desde
-- el 16), se toma el que empezó más tarde.
create or replace function public.hours_role_in_month(p_person_id uuid, p_period date)
returns uuid
language sql
stable
set search_path = public
as $$
  select pr.role_id
  from person_roles pr
  join catalog_roles cr on cr.id = pr.role_id
  where pr.person_id = p_person_id
    and cr.requires_hours_report
    and daterange(pr.start_date, pr.end_date, '[]')
        && daterange(p_period, (p_period + interval '1 month')::date, '[)')
  order by pr.start_date desc
  limit 1;
$$;

-- PR/PA deben informar horas en los meses en que tenían el cargo
create or replace function public.check_monthly_report_hours()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_role_code text;
begin
  if new.hours is null then
    select cr.code into v_role_code
    from catalog_roles cr
    where cr.id = public.hours_role_in_month(new.person_id, make_date(new.year, new.month, 1));

    if v_role_code is not null then
      raise exception using
        errcode = '23514',
        message = format('En %s-%s la persona era %s: el informe debe incluir horas (0 si no hubo).',
                         new.year, lpad(new.month::text, 2, '0'), v_role_code);
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_check_monthly_report_hours
before insert or update of person_id, year, month, hours on public.monthly_reports
for each row execute function public.check_monthly_report_hours();
