-- =====================================================================
-- 0700 · CATÁLOGOS INICIALES (producción)
-- =====================================================================
-- Valores de partida; Javier puede editarlos desde la app.
-- Las vistas dependen de los códigos exactos 'PR' y 'PA'.
-- =====================================================================

insert into public.catalog_roles (code, name, requires_hours_report, sort_order) values
  ('PR', 'PR', true,  10),
  ('PA', 'PA', true,  20),
  ('PB', 'PB', false, 30)
on conflict (code) do nothing;

-- Metas de horas desde el año de servicio 2026 (sep-2025 a ago-2026).
-- POR CONFIRMAR CON JAVIER: valores de ejemplo.
insert into public.role_hour_goals (role_id, effective_from_sy, annual_hours, monthly_hours, notes)
select id, 2026, 600, null, 'Meta anual; se prorratea por meses con el cargo. Valor por confirmar.'
from public.catalog_roles where code = 'PR'
on conflict (role_id, effective_from_sy) do nothing;

insert into public.role_hour_goals (role_id, effective_from_sy, annual_hours, monthly_hours, notes)
select id, 2026, null, 30, 'Meta por mes con el cargo. Valor por confirmar.'
from public.catalog_roles where code = 'PA'
on conflict (role_id, effective_from_sy) do nothing;

insert into public.catalog_contact_types (code, name) values
  ('PHONE',           'Teléfono'),
  ('EMAIL',           'Correo electrónico'),
  ('ADDRESS',         'Dirección'),
  ('EMERGENCY_PHONE', 'Teléfono de emergencia')
on conflict (code) do nothing;

insert into public.catalog_date_types (code, name) values
  ('MEMBERSHIP_DATE', 'Fecha de ingreso'),
  ('BAPTISM_DATE',    'Fecha de bautismo'),
  ('ANNIVERSARY',     'Aniversario')
on conflict (code) do nothing;
