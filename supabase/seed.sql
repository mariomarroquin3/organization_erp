-- =====================================================================
-- DATOS DE DEMOSTRACIÓN (solo desarrollo local: `supabase db reset`)
-- =====================================================================
-- Año de servicio 2026 = sep-2025 a ago-2026 (completo y cerrado).
--   Ana   : PR todo el año, 50 h/mes        -> 600/600, CUMPLIDA
--   Beto  : PA sep-nov, PAI dic-ene, PR feb-ago, 40 h/mes; además PB todo el año
--           PA: 120/90 CUMPLIDA · PAI: 80/60 CUMPLIDA · PR: 280/350 NO CUMPLIDA
--   Carla : solo PB, informa sí/no; 10 de 12 meses; cambia de grupo en marzo
--   Diego : sin cargo, informa 6 meses
-- Cursos bíblicos: Ana 2 cada mes; Carla 1 en septiembre; el resto 0.
-- =====================================================================

insert into public.catalog_groups (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Grupo 1'),
  ('00000000-0000-0000-0000-0000000000a2', 'Grupo 2');

insert into public.persons (id, first_name, last_name) values
  ('00000000-0000-0000-0000-000000000001', 'Ana',   'López'),
  ('00000000-0000-0000-0000-000000000002', 'Beto',  'Ruiz'),
  ('00000000-0000-0000-0000-000000000003', 'Carla', 'Méndez'),
  ('00000000-0000-0000-0000-000000000004', 'Diego', 'Paz');

insert into public.person_group_history (person_id, group_id, start_date, end_date) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '2024-01-01', null),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', '2024-01-01', null),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', '2024-01-01', '2026-02-28'),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a2', '2026-03-01', null),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a2', '2024-01-01', null);

insert into public.person_roles (person_id, role_id, start_date, end_date)
select v.person_id::uuid, cr.id, v.start_date::date, v.end_date::date
from (values
  ('00000000-0000-0000-0000-000000000001', 'PR', '2025-09-01', null),
  ('00000000-0000-0000-0000-000000000002', 'PA', '2025-09-01', '2025-11-30'),
  ('00000000-0000-0000-0000-000000000002', 'PAI', '2025-12-01', '2026-01-31'),
  ('00000000-0000-0000-0000-000000000002', 'PR', '2026-02-01', '2026-08-31'),
  ('00000000-0000-0000-0000-000000000002', 'PB', '2025-09-01', null),
  ('00000000-0000-0000-0000-000000000003', 'PB', '2025-09-01', null)
) as v(person_id, code, start_date, end_date)
join public.catalog_roles cr on cr.code = v.code;

-- 12 meses del año de servicio 2026
with months as (
  select extract(year from m)::smallint as y, extract(month from m)::smallint as mo, row_number() over (order by m) as n
  from generate_series('2025-09-01'::timestamp, '2026-08-01'::timestamp, interval '1 month') m
)
insert into public.monthly_reports (person_id, year, month, participated, hours)
select '00000000-0000-0000-0000-000000000001'::uuid, y, mo, true, 50 from months
union all
select '00000000-0000-0000-0000-000000000002'::uuid, y, mo, true, 40 from months
union all
select '00000000-0000-0000-0000-000000000003'::uuid, y, mo, true, null from months where n <= 10
union all
select '00000000-0000-0000-0000-000000000004'::uuid, y, mo, (n % 2 = 0), null from months where n <= 6;

update public.monthly_reports set bible_studies = 2
where person_id = '00000000-0000-0000-0000-000000000001';
update public.monthly_reports set bible_studies = 1
where person_id = '00000000-0000-0000-0000-000000000003' and year = 2025 and month = 9;
