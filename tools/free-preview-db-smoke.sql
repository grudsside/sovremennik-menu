\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$$;

create schema if not exists auth;
create schema if not exists storage;

grant usage on schema auth, storage to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key,
  email text unique
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id) on delete cascade,
  name text not null default ''
);

alter table storage.objects enable row level security;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

\ir ../supabase/sql/STEP_1_SCHEMA_AND_POLICIES.sql
\ir ../supabase/sql/STEP_4_PATCH_ROLES_PERMISSIONS_TASKS.sql
\ir ../supabase/sql/STEP_5_PUSH_NOTIFICATIONS.sql
\ir ../supabase/sql/STEP_6_CONTENT_SYNC_TECHCARDS_PHOTOS.sql
\ir ../supabase/sql/STEP_8_CONTENT_EDITING_METHOD_TECH.sql
\ir ../supabase/sql/STEP_9_MOBILE_TASKS_ERRORS_NOTIFICATIONS.sql
\ir ../supabase/sql/STEP_10_HARDEN_RLS.sql
\ir ../supabase/sql/STEP_10B_HARDEN_RLS_VIEW_PRIVILEGES.sql
\ir ../supabase/sql/STEP_12_NOTIFICATION_HISTORY.sql
\ir ../supabase/migrations/20260720193000_section_maintenance.sql
\ir ../supabase/migrations/20260721183000_coffee_revision_admin_correction.sql
\ir ../supabase/migrations/20260721190000_coffee_revision_formula_corrections.sql

DO $$
DECLARE
  maintenance_count integer;
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'profiles table was not created';
  END IF;
  IF to_regclass('public.notification_events') IS NULL THEN
    RAISE EXCEPTION 'notification_events table was not created';
  END IF;
  IF to_regclass('public.section_maintenance') IS NULL THEN
    RAISE EXCEPTION 'section_maintenance table was not created';
  END IF;
  IF to_regclass('public.coffee_revision_edits') IS NULL THEN
    RAISE EXCEPTION 'coffee revision correction audit table was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_events' AND column_name = 'read_at'
  ) THEN
    RAISE EXCEPTION 'notification history read_at column is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'menu_item_overrides' AND column_name = 'payload'
  ) THEN
    RAISE EXCEPTION 'menu item payload column is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'coffee_revision_report' AND column_name = 'total_loss_weight'
  ) THEN
    RAISE EXCEPTION 'coffee revision total_loss_weight formula column is missing';
  END IF;

  IF to_regprocedure('public.correct_coffee_revision(date,numeric,integer,numeric,numeric,text,text)') IS NULL THEN
    RAISE EXCEPTION 'protected coffee revision correction function is missing';
  END IF;

  SELECT count(*) INTO maintenance_count FROM public.section_maintenance;
  IF maintenance_count <> 9 THEN
    RAISE EXCEPTION 'Expected 9 maintenance rows, got %', maintenance_count;
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE login = 'grigory') THEN
    RAISE EXCEPTION 'Production administrator must not be seeded into Free preview';
  END IF;

  IF has_table_privilege('authenticated', 'public.section_maintenance', 'UPDATE') THEN
    RAISE EXCEPTION 'Authenticated preview clients must not update maintenance state directly';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.coffee_revision_edits', 'SELECT') THEN
    RAISE EXCEPTION 'Authenticated role must receive select privilege for audit RLS evaluation';
  END IF;

  IF has_table_privilege('authenticated', 'public.coffee_revision_edits', 'INSERT')
     OR has_table_privilege('authenticated', 'public.coffee_revision_edits', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.coffee_revision_edits', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated clients must not write correction audit rows directly';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.correct_coffee_revision(date,numeric,integer,numeric,numeric,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Authenticated clients must be able to call the protected correction RPC';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notification_events'
      AND policyname = 'notification_events_update_read_active_own'
  ) THEN
    RAISE EXCEPTION 'Notification read policy is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'coffee_revision_edits'
      AND policyname = 'coffee_revision_edits_select_admin'
  ) THEN
    RAISE EXCEPTION 'Coffee revision edit history admin policy is missing';
  END IF;
END
$$;

DO $$
DECLARE
  day_two record;
  day_three record;
BEGIN
  DELETE FROM public.coffee_revision_edits WHERE revision_date BETWEEN DATE '2099-12-27' AND DATE '2099-12-29';
  DELETE FROM public.coffee_revisions WHERE revision_date BETWEEN DATE '2099-12-27' AND DATE '2099-12-29';

  INSERT INTO public.coffee_revisions (revision_date, employee_name, hopper_weight, opened_packs, write_offs, iiko_sales)
  VALUES
    (DATE '2099-12-27', 'Formula Test', 1.847, 0, 0, 0),
    (DATE '2099-12-28', 'Formula Test', 1.347, 4, 0.200, 4.400),
    (DATE '2099-12-29', 'Formula Test', 1.047, 4, 0.100, 4.500);

  SELECT clean_hopper_weight, total_coffee_usage, difference, total_loss_weight, losses_percent
    INTO day_two
  FROM public.coffee_revision_report
  WHERE revision_date = DATE '2099-12-28';

  IF day_two.clean_hopper_weight <> 0.500
     OR day_two.total_coffee_usage <> 4.500
     OR day_two.difference <> -0.300
     OR day_two.total_loss_weight <> 0.500
     OR day_two.losses_percent <> 11.36 THEN
    RAISE EXCEPTION 'Day two coffee formulas are incorrect: %', row_to_json(day_two);
  END IF;

  SELECT clean_hopper_weight, total_coffee_usage, difference, total_loss_weight, losses_percent
    INTO day_three
  FROM public.coffee_revision_report
  WHERE revision_date = DATE '2099-12-29';

  IF day_three.clean_hopper_weight <> 0.200
     OR day_three.total_coffee_usage <> 4.300
     OR day_three.difference <> 0.100
     OR day_three.total_loss_weight <> 0.100
     OR day_three.losses_percent <> 2.22 THEN
    RAISE EXCEPTION 'Day three coffee formulas are incorrect: %', row_to_json(day_three);
  END IF;

  DELETE FROM public.coffee_revisions WHERE revision_date BETWEEN DATE '2099-12-27' AND DATE '2099-12-29';
END
$$;

\echo 'Dedicated Free preview database bootstrap smoke test passed.'
