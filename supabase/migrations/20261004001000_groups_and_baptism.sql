-- =====================================================================
-- 1000 · REAGRUPACIONES Y CARGOS A, SM, PNB
-- =====================================================================
-- Migración incremental sobre 0100-0900.
--
--   * fn_reassign_groups: cambia de grupo a varias personas a partir de
--     una fecha en una sola transacción (reagrupación) y, si se pide,
--     desactiva los grupos que quedan vacíos. El periodo anterior se
--     cierra el día antes, así que el historial (y las métricas por
--     grupo de los meses pasados) no cambia.
--   * Un grupo no se puede desactivar mientras tenga personas; borrar
--     un grupo con historial ya estaba bloqueado por la FK.
--   * Catálogo: A (anciano), SM (siervo ministerial), PNB (publicador no
--     bautizado). Son cargos sin horas, con historial por periodos.
--   * Regla del bautismo: quien es PB nunca vuelve a ser PNB. Al darle
--     PB a alguien con PNB vigente, el PNB se cierra el día anterior.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Grupos: no desactivar con personas dentro
-- ---------------------------------------------------------------------
create or replace function public.check_group_deactivation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_count int;
begin
  if old.is_active and not new.is_active then
    select count(*) into v_count
    from person_group_history h
    where h.group_id = new.id
      and h.end_date is null;
    if v_count > 0 then
      raise exception using errcode = '23514',
        message = format('El grupo %s todavía tiene %s persona(s). Muévelas a otro grupo (Reagrupar) antes de desactivarlo.',
                         new.name, v_count);
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_check_group_deactivation
before update of is_active on public.catalog_groups
for each row execute function public.check_group_deactivation();

-- ---------------------------------------------------------------------
-- 2. Reagrupación en bloque
-- ---------------------------------------------------------------------
-- p_moves: [{ "person_id": uuid, "group_id": uuid | null }]
--   group_id null = queda sin grupo desde p_date.
-- p_deactivate: grupos a desactivar al final (deben quedar vacíos).
create or replace function public.fn_reassign_groups(p_date date, p_moves jsonb, p_deactivate uuid[] default '{}')
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  m        jsonb;
  v_person uuid;
  v_group  uuid;
  v_name   text;
  cur      record;
  v_count  int := 0;
begin
  if not public.is_admin_or_above() then
    raise exception 'No tienes permiso para cambiar grupos.' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'Indica la fecha del cambio.';
  end if;

  for m in select * from jsonb_array_elements(coalesce(p_moves, '[]')) loop
    v_person := (m->>'person_id')::uuid;
    v_group  := (m->>'group_id')::uuid;
    select p.last_name || ', ' || p.first_name into v_name from persons p where p.id = v_person;
    if v_name is null then
      raise exception 'Una de las personas ya no existe.';
    end if;

    begin
      -- Periodo vigente en la fecha del cambio (o que empieza después)
      select * into cur from person_group_history h
      where h.person_id = v_person and (h.end_date is null or h.end_date >= p_date)
      order by h.start_date desc limit 1;

      if found and cur.start_date > p_date then
        raise exception 'tiene un cambio de grupo posterior (%); corrígelo desde su ficha.', to_char(cur.start_date, 'DD/MM/YYYY');
      end if;

      if found and cur.group_id is not distinct from v_group then
        continue;  -- ya está en ese grupo
      end if;

      if found and cur.start_date = p_date then
        -- El periodo empezó ese mismo día: se corrige en lugar de cerrarlo
        if v_group is null then
          delete from person_group_history where id = cur.id;
        else
          update person_group_history set group_id = v_group where id = cur.id;
        end if;
      else
        if found then
          update person_group_history set end_date = p_date - 1 where id = cur.id;
        end if;
        if v_group is not null then
          insert into person_group_history (person_id, group_id, start_date)
          values (v_person, v_group, p_date);
        end if;
      end if;
      v_count := v_count + 1;
    exception when others then
      raise exception '%: %', v_name, sqlerrm using errcode = sqlstate;
    end;
  end loop;

  update catalog_groups set is_active = false
  where id = any(coalesce(p_deactivate, '{}')) and is_active;

  return v_count;
end;
$$;

revoke all on function public.fn_reassign_groups(date, jsonb, uuid[]) from public, anon;
grant execute on function public.fn_reassign_groups(date, jsonb, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Cargos A, SM, PNB
-- ---------------------------------------------------------------------
insert into public.catalog_roles (code, name, requires_hours_report, sort_order) values
  ('A',   'Anciano',                false, 40),
  ('SM',  'Siervo ministerial',     false, 50),
  ('PNB', 'Publicador no bautizado', false, 25)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 4. Bautismo: PB es definitivo, nunca se vuelve a PNB
-- ---------------------------------------------------------------------
create or replace function public.check_baptism_rule()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_code text;
  v_pb   date;
  v_pnb  record;
begin
  select code into v_code from catalog_roles where id = new.role_id;
  if v_code not in ('PB', 'PNB') then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.person_id::text, 0));

  if v_code = 'PNB' then
    -- Primer PB de la persona (fecha de bautismo registrada)
    select min(pr.start_date) into v_pb
    from person_roles pr join catalog_roles cr on cr.id = pr.role_id
    where pr.person_id = new.person_id and cr.code = 'PB' and pr.id <> new.id;
    if v_pb is not null and coalesce(new.end_date, 'infinity'::date) >= v_pb then
      raise exception using errcode = '23514',
        message = format('La persona es PB desde el %s; un publicador bautizado no vuelve a ser PNB.',
                         to_char(v_pb, 'DD/MM/YYYY'));
    end if;
    return new;
  end if;

  -- PB: un PNB que empieza el mismo día o después es un error
  if exists (
    select 1 from person_roles pr join catalog_roles cr on cr.id = pr.role_id
    where pr.person_id = new.person_id and cr.code = 'PNB' and pr.id <> new.id
      and pr.start_date >= new.start_date
  ) then
    raise exception using errcode = '23514',
      message = 'La persona tiene un periodo PNB que empieza en o después de esta fecha de PB; un publicador bautizado no vuelve a ser PNB.';
  end if;

  -- El PNB anterior termina el día antes del PB (alta como bautizado)
  for v_pnb in
    select pr.id from person_roles pr join catalog_roles cr on cr.id = pr.role_id
    where pr.person_id = new.person_id and cr.code = 'PNB' and pr.id <> new.id
      and pr.start_date < new.start_date
      and coalesce(pr.end_date, 'infinity'::date) >= new.start_date
  loop
    update person_roles set end_date = new.start_date - 1 where id = v_pnb.id;
  end loop;
  return new;
end;
$$;

create trigger trg_check_baptism_rule
before insert or update of person_id, role_id, start_date, end_date on public.person_roles
for each row execute function public.check_baptism_rule();
