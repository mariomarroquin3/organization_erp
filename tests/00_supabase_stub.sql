-- Simula lo mínimo de Supabase para probar en un Postgres 15+ normal.
-- NO se aplica en Supabase (allí ya existen auth, roles y extensions).
do $$ begin
  -- Los roles son globales al cluster: crearlos solo si no existen
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema extensions;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth, public to anon, authenticated;
-- Igual que Supabase: privilegios por defecto amplios para anon
alter default privileges in schema public grant all on tables to anon, authenticated;
