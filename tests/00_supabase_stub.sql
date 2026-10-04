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
-- Igual que Supabase: acepta el claim suelto (pruebas SQL) o el JSON
-- completo que pone PostgREST en request.jwt.claims.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
grant usage on schema auth, public to anon, authenticated;
-- Igual que Supabase: privilegios por defecto amplios para anon
alter default privileges in schema public grant all on tables to anon, authenticated;
