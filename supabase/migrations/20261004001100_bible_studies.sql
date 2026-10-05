-- =====================================================================
-- 1100 · CURSOS BÍBLICOS EN EL INFORME MENSUAL
-- =====================================================================
-- Migración incremental sobre 0100-0900 (no depende de 1000).
--
--   * monthly_reports.bible_studies: cursos bíblicos que la persona
--     dirigió ese mes. Lo informa cualquier persona que entrega informe
--     (PNB, PB, PR, PA u otro cargo); casi siempre es 0, por eso no es
--     obligatorio y vale 0 por omisión. Los informes ya guardados quedan
--     con 0.
--   * Si informó cursos (> 0), participó.
--   * fn_report_matrix y fn_monthly_summary devuelven los cursos.
--   * Tipo de baja SACADO: quien es sacado deja de ser miembro desde esa
--     fecha, así que ya no aparece en la hoja del mes ni se le esperan
--     informes. Si vuelve, se registra un REINGRESO.
-- =====================================================================

alter table public.monthly_reports
  add column bible_studies smallint not null default 0
    constraint chk_monthly_reports_bible_studies check (bible_studies between 0 and 99);

alter table public.monthly_reports
  add constraint chk_studies_imply_participation check (bible_studies = 0 or participated);

comment on column public.monthly_reports.bible_studies is
  'Cursos bíblicos dirigidos en el mes (0 si ninguno).';

-- ---------------------------------------------------------------------
-- Funciones de informes: cambian sus columnas, hay que recrearlas.
-- fn_service_year_summary llama a fn_report_matrix por nombre y sigue
-- funcionando sin cambios.
-- ---------------------------------------------------------------------
drop function if exists public.fn_monthly_summary(int);
drop function if exists public.fn_report_matrix(int);

-- Igual que la versión de 0800 (solo meses en que era miembro, o con
-- informe) más la columna bible_studies.
create function public.fn_report_matrix(p_service_year int)
returns table (
  person_id     uuid,
  first_name    text,
  last_name     text,
  group_name    text,
  period        date,
  year          smallint,
  month         smallint,
  hours_role    text,     -- PR / PA si ese mes tenía cargo con horas
  has_report    boolean,
  participated  boolean,
  hours         numeric,
  bible_studies int       -- 0 si no informó
)
language sql
stable
set search_path = public
as $$
  with months as (
    select m::date as period, (m + interval '1 month' - interval '1 day')::date as last_day
    from generate_series(
      lower(service_year_bounds(p_service_year))::timestamp,
      least(upper(service_year_bounds(p_service_year)), reporting_cutoff())::timestamp - interval '1 month',
      interval '1 month') m
  )
  select
    p.id, p.first_name, p.last_name,
    (select cg.name
       from person_group_history h join catalog_groups cg on cg.id = h.group_id
      where h.person_id = p.id
        and daterange(h.start_date, h.end_date, '[]')
            && daterange(m.period, (m.period + interval '1 month')::date, '[)')
      order by h.start_date desc limit 1),
    m.period,
    extract(year from m.period)::smallint,
    extract(month from m.period)::smallint,
    hm.role_code,
    r.id is not null,
    coalesce(r.participated, false),
    r.hours,
    coalesce(r.bible_studies, 0)::int
  from persons p
  cross join months m
  left join view_hours_role_months hm on hm.person_id = p.id and hm.period = m.period
  left join monthly_reports r on r.person_id = p.id and r.period = m.period
  where r.id is not null
     or was_member_during(p.id, m.period, m.last_day)
  order by p.last_name, p.first_name, m.period;
$$;

-- Resumen de la organización por mes y grupo, ahora con cursos bíblicos.
create function public.fn_monthly_summary(p_service_year int)
returns table (
  period              date,
  group_name          text,
  persons             int,
  reports_received    int,
  participated        int,
  pct_reported        numeric,
  hours_role_persons  int,
  total_hours         numeric,
  bible_studies       int
)
language sql
stable
set search_path = public
as $$
  select
    m.period, m.group_name,
    count(*)::int,
    count(*) filter (where m.has_report)::int,
    count(*) filter (where m.participated)::int,
    round(100.0 * count(*) filter (where m.has_report) / nullif(count(*), 0), 1),
    count(*) filter (where m.hours_role is not null)::int,
    coalesce(sum(m.hours), 0),
    coalesce(sum(m.bible_studies), 0)::int
  from fn_report_matrix(p_service_year) m
  group by m.period, m.group_name
  order by m.period, m.group_name nulls last;
$$;

revoke execute on function public.fn_report_matrix(int), public.fn_monthly_summary(int) from public, anon;
grant execute on function public.fn_report_matrix(int), public.fn_monthly_summary(int) to authenticated;

-- ---------------------------------------------------------------------
-- Baja por "Sacado"
-- ---------------------------------------------------------------------
insert into public.catalog_movement_types (code, name, direction, requires_congregation, sort_order) values
  ('SACADO', 'Sacado', 'BAJA', false, 65)
on conflict (code) do nothing;
