-- =====================================================================
-- 0800 · ALTAS, BAJAS Y TRASLADOS · BORRADO LÓGICO
-- =====================================================================
-- Migración incremental sobre 0100-0700 (ya aplicadas en producción).
--
--   * person_movements: altas (nuevo ingreso, traslado desde otra
--     congregación, reingreso) y bajas (traslado a otra congregación,
--     fallecimiento, etc.) con fecha y congregación de origen o destino.
--   * Las altas y bajas de una persona se alternan. persons.is_active
--     pasa a ser un dato derivado: lo mantiene la última alta/baja y no
--     se cambia a mano.
--   * Una baja cierra los cargos y el grupo vigentes el día anterior.
--   * Periodos de pertenencia (view_membership_periods): las métricas e
--     informes solo cuentan los meses en que la persona era miembro.
--     Un mes cuenta si estuvo activa al menos un día de ese mes.
--   * Borrado físico bloqueado para personas con historial; sus FKs
--     pasan de ON DELETE CASCADE a RESTRICT.
--
-- Convención de fechas: la fecha de una baja es el primer día en que la
-- persona ya no pertenece (su último día es el anterior), igual que la
-- fecha de un alta es el primer día en que sí pertenece.
-- =====================================================================

-- =====================================================================
-- 1. CATÁLOGO DE TIPOS DE ALTA/BAJA
-- =====================================================================
create table public.catalog_movement_types (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique check (code = upper(code)),
  name                  text not null,
  direction             text not null check (direction in ('ALTA', 'BAJA')),
  -- Traslados: exige congregación de origen (alta) o destino (baja)
  requires_congregation boolean not null default false,
  is_active             boolean not null default true,
  sort_order            smallint not null default 100,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_catalog_movement_types_updated_at
before update on public.catalog_movement_types
for each row execute function public.set_updated_at();

insert into public.catalog_movement_types (code, name, direction, requires_congregation, sort_order) values
  ('NUEVO_INGRESO',      'Nuevo ingreso',                      'ALTA', false, 10),
  ('TRASLADO_ENTRADA',   'Traslado desde otra congregación',   'ALTA', true,  20),
  ('REINGRESO',          'Reingreso',                          'ALTA', false, 30),
  ('TRASLADO_SALIDA',    'Traslado a otra congregación',       'BAJA', true,  40),
  ('FALLECIMIENTO',      'Fallecimiento',                      'BAJA', false, 50),
  ('DEJO_DE_PARTICIPAR', 'Dejó de participar',                 'BAJA', false, 60),
  ('OTRA_BAJA',          'Otra baja',                          'BAJA', false, 70)
on conflict (code) do nothing;

-- No cambiar la dirección de un tipo ya usado: rompería la alternancia
create or replace function public.check_movement_type_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.direction <> old.direction
     and exists (select 1 from person_movements where movement_type_id = old.id) then
    raise exception 'No se puede cambiar de alta a baja (o al revés) un tipo que ya tiene registros.';
  end if;
  return new;
end;
$$;

-- =====================================================================
-- 2. ALTAS Y BAJAS
-- =====================================================================
create table public.person_movements (
  id               uuid primary key default gen_random_uuid(),
  person_id        uuid not null references public.persons(id) on delete restrict,
  movement_type_id uuid not null references public.catalog_movement_types(id),
  movement_date    date not null,
  -- Congregación de origen (alta) o de destino (baja)
  congregation     text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint uq_person_movements_date unique (person_id, movement_date)
);
create trigger trg_person_movements_updated_at
before update on public.person_movements
for each row execute function public.set_updated_at();

create index idx_person_movements_date on public.person_movements (movement_date);
create index idx_person_movements_type on public.person_movements (movement_type_id);

create trigger trg_check_movement_type_change
before update of direction on public.catalog_movement_types
for each row execute function public.check_movement_type_change();

-- Estado actual derivado: activo si su última alta/baja es un alta, o
-- si nunca tuvo ninguna (miembros cargados antes de esta migración).
create or replace function public.person_is_active_now(p_person_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((
    select t.direction = 'ALTA'
    from person_movements pm
    join catalog_movement_types t on t.id = pm.movement_type_id
    where pm.person_id = p_person_id
    order by pm.movement_date desc
    limit 1
  ), true);
$$;

-- Validaciones de cada registro
create or replace function public.check_person_movement()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_type catalog_movement_types%rowtype;
begin
  if tg_op = 'UPDATE' and new.person_id <> old.person_id then
    raise exception 'Un alta o baja no se puede pasar a otra persona; elimínala y regístrala de nuevo.';
  end if;

  -- Serializa altas/bajas de una misma persona
  perform pg_advisory_xact_lock(hashtextextended('person_movements:' || new.person_id::text, 0));

  select * into v_type from catalog_movement_types where id = new.movement_type_id;

  if new.movement_date > current_date then
    raise exception using errcode = '23514',
      message = 'La fecha de un alta o baja no puede ser futura.';
  end if;

  new.congregation := nullif(btrim(new.congregation), '');
  if v_type.requires_congregation and new.congregation is null then
    raise exception using errcode = '23514',
      message = format('Para "%s" indica la congregación de %s.', v_type.name,
                       case v_type.direction when 'ALTA' then 'origen' else 'destino' end);
  end if;

  return new;
end;
$$;

create trigger trg_check_person_movement
before insert or update on public.person_movements
for each row execute function public.check_person_movement();

-- Después de cada cambio: alternancia, cierre de periodos y estado
create or replace function public.apply_person_movement()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_person_id uuid := case when tg_op = 'DELETE' then old.person_id else new.person_id end;
  v_bad       record;
  v_direction text;
  v_blocking  text;
begin
  -- Altas y bajas deben alternarse en el tiempo
  select s.movement_date, s.direction into v_bad
  from (
    select pm.movement_date, t.direction,
           lag(t.direction) over (order by pm.movement_date) as prev_direction
    from person_movements pm
    join catalog_movement_types t on t.id = pm.movement_type_id
    where pm.person_id = v_person_id
  ) s
  where s.direction = s.prev_direction
  limit 1;

  if found then
    raise exception using errcode = '23514',
      message = format('Las altas y bajas deben alternarse: el %s quedaría una %s después de otra %s.',
                       to_char(v_bad.movement_date, 'DD/MM/YYYY'), lower(v_bad.direction), lower(v_bad.direction));
  end if;

  -- Una baja que es el último movimiento cierra cargos y grupo vigentes.
  -- (La migración la omite al registrar bajas de personas ya inactivas.)
  if tg_op <> 'DELETE'
     and coalesce(current_setting('erp.skip_movement_autoclose', true), '') <> 'on' then
    select direction into v_direction from catalog_movement_types where id = new.movement_type_id;

    if v_direction = 'BAJA' and not exists (
      select 1 from person_movements
      where person_id = new.person_id and movement_date > new.movement_date
    ) then
      select coalesce(
        (select 'el cargo ' || cr.code from person_roles pr join catalog_roles cr on cr.id = pr.role_id
          where pr.person_id = new.person_id and pr.start_date >= new.movement_date limit 1),
        (select 'el grupo ' || cg.name from person_group_history h join catalog_groups cg on cg.id = h.group_id
          where h.person_id = new.person_id and h.start_date >= new.movement_date limit 1))
      into v_blocking;

      if v_blocking is not null then
        raise exception using errcode = '23514',
          message = format('La persona tiene %s desde el %s o después: corrígelo antes de registrar la baja.',
                           v_blocking, to_char(new.movement_date, 'DD/MM/YYYY'));
      end if;

      update person_roles set end_date = new.movement_date - 1
       where person_id = new.person_id and (end_date is null or end_date >= new.movement_date);
      update person_group_history set end_date = new.movement_date - 1
       where person_id = new.person_id and (end_date is null or end_date >= new.movement_date);
    end if;
  end if;

  update persons set is_active = person_is_active_now(v_person_id)
   where id = v_person_id and is_active is distinct from person_is_active_now(v_person_id);

  return null;
end;
$$;

create trigger trg_apply_person_movement
after insert or update or delete on public.person_movements
for each row execute function public.apply_person_movement();

-- =====================================================================
-- 3. persons.is_active YA NO SE CAMBIA A MANO
-- =====================================================================
-- Registro de bajas para quienes ya estaban inactivos sin fecha: se usa
-- la última modificación como mejor estimación. Sin cierre automático
-- de periodos para no alterar su historial.
select set_config('erp.skip_movement_autoclose', 'on', true);

insert into public.person_movements (person_id, movement_type_id, movement_date, notes)
select p.id, t.id, least(p.updated_at::date, current_date),
       'Registrada al instalar altas y bajas: ya estaba inactiva. Corrige la fecha y el motivo si los conoces.'
from public.persons p
cross join public.catalog_movement_types t
where t.code = 'OTRA_BAJA'
  and not p.is_active
  and not exists (select 1 from public.person_movements pm where pm.person_id = p.id);

select set_config('erp.skip_movement_autoclose', 'off', true);

create or replace function public.guard_person_is_active()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not new.is_active then
      raise exception using errcode = '23514',
        message = 'Una persona nueva se crea activa. Para darla de baja registra una baja en su ficha.';
    end if;
  elsif new.is_active is distinct from old.is_active
        and new.is_active is distinct from person_is_active_now(new.id) then
    raise exception using errcode = '23514',
      message = 'El estado activo/inactivo se cambia registrando una baja o un alta en la ficha de la persona.';
  end if;
  return new;
end;
$$;

create trigger trg_guard_person_is_active
before insert or update of is_active on public.persons
for each row execute function public.guard_person_is_active();

-- =====================================================================
-- 4. BORRADO FÍSICO BLOQUEADO
-- =====================================================================
-- Solo se puede borrar a alguien capturado por error, sin historial.
create or replace function public.guard_person_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from monthly_reports      where person_id = old.id)
  or exists (select 1 from person_roles         where person_id = old.id)
  or exists (select 1 from person_group_history where person_id = old.id)
  or exists (select 1 from person_movements     where person_id = old.id) then
    raise exception using
      message = 'No se puede eliminar a una persona con historial (informes, cargos, grupos o altas/bajas). Registra una baja.';
  end if;
  return old;
end;
$$;

create trigger trg_guard_person_delete
before delete on public.persons
for each row execute function public.guard_person_delete();

-- El historial ya no se borra en cascada (contactos y fechas sí)
do $$
declare
  t text;
  c text;
begin
  foreach t in array array['monthly_reports', 'person_roles', 'person_group_history'] loop
    for c in
      select con.conname
      from pg_constraint con
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any (con.conkey)
      where con.contype = 'f'
        and con.conrelid = format('public.%I', t)::regclass
        and con.confrelid = 'public.persons'::regclass
        and a.attname = 'person_id'
    loop
      execute format('alter table public.%I drop constraint %I', t, c);
    end loop;
    execute format(
      'alter table public.%1$I add constraint %1$s_person_id_fkey
         foreign key (person_id) references public.persons(id) on delete restrict', t);
  end loop;
end $$;

-- =====================================================================
-- 5. PERIODOS DE PERTENENCIA Y MÉTRICAS
-- =====================================================================
-- Un renglón por periodo en que la persona era miembro. end_date es
-- inclusivo; NULL en start_date o end_date significa sin límite.
create view public.view_membership_periods with (security_invoker = true) as
with mv as (
  select pm.person_id, pm.movement_date, t.direction,
         lead(pm.movement_date) over w as next_date,
         row_number() over w           as rn
  from public.person_movements pm
  join public.catalog_movement_types t on t.id = pm.movement_type_id
  window w as (partition by pm.person_id order by pm.movement_date)
)
-- Cada alta abre un periodo hasta la siguiente baja
select person_id, movement_date as start_date, next_date - 1 as end_date
from mv where direction = 'ALTA'
union all
-- Si lo primero es una baja, era miembro desde siempre hasta ese día
select person_id, null::date, movement_date - 1
from mv where direction = 'BAJA' and rn = 1
union all
-- Sin altas ni bajas: miembro sin límite
select p.id, null::date, null::date
from public.persons p
where not exists (select 1 from public.person_movements pm where pm.person_id = p.id);

-- ¿Fue miembro al menos un día entre p_from y p_to (inclusivos)?
create or replace function public.was_member_during(p_person_id uuid, p_from date, p_to date)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from view_membership_periods mp
    where mp.person_id = p_person_id
      and daterange(mp.start_date, mp.end_date, '[]') && daterange(p_from, p_to, '[]')
  );
$$;

-- Meses con cargo de horas: solo los meses en que era miembro
create or replace view public.view_hours_role_months with (security_invoker = true) as
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
where public.was_member_during(pr.person_id, m.period::date,
                               (m.period + interval '1 month' - interval '1 day')::date)
order by pr.person_id, m.period, pr.start_date desc;

-- Ficha resumida: se agregan la última alta/baja al final
create or replace view public.view_persons_overview with (security_invoker = true) as
select
  p.id as person_id, p.first_name, p.last_name, p.is_active, p.birth_date,
  g.group_id, g.group_name,
  (select string_agg(r.role_code, ', ' order by cr.sort_order, r.role_code)
     from public.view_current_roles r
     join public.catalog_roles cr on cr.id = r.role_id
    where r.person_id = p.id) as current_roles,
  (select r.role_code from public.view_current_roles r
    where r.person_id = p.id and r.requires_hours_report limit 1) as current_hours_role,
  lm.type_name     as last_movement_type,
  lm.movement_date as last_movement_date
from public.persons p
left join public.view_current_group g on g.person_id = p.id
left join lateral (
  select t.name as type_name, pm.movement_date
  from public.person_movements pm
  join public.catalog_movement_types t on t.id = pm.movement_type_id
  where pm.person_id = p.id
  order by pm.movement_date desc
  limit 1
) lm on true;

-- Altas y bajas legibles, con su año de servicio
create view public.view_person_movements with (security_invoker = true) as
select pm.id, pm.person_id, p.first_name, p.last_name,
       pm.movement_type_id, t.code as type_code, t.name as type_name, t.direction,
       pm.movement_date, public.service_year_of(pm.movement_date) as service_year,
       pm.congregation, pm.notes, pm.created_at
from public.person_movements pm
join public.persons p on p.id = pm.person_id
join public.catalog_movement_types t on t.id = pm.movement_type_id;

-- Matriz persona x mes: solo meses en que era miembro, o con informe
create or replace function public.fn_report_matrix(p_service_year int)
returns table (
  person_id     uuid,
  first_name    text,
  last_name     text,
  group_name    text,
  period        date,
  year          smallint,
  month         smallint,
  hours_role    text,
  has_report    boolean,
  participated  boolean,
  hours         numeric
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
    r.hours
  from persons p
  cross join months m
  left join view_hours_role_months hm on hm.person_id = p.id and hm.period = m.period
  left join monthly_reports r on r.person_id = p.id and r.period = m.period
  where r.id is not null
     or was_member_during(p.id, m.period, m.last_day)
  order by p.last_name, p.first_name, m.period;
$$;

-- =====================================================================
-- 6. SEGURIDAD Y BITÁCORA
-- =====================================================================
alter table public.catalog_movement_types enable row level security;
alter table public.person_movements       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['catalog_movement_types', 'person_movements'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_app_user())', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_admin_or_above())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_admin_or_above()) with check (public.is_admin_or_above())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_admin_or_above())', t || '_delete', t);
  end loop;
end $$;

create trigger trg_audit_person_movements
after insert or update or delete on public.person_movements
for each row execute function public.audit_row_change();

revoke all on public.catalog_movement_types, public.person_movements,
              public.view_membership_periods, public.view_person_movements from anon;
revoke execute on function public.person_is_active_now(uuid), public.was_member_during(uuid, date, date) from anon;

grant select, insert, update, delete on public.catalog_movement_types, public.person_movements to authenticated;
grant select on public.view_membership_periods, public.view_person_movements to authenticated;
grant execute on function public.person_is_active_now(uuid), public.was_member_during(uuid, date, date) to authenticated;
