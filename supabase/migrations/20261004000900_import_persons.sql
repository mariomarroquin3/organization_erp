-- =====================================================================
-- 0900 · IMPORTACIÓN DE PERSONAS DESDE EXCEL
-- =====================================================================
-- fn_import_persons(filas jsonb) da de alta varias personas con su grupo,
-- cargos, contactos y alta en UNA transacción: si una fila falla no se
-- guarda ninguna, y el error dice qué fila fue. La app valida y resuelve
-- los catálogos antes (web/lib/import); aquí mandan de todos modos las
-- restricciones y triggers de siempre (solapamientos PR/PA, fechas de
-- alta, etc.).
--
-- Cada elemento de filas:
--   { "row": 5, "first_name": "Ana", "last_name": "López",
--     "birth_date": "1990-05-01" | null, "notes": null,
--     "group_id": uuid | null, "group_start": "2026-09-01" | null,
--     "role_ids": [uuid, ...], "roles_start": "2026-09-01" | null,
--     "contacts": [{ "contact_type_id": uuid, "value": "..." }],
--     "alta": { "movement_type_id": uuid, "movement_date": "...",
--               "congregation": null } | null }
--
-- SECURITY INVOKER: corre con los permisos (RLS) de quien importa.
-- =====================================================================

create or replace function public.fn_import_persons(p_rows jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  r       jsonb;
  v_id    uuid;
  v_role  text;
  v_c     jsonb;
  v_count int := 0;
begin
  if not public.is_admin_or_above() then
    raise exception 'No tienes permiso para importar personas.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Formato de importación inválido.';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      insert into persons (first_name, last_name, birth_date, notes)
      values (btrim(r->>'first_name'), btrim(r->>'last_name'),
              (r->>'birth_date')::date, nullif(btrim(r->>'notes'), ''))
      returning id into v_id;

      if jsonb_typeof(r->'alta') = 'object' then
        insert into person_movements (person_id, movement_type_id, movement_date, congregation)
        values (v_id, (r->'alta'->>'movement_type_id')::uuid, (r->'alta'->>'movement_date')::date,
                nullif(btrim(r->'alta'->>'congregation'), ''));
      end if;

      if r->>'group_id' is not null then
        insert into person_group_history (person_id, group_id, start_date)
        values (v_id, (r->>'group_id')::uuid, coalesce((r->>'group_start')::date, current_date));
      end if;

      for v_role in select jsonb_array_elements_text(coalesce(r->'role_ids', '[]')) loop
        insert into person_roles (person_id, role_id, start_date)
        values (v_id, v_role::uuid, coalesce((r->>'roles_start')::date, current_date));
      end loop;

      for v_c in select * from jsonb_array_elements(coalesce(r->'contacts', '[]')) loop
        insert into person_contacts (person_id, contact_type_id, value, is_primary)
        values (v_id, (v_c->>'contact_type_id')::uuid, btrim(v_c->>'value'), true);
      end loop;

      v_count := v_count + 1;
    exception when others then
      raise exception 'Fila %: %', coalesce(r->>'row', '?'), sqlerrm using errcode = sqlstate;
    end;
  end loop;
  return v_count;
end $$;

revoke all on function public.fn_import_persons(jsonb) from public, anon;
grant execute on function public.fn_import_persons(jsonb) to authenticated;
