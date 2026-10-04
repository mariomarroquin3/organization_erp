-- =====================================================================
-- 0400 · VISTAS Y FUNCIONES DE MÉTRICAS
-- =====================================================================
-- Todas las vistas usan security_invoker = true para que respeten el
-- RLS de las tablas base. Sin esto, en Supabase una vista se ejecuta
-- con los permisos de su dueño (postgres) y se salta el RLS.
--
-- "Mes cerrado": todo mes anterior al mes en curso. Las metas "a la
-- fecha" y la completitud de informes se miden sobre meses cerrados.
-- =====================================================================

-- Primer día del mes en curso: los meses anteriores están cerrados
create or replace function public.reporting_cutoff()
returns date
language sql
stable
set search_path = public
as $$
  select date_trunc('month', current_date::timestamp)::date;
$$;

-- ---------------------------------------------------------------------
-- Estado actual
-- ---------------------------------------------------------------------
create view public.view_current_group with (security_invoker = true) as
select pgh.person_id, pgh.group_id, cg.name as group_name, pgh.start_date
from public.person_group_history pgh
join public.catalog_groups cg on cg.id = pgh.group_id
where pgh.start_date <= current_date
  and (pgh.end_date is null or pgh.end_date >= current_date);

create view public.view_current_roles with (security_invoker = true) as
select pr.person_id, pr.role_id, cr.code as role_code, cr.name as role_name,
       cr.requires_hours_report, pr.start_date, pr.end_date
from public.person_roles pr
join public.catalog_roles cr on cr.id = pr.role_id
where pr.start_date <= current_date
  and (pr.end_date is null or pr.end_date >= current_date);

create view public.view_current_pr with (security_invoker = true) as
select p.id as person_id, p.first_name, p.last_name, vcr.start_date
from public.view_current_roles vcr
join public.persons p on p.id = vcr.person_id
where vcr.role_code = 'PR';

create view public.view_current_pa with (security_invoker = true) as
select p.id as person_id, p.first_name, p.last_name, vcr.start_date
from public.view_current_roles vcr
join public.persons p on p.id = vcr.person_id
where vcr.role_code = 'PA';

-- Ficha resumida de cada persona: grupo y cargos actuales
create view public.view_persons_overview with (security_invoker = true) as
select
  p.id as person_id, p.first_name, p.last_name, p.is_active, p.birth_date,
  g.group_id, g.group_name,
  (select string_agg(r.role_code, ', ' order by cr.sort_order, r.role_code)
     from public.view_current_roles r
     join public.catalog_roles cr on cr.id = r.role_id
    where r.person_id = p.id) as current_roles,
  (select r.role_code from public.view_current_roles r
    where r.person_id = p.id and r.requires_hours_report limit 1) as current_hours_role
from public.persons p
left join public.view_current_group g on g.person_id = p.id;

-- Historial de cargos legible
create view public.view_role_history with (security_invoker = true) as
select pr.id, pr.person_id, p.first_name, p.last_name,
       cr.code as role_code, cr.name as role_name, cr.requires_hours_report,
       pr.start_date, pr.end_date,
       (pr.start_date <= current_date and (pr.end_date is null or pr.end_date >= current_date)) as is_current
from public.person_roles pr
join public.persons p on p.id = pr.person_id
join public.catalog_roles cr on cr.id = pr.role_id;

-- ---------------------------------------------------------------------
-- Horas por año calendario y por año de servicio
-- ---------------------------------------------------------------------
create view public.view_annual_hours with (security_invoker = true) as
select person_id, year, sum(coalesce(hours, 0)) as total_hours
from public.monthly_reports
group by person_id, year;

create view public.view_service_year_hours with (security_invoker = true) as
select person_id, service_year,
       sum(coalesce(hours, 0)) as total_hours,
       count(*) as reports,
       count(*) filter (where participated) as months_participated
from public.monthly_reports
group by person_id, service_year;

-- ---------------------------------------------------------------------
-- Meses con cargo de horas (PR/PA) y su meta mensual
-- ---------------------------------------------------------------------
-- Un renglón por persona y mes en que tuvo un cargo con informe de
-- horas. Un cargo vigente se proyecta hasta el cierre del año de
-- servicio en curso, para conocer la meta completa del año.
create view public.view_hours_role_months with (security_invoker = true) as
select distinct on (pr.person_id, m.period)
  pr.person_id,
  m.period::date                              as period,
  extract(year  from m.period)::smallint      as year,
  extract(month from m.period)::smallint      as month,
  public.service_year_of(m.period::date)      as service_year,
  pr.role_id,
  cr.code                                     as role_code,
  cr.name                                     as role_name,
  public.monthly_goal_for(pr.role_id, public.service_year_of(m.period::date)) as monthly_goal,
  (m.period < public.reporting_cutoff())      as is_closed
from public.person_roles pr
join public.catalog_roles cr on cr.id = pr.role_id and cr.requires_hours_report
cross join lateral generate_series(
  date_trunc('month', pr.start_date::timestamp),
  date_trunc('month', greatest(
    pr.start_date,
    coalesce(pr.end_date,
             upper(public.service_year_bounds(public.service_year_of(current_date))) - 1)
  )::timestamp),
  interval '1 month'
) as m(period)
order by pr.person_id, m.period, pr.start_date desc;

-- ---------------------------------------------------------------------
-- Cumplimiento de metas por persona, año de servicio y cargo
-- ---------------------------------------------------------------------
create view public.view_goal_compliance with (security_invoker = true) as
with base as (
  select
    m.person_id, m.service_year, m.role_id, m.role_code, m.role_name,
    count(*)                                              as months_in_role,
    count(*) filter (where m.is_closed)                   as months_closed,
    sum(m.monthly_goal)                                   as goal_hours,
    coalesce(sum(m.monthly_goal) filter (where m.is_closed), 0) as goal_to_date,
    coalesce(sum(r.hours), 0)                             as hours_done,
    count(r.id) filter (where m.is_closed)                as months_reported,
    count(*) filter (where m.is_closed and r.id is null)  as months_missing
  from public.view_hours_role_months m
  left join public.monthly_reports r
    on r.person_id = m.person_id and r.period = m.period
  group by m.person_id, m.service_year, m.role_id, m.role_code, m.role_name
)
select
  b.person_id, p.first_name, p.last_name,
  b.service_year, b.role_code, b.role_name,
  b.months_in_role, b.months_closed, b.months_reported, b.months_missing,
  round(b.goal_hours, 2)                                   as goal_hours,
  round(b.goal_to_date, 2)                                 as goal_to_date,
  b.hours_done,
  round(greatest(b.goal_hours - b.hours_done, 0), 2)       as hours_remaining,
  round(100 * b.hours_done / nullif(b.goal_hours, 0), 1)   as pct_goal,
  round(100 * b.hours_done / nullif(b.goal_to_date, 0), 1) as pct_to_date,
  case when b.months_in_role > b.months_closed
       then round(greatest(b.goal_hours - b.hours_done, 0) / (b.months_in_role - b.months_closed), 2)
  end                                                      as hours_needed_per_month,
  case
    when b.goal_hours is null                  then 'SIN META'
    when b.hours_done >= b.goal_hours          then 'CUMPLIDA'
    when b.months_closed = b.months_in_role    then 'NO CUMPLIDA'
    when b.hours_done >= b.goal_to_date        then 'AL DIA'
    else 'ATRASADO'
  end                                                      as status
from base b
join public.persons p on p.id = b.person_id;

-- ---------------------------------------------------------------------
-- Funciones parametrizadas para informes (se llaman vía supabase.rpc)
-- SECURITY INVOKER: respetan el RLS del usuario que consulta.
-- ---------------------------------------------------------------------

-- Matriz persona x mes de un año de servicio (meses cerrados).
-- Incluye a toda persona activa y a las inactivas que sí informaron.
create or replace function public.fn_report_matrix(p_service_year int)
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
  hours         numeric
)
language sql
stable
set search_path = public
as $$
  with months as (
    select m::date as period
    from generate_series(
      lower(service_year_bounds(p_service_year))::timestamp,
      least(upper(service_year_bounds(p_service_year)), reporting_cutoff())::timestamp - interval '1 month',
      interval '1 month') m
  ),
  people as (
    select p.* from persons p
    where p.is_active
       or exists (select 1 from monthly_reports r
                  where r.person_id = p.id and r.service_year = p_service_year)
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
    r.hours
  from people p
  cross join months m
  left join view_hours_role_months hm on hm.person_id = p.id and hm.period = m.period
  left join monthly_reports r on r.person_id = p.id and r.period = m.period
  order by p.last_name, p.first_name, m.period;
$$;

-- Completitud por persona en un año de servicio: cuántos meses cerrados
-- informó y en cuántos participó. Para quien no es PR/PA es la métrica
-- principal (sí/no por mes).
create or replace function public.fn_service_year_summary(p_service_year int)
returns table (
  person_id            uuid,
  first_name           text,
  last_name            text,
  group_name           text,
  current_roles        text,
  months_expected      int,
  months_reported      int,
  months_participated  int,
  pct_reported         numeric,
  pct_participated     numeric,
  total_hours          numeric
)
language sql
stable
set search_path = public
as $$
  select
    m.person_id, m.first_name, m.last_name,
    o.group_name, o.current_roles,
    count(*)::int,
    count(*) filter (where m.has_report)::int,
    count(*) filter (where m.participated)::int,
    round(100.0 * count(*) filter (where m.has_report)   / nullif(count(*), 0), 1),
    round(100.0 * count(*) filter (where m.participated) / nullif(count(*), 0), 1),
    coalesce(sum(m.hours), 0)
  from fn_report_matrix(p_service_year) m
  join view_persons_overview o on o.person_id = m.person_id
  group by m.person_id, m.first_name, m.last_name, o.group_name, o.current_roles
  order by m.last_name, m.first_name;
$$;

-- Resumen de la organización por mes: informes recibidos, participación
-- y horas, desglosado por grupo (el grupo que tenía cada persona ese mes).
create or replace function public.fn_monthly_summary(p_service_year int)
returns table (
  period              date,
  group_name          text,
  persons             int,
  reports_received    int,
  participated        int,
  pct_reported        numeric,
  hours_role_persons  int,
  total_hours         numeric
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
    coalesce(sum(m.hours), 0)
  from fn_report_matrix(p_service_year) m
  group by m.period, m.group_name
  order by m.period, m.group_name nulls last;
$$;
