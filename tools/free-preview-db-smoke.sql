\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
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

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select case
    when strpos(coalesce(name, ''), '/') = 0 then array[]::text[]
    else string_to_array(regexp_replace(name, '/[^/]*$', ''), '/')
  end;
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

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
\ir ../supabase/migrations/20260721203000_coffee_revision_total_stock.sql
\ir ../supabase/migrations/20260721223000_coffee_revision_integrity_summary.sql
\ir ../supabase/migrations/20260722130000_checklist_photo_reports_preview.sql

DO $$
DECLARE
  maintenance_count integer;
  photo_bucket record;
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN RAISE EXCEPTION 'profiles table was not created'; END IF;
  IF to_regclass('public.notification_events') IS NULL THEN RAISE EXCEPTION 'notification_events table was not created'; END IF;
  IF to_regclass('public.section_maintenance') IS NULL THEN RAISE EXCEPTION 'section_maintenance table was not created'; END IF;
  IF to_regclass('public.coffee_revision_edits') IS NULL THEN RAISE EXCEPTION 'coffee revision correction audit table was not created'; END IF;
  IF to_regclass('public.checklist_photo_rules') IS NULL THEN RAISE EXCEPTION 'checklist photo rules table was not created'; END IF;
  IF to_regclass('public.checklist_submission_photos') IS NULL THEN RAISE EXCEPTION 'checklist submission photos table was not created'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_events' AND column_name = 'read_at'
  ) THEN RAISE EXCEPTION 'notification history read_at column is missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'menu_item_overrides' AND column_name = 'payload'
  ) THEN RAISE EXCEPTION 'menu item payload column is missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'checklist_submissions' AND column_name = 'photo_upload_status'
  ) THEN RAISE EXCEPTION 'checklist photo_upload_status column is missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'checklist_submissions' AND column_name = 'submitted_incomplete'
  ) THEN RAISE EXCEPTION 'checklist submitted_incomplete column is missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'coffee_revision_report' AND column_name = 'total_loss_weight'
  ) THEN RAISE EXCEPTION 'coffee revision total_loss_weight formula column is missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'coffee_revisions' AND column_name = 'grain_delivery'
  ) THEN RAISE EXCEPTION 'coffee revision grain_delivery column is missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'coffee_revisions' AND column_name = 'stock_balance_override'
  ) THEN RAISE EXCEPTION 'coffee revision stock_balance_override column is missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'coffee_revisions' AND column_name = 'opening_clean_hopper_weight'
  ) THEN RAISE EXCEPTION 'coffee revision opening_clean_hopper_weight column is missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'coffee_revisions' AND column_name = 'opening_total_grain_balance'
  ) THEN RAISE EXCEPTION 'coffee revision opening_total_grain_balance column is missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'coffee_revision_report' AND column_name = 'total_grain_balance'
  ) THEN RAISE EXCEPTION 'coffee revision total_grain_balance column is missing'; END IF;

  IF to_regprocedure('public.correct_coffee_revision(date,numeric,integer,numeric,numeric,text,numeric,numeric,text)') IS NULL THEN
    RAISE EXCEPTION 'stock-aware protected coffee revision correction function is missing';
  END IF;
  IF to_regprocedure('public.correct_coffee_revision(date,numeric,integer,numeric,numeric,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'old coffee revision correction overload must be removed';
  END IF;
  IF to_regprocedure('public.replace_checklist_photo_rules(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'replace checklist photo rules RPC is missing';
  END IF;
  IF to_regprocedure('public.finalize_checklist_photo_submission(uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'finalize checklist photo submission RPC is missing';
  END IF;
  IF to_regprocedure('public.set_checklist_photo_retained(uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'photo retention RPC is missing';
  END IF;

  SELECT count(*) INTO maintenance_count FROM public.section_maintenance;
  IF maintenance_count <> 9 THEN RAISE EXCEPTION 'Expected 9 maintenance rows, got %', maintenance_count; END IF;

  SELECT public, file_size_limit, allowed_mime_types INTO photo_bucket
  FROM storage.buckets WHERE id = 'checklist-photo-reports';
  IF photo_bucket IS NULL OR photo_bucket.public OR photo_bucket.file_size_limit <> 3145728 THEN
    RAISE EXCEPTION 'Checklist photo bucket must be private and limited to 3 MB';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE login = 'grigory') THEN
    RAISE EXCEPTION 'Production administrator must not be seeded into Free preview';
  END IF;
  IF has_table_privilege('authenticated', 'public.section_maintenance', 'UPDATE') THEN
    RAISE EXCEPTION 'Authenticated preview clients must not update maintenance state directly';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.checklist_submission_photos', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.checklist_submission_photos', 'INSERT') THEN
    RAISE EXCEPTION 'Authenticated users need photo metadata select and insert privileges';
  END IF;
  IF has_table_privilege('authenticated', 'public.checklist_submission_photos', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.checklist_submission_photos', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated users must not update or delete photo metadata directly';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.checklist_photo_rules', 'SELECT')
     OR has_table_privilege('authenticated', 'public.checklist_photo_rules', 'INSERT')
     OR has_table_privilege('authenticated', 'public.checklist_photo_rules', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.checklist_photo_rules', 'DELETE') THEN
    RAISE EXCEPTION 'Checklist photo rules must be read-only for direct authenticated clients';
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
    'public.correct_coffee_revision(date,numeric,integer,numeric,numeric,text,numeric,numeric,text)',
    'EXECUTE'
  ) THEN RAISE EXCEPTION 'Authenticated clients must be able to call the protected correction RPC'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.finalize_checklist_photo_submission(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated clients must be able to finalize their photo report';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notification_events'
      AND policyname = 'notification_events_update_read_active_own'
  ) THEN RAISE EXCEPTION 'Notification read policy is missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'coffee_revision_edits'
      AND policyname = 'coffee_revision_edits_select_admin'
  ) THEN RAISE EXCEPTION 'Coffee revision edit history admin policy is missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'checklist_photo_storage_select_visible'
  ) THEN RAISE EXCEPTION 'Private checklist photo read policy is missing'; END IF;
END
$$;

DO $$
DECLARE
  admin_id constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  barista_id constant uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  submission_id constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  photo_id constant uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  initial_row public.checklist_submissions%rowtype;
  final_row public.checklist_submissions%rowtype;
  retained_row public.checklist_submission_photos%rowtype;
  items jsonb := '[{"itemKey":"preview-checklist:0:0","text":"Фото-пункт","checkedByUser":true,"checked":true}]'::jsonb;
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (admin_id,'photo-admin@example.test'),
    (barista_id,'photo-barista@example.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles(id,login,name,role,is_active) VALUES
    (admin_id,'photo-admin','Photo Admin','admin',true),
    (barista_id,'photo-barista','Photo Barista','barista',true)
  ON CONFLICT (id) DO UPDATE SET role=excluded.role,is_active=true;

  PERFORM set_config('request.jwt.claim.sub', admin_id::text, true);
  PERFORM public.replace_checklist_photo_rules(
    'preview-checklist',
    '[{"item_key":"preview-checklist:0:0","item_text":"Фото-пункт","required_count":1,"hint":"Покажите результат"}]'::jsonb
  );

  PERFORM set_config('request.jwt.claim.sub', barista_id::text, true);
  INSERT INTO public.checklist_submissions(
    id,checklist_id,checklist_title,employee_id,employee_name,items,completed_count,total_count,percent,version
  ) VALUES (
    submission_id,'preview-checklist','Preview Checklist',barista_id,'Photo Barista',items,1,1,100,2
  ) RETURNING * INTO initial_row;
  IF initial_row.completed_count <> 0 OR initial_row.photo_required_count <> 1 OR initial_row.photo_upload_status <> 'pending' THEN
    RAISE EXCEPTION 'Initial photo-required submission was not normalized: %', row_to_json(initial_row);
  END IF;

  INSERT INTO public.checklist_submission_photos(
    id,submission_id,checklist_id,item_key,item_text,photo_index,storage_path,thumbnail_path,
    mime_type,file_size,thumbnail_size,created_by
  ) VALUES (
    photo_id,submission_id,'preview-checklist','preview-checklist:0:0','Фото-пункт',1,
    barista_id::text || '/' || submission_id::text || '/preview-checklist-0-0/full-1.jpg',
    barista_id::text || '/' || submission_id::text || '/preview-checklist-0-0/thumb-1.jpg',
    'image/jpeg',1024,256,barista_id
  );

  SELECT * INTO final_row FROM public.finalize_checklist_photo_submission(submission_id, items);
  IF final_row.completed_count <> 1 OR final_row.percent <> 100 OR final_row.photo_count <> 1
     OR final_row.photo_upload_status <> 'complete' OR final_row.submitted_incomplete THEN
    RAISE EXCEPTION 'Finalized photo submission is incorrect: %', row_to_json(final_row);
  END IF;

  PERFORM set_config('request.jwt.claim.sub', admin_id::text, true);
  SELECT * INTO retained_row FROM public.set_checklist_photo_retained(photo_id, true);
  IF retained_row.retained IS DISTINCT FROM true OR retained_row.retained_by IS DISTINCT FROM admin_id THEN
    RAISE EXCEPTION 'Administrator could not retain photo: %', row_to_json(retained_row);
  END IF;

  DELETE FROM public.checklist_submissions WHERE id = submission_id;
  DELETE FROM public.checklist_photo_rules WHERE checklist_id = 'preview-checklist';
  DELETE FROM public.profiles WHERE id IN (admin_id,barista_id);
  DELETE FROM auth.users WHERE id IN (admin_id,barista_id);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END
$$;

DO $$
DECLARE
  day_one record;
  day_two record;
  day_three record;
  day_four record;
BEGIN
  DELETE FROM public.coffee_revision_edits WHERE revision_date BETWEEN DATE '2099-12-27' AND DATE '2099-12-30';
  DELETE FROM public.coffee_revisions WHERE revision_date BETWEEN DATE '2099-12-27' AND DATE '2099-12-30';

  INSERT INTO public.coffee_revisions (
    revision_date, employee_name, hopper_weight, opened_packs, write_offs, iiko_sales,
    grain_delivery, stock_balance_override, opening_clean_hopper_weight, opening_total_grain_balance
  ) VALUES
    (DATE '2099-12-27', 'Formula Test', 1.847, 0, 0, 0, 0, NULL, 1.000, 60.000),
    (DATE '2099-12-28', 'Formula Test', 1.347, 4, 0.200, 4.400, 10.000, NULL, NULL, NULL),
    (DATE '2099-12-29', 'Formula Test', 1.047, 4, 0.100, 4.500, 0, 58.000, NULL, NULL),
    (DATE '2099-12-30', 'Formula Test', 0.947, 2, 0.100, 2.000, 5.000, NULL, NULL, NULL);

  SELECT total_coffee_usage, total_grain_balance INTO day_one
  FROM public.coffee_revision_report WHERE revision_date = DATE '2099-12-27';
  IF day_one.total_coffee_usage <> 0.000 OR day_one.total_grain_balance <> 60.000 THEN
    RAISE EXCEPTION 'Opening stock anchors are incorrect: %', row_to_json(day_one);
  END IF;

  SELECT clean_hopper_weight, total_coffee_usage, difference, total_loss_weight, losses_percent,
         grain_delivery, total_grain_balance
    INTO day_two
  FROM public.coffee_revision_report WHERE revision_date = DATE '2099-12-28';
  IF day_two.clean_hopper_weight <> 0.500
     OR day_two.total_coffee_usage <> 4.500
     OR day_two.difference <> -0.300
     OR day_two.total_loss_weight <> 0.500
     OR day_two.losses_percent <> 11.36
     OR day_two.grain_delivery <> 10.000
     OR day_two.total_grain_balance <> 65.500 THEN
    RAISE EXCEPTION 'Day two coffee and stock formulas are incorrect: %', row_to_json(day_two);
  END IF;

  SELECT total_coffee_usage, total_grain_balance INTO day_three
  FROM public.coffee_revision_report WHERE revision_date = DATE '2099-12-29';
  IF day_three.total_coffee_usage <> 4.300 OR day_three.total_grain_balance <> 58.000 THEN
    RAISE EXCEPTION 'Manual stock control point is incorrect: %', row_to_json(day_three);
  END IF;

  SELECT total_coffee_usage, grain_delivery, total_grain_balance INTO day_four
  FROM public.coffee_revision_report WHERE revision_date = DATE '2099-12-30';
  IF day_four.total_coffee_usage <> 2.100
     OR day_four.grain_delivery <> 5.000
     OR day_four.total_grain_balance <> 60.900 THEN
    RAISE EXCEPTION 'Stock continuation after control point is incorrect: %', row_to_json(day_four);
  END IF;

  DELETE FROM public.coffee_revisions WHERE revision_date BETWEEN DATE '2099-12-27' AND DATE '2099-12-30';
END
$$;

\echo 'Dedicated Free preview database bootstrap smoke test passed.'
