\set ON_ERROR_STOP on

begin;

create extension if not exists pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login text not null unique,
  name text not null,
  role text not null,
  is_active boolean not null default true
);

\ir ../supabase/migrations/20260720193000_section_maintenance.sql

DO $$
DECLARE
  seeded_count integer;
BEGIN
  SELECT count(*) INTO seeded_count FROM public.section_maintenance;
  IF seeded_count <> 9 THEN
    RAISE EXCEPTION 'Expected 9 seeded maintenance rows, got %', seeded_count;
  END IF;

  IF has_table_privilege('anon', 'public.section_maintenance', 'SELECT') THEN
    RAISE EXCEPTION 'anon must not have SELECT on section_maintenance';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.section_maintenance', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated must have SELECT on section_maintenance';
  END IF;

  IF has_table_privilege('authenticated', 'public.section_maintenance', 'INSERT')
     OR has_table_privilege('authenticated', 'public.section_maintenance', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.section_maintenance', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated clients must be read-only for section_maintenance';
  END IF;

  BEGIN
    INSERT INTO public.section_maintenance(section_id, is_closed)
    VALUES ('home', true);
    RAISE EXCEPTION 'Protected/unknown section passed the check constraint';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END
$$;

insert into auth.users(id)
values ('11111111-1111-4111-8111-111111111111');

insert into public.profiles(id, login, name, role, is_active)
values ('11111111-1111-4111-8111-111111111111', 'preview-admin', 'Preview Admin', 'admin', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

DO $$
DECLARE
  visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM public.section_maintenance;
  IF visible_count <> 9 THEN
    RAISE EXCEPTION 'Authenticated RLS read expected 9 rows, got %', visible_count;
  END IF;
END
$$;

reset role;
rollback;

\echo 'Section maintenance database preview smoke test passed.'
