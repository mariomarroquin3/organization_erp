-- =====================================================================
-- 0100 · NÚCLEO: catálogos, personas, grupos, cargos, usuarios
-- =====================================================================
-- Basado en el schema.sql original. Cambios principales:
--   * Exclusion constraints (btree_gist) para impedir periodos que se
--     solapen, no solo dos periodos abiertos a la vez.
--   * check_single_hours_role compara rangos de fechas completos y
--     toma un lock por persona para evitar carreras.
--   * Funciones con search_path fijo (recomendación del linter de Supabase).
-- Convención: end_date es INCLUSIVO y NULL significa "vigente".
-- =====================================================================

create extension if not exists pgcrypto;                      -- gen_random_uuid()
create extension if not exists btree_gist with schema extensions; -- exclusion constraints con uuid

-- ---------------------------------------------------------------------
-- updated_at genérico
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =====================================================================
-- 1. CATÁLOGOS
-- =====================================================================

create table public.catalog_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_catalog_groups_updated_at
before update on public.catalog_groups
for each row execute function public.set_updated_at();

-- Cargos. requires_hours_report = true para los cargos que reportan
-- horas y tienen meta (PR, PA). El resto solo reporta si participó.
create table public.catalog_roles (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique check (code = upper(code)),
  name                  text not null,
  requires_hours_report boolean not null default false,
  is_active             boolean not null default true,
  sort_order            smallint not null default 100,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_catalog_roles_updated_at
before update on public.catalog_roles
for each row execute function public.set_updated_at();

create table public.catalog_contact_types (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code = upper(code)),
  name       text not null,
  created_at timestamptz not null default now()
);

create table public.catalog_date_types (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code = upper(code)),
  name       text not null,
  created_at timestamptz not null default now()
);

-- Niveles de acceso a la aplicación (no son cargos de la organización)
create table public.catalog_system_roles (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  created_at timestamptz not null default now()
);

insert into public.catalog_system_roles (code, name) values
  ('SUPERADMIN', 'Super administrador'),
  ('ADMIN',      'Administrador'),
  ('READER',     'Lector');

-- =====================================================================
-- 2. PERSONAS
-- =====================================================================

create table public.persons (
  id         uuid primary key default gen_random_uuid(),
  first_name text not null check (btrim(first_name) <> ''),
  last_name  text not null check (btrim(last_name) <> ''),
  birth_date date,
  is_active  boolean not null default true,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_persons_updated_at
before update on public.persons
for each row execute function public.set_updated_at();

create index idx_persons_is_active on public.persons (is_active);
create index idx_persons_last_name on public.persons (last_name, first_name);

create table public.person_contacts (
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid not null references public.persons(id) on delete cascade,
  contact_type_id uuid not null references public.catalog_contact_types(id),
  value           text not null check (btrim(value) <> ''),
  is_primary      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_person_contacts_updated_at
before update on public.person_contacts
for each row execute function public.set_updated_at();

create index idx_person_contacts_person_id on public.person_contacts (person_id);
create unique index uq_person_contacts_type_value
  on public.person_contacts (person_id, contact_type_id, value);
-- Un solo contacto principal por persona y tipo
create unique index uq_person_contacts_primary
  on public.person_contacts (person_id, contact_type_id)
  where is_primary;

create table public.person_dates (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references public.persons(id) on delete cascade,
  date_type_id uuid not null references public.catalog_date_types(id),
  date_value   date not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint uq_person_dates_type unique (person_id, date_type_id)
);
create trigger trg_person_dates_updated_at
before update on public.person_dates
for each row execute function public.set_updated_at();

-- =====================================================================
-- 3. HISTORIAL DE GRUPOS (un grupo a la vez, sin solapamientos)
-- =====================================================================

create table public.person_group_history (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references public.persons(id) on delete cascade,
  group_id   uuid not null references public.catalog_groups(id),
  start_date date not null,
  end_date   date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_group_dates check (end_date is null or end_date >= start_date),
  -- Ningún par de periodos de la misma persona puede solaparse
  -- (cubre también "solo un grupo abierto").
  constraint ex_pgh_no_overlap exclude using gist (
    person_id with =,
    daterange(start_date, end_date, '[]') with &&
  )
);
create trigger trg_person_group_history_updated_at
before update on public.person_group_history
for each row execute function public.set_updated_at();

create index idx_pgh_group_id on public.person_group_history (group_id);

-- =====================================================================
-- 4. HISTORIAL DE CARGOS
-- =====================================================================

create table public.person_roles (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references public.persons(id) on delete cascade,
  role_id    uuid not null references public.catalog_roles(id),
  start_date date not null,
  end_date   date,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_role_dates check (end_date is null or end_date >= start_date),
  -- El mismo cargo no puede tener periodos solapados en la misma persona
  constraint ex_pr_same_role_no_overlap exclude using gist (
    person_id with =,
    role_id   with =,
    daterange(start_date, end_date, '[]') with &&
  )
);
create trigger trg_person_roles_updated_at
before update on public.person_roles
for each row execute function public.set_updated_at();

create index idx_pr_role_id on public.person_roles (role_id);
create index idx_pr_current on public.person_roles (person_id) where end_date is null;

-- Dos cargos con informe de horas (PR y PA) no pueden solaparse en
-- el tiempo para la misma persona. Depende de catalog_roles, por eso
-- es un trigger y no una constraint.
create or replace function public.check_single_hours_role()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_requires  boolean;
  v_conflict  text;
begin
  select requires_hours_report into v_requires
  from catalog_roles where id = new.role_id;

  if not coalesce(v_requires, false) then
    return new;
  end if;

  -- Serializa cambios de cargos de una misma persona
  perform pg_advisory_xact_lock(hashtextextended(new.person_id::text, 0));

  select cr.code into v_conflict
  from person_roles pr
  join catalog_roles cr on cr.id = pr.role_id
  where pr.person_id = new.person_id
    and pr.id <> new.id
    and cr.requires_hours_report
    and daterange(pr.start_date, pr.end_date, '[]')
        && daterange(new.start_date, new.end_date, '[]')
  limit 1;

  if v_conflict is not null then
    raise exception using
      errcode = '23P01',
      message = format(
        'La persona ya tiene el cargo %s en un periodo que se solapa. '
        'Un mismo periodo no puede tener dos cargos con informe de horas (PR/PA).',
        v_conflict);
  end if;

  return new;
end;
$$;

create trigger trg_check_single_hours_role
before insert or update of person_id, role_id, start_date, end_date on public.person_roles
for each row execute function public.check_single_hours_role();

-- No permitir que un cargo pase a requerir horas si eso crea
-- solapamientos ya existentes con otro cargo de horas.
create or replace function public.check_role_hours_flag_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.requires_hours_report and not old.requires_hours_report and exists (
    select 1
    from person_roles a
    join person_roles b
      on b.person_id = a.person_id and b.id <> a.id
    join catalog_roles cb on cb.id = b.role_id
    where a.role_id = new.id
      and cb.requires_hours_report
      and daterange(a.start_date, a.end_date, '[]')
          && daterange(b.start_date, b.end_date, '[]')
  ) then
    raise exception 'No se puede marcar % como cargo con horas: hay personas con periodos solapados con otro cargo de horas.', new.code;
  end if;
  return new;
end;
$$;

create trigger trg_check_role_hours_flag_change
before update of requires_hours_report on public.catalog_roles
for each row execute function public.check_role_hours_flag_change();

-- =====================================================================
-- 5. USUARIOS DE LA APLICACIÓN (Supabase Auth)
-- =====================================================================
-- person_id es opcional: una cuenta técnica (p. ej. la del encargado
-- que configura el sistema) no tiene por qué ser un miembro.

create table public.app_users (
  id             uuid primary key references auth.users(id) on delete cascade,
  person_id      uuid references public.persons(id) on delete restrict,
  system_role_id uuid not null references public.catalog_system_roles(id),
  display_name   text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint uq_app_users_person unique (person_id)
);
create trigger trg_app_users_updated_at
before update on public.app_users
for each row execute function public.set_updated_at();

create index idx_app_users_system_role_id on public.app_users (system_role_id);
