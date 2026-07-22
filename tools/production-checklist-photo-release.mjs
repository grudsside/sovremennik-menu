import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const expectedProductionRef = 'tjibbzfdughhjenumzxo';
const projectRef = String(process.env.PRODUCTION_PROJECT_REF || '').trim();
const accessToken = String(process.env.SUPABASE_ACCESS_TOKEN || '').trim();
const migrationFile = '20260722130000_checklist_photo_reports_preview.sql';

assert(accessToken, 'SUPABASE_ACCESS_TOKEN is required.');
assert.equal(
  projectRef,
  expectedProductionRef,
  'Checklist photo release must target the fixed production Project Ref.',
);

const managementApi = 'https://api.supabase.com/v1';
const outputDir = path.join(process.cwd(), 'artifacts', 'production-checklist-photo-release');

async function managementRequest(endpoint, options = {}) {
  const response = await fetch(`${managementApi}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase Management API ${response.status} for ${endpoint}: ${text.slice(0, 800)}`);
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function executeSql(query) {
  return managementRequest(`/projects/${projectRef}/database/query`, {
    method: 'POST',
    body: JSON.stringify({ query, read_only: false }),
  });
}

await fs.mkdir(outputDir, { recursive: true });
const project = await managementRequest(`/projects/${projectRef}`);
assert.equal(String(project?.ref || project?.id || '').trim(), projectRef, 'Management API returned another project.');

const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', migrationFile);
const migrationSql = await fs.readFile(migrationPath, 'utf8');
for (const marker of [
  'create table if not exists public.checklist_photo_rules',
  'create table if not exists public.checklist_submission_photos',
  'checklist-photo-reports',
  'finalize_checklist_photo_submission',
  "interval '90 days'",
]) {
  assert(migrationSql.includes(marker), `Checklist photo migration marker is missing: ${marker}`);
}
assert(!migrationSql.includes(expectedProductionRef), 'Migration must not hardcode the production Project Ref.');
await executeSql(migrationSql);

const verificationSql = String.raw`
do $verify$
declare
  rules_rls boolean;
  photos_rls boolean;
  bucket_public boolean;
  bucket_limit bigint;
  bucket_types text[];
begin
  if to_regclass('public.checklist_photo_rules') is null then
    raise exception 'checklist_photo_rules table is missing';
  end if;
  if to_regclass('public.checklist_submission_photos') is null then
    raise exception 'checklist_submission_photos table is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'checklist_submissions'
      and column_name = 'photo_required_count'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'checklist_submissions'
      and column_name = 'photo_upload_status'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'checklist_submissions'
      and column_name = 'submitted_incomplete'
  ) then
    raise exception 'checklist_submissions photo summary columns are incomplete';
  end if;

  select c.relrowsecurity into rules_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'checklist_photo_rules';
  select c.relrowsecurity into photos_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'checklist_submission_photos';
  if coalesce(rules_rls, false) is not true or coalesce(photos_rls, false) is not true then
    raise exception 'Checklist photo RLS must be enabled';
  end if;

  if not has_table_privilege('authenticated', 'public.checklist_photo_rules', 'SELECT') then
    raise exception 'authenticated must read checklist photo rules';
  end if;
  if has_table_privilege('authenticated', 'public.checklist_photo_rules', 'INSERT')
     or has_table_privilege('authenticated', 'public.checklist_photo_rules', 'UPDATE')
     or has_table_privilege('authenticated', 'public.checklist_photo_rules', 'DELETE') then
    raise exception 'authenticated must not write checklist photo rules directly';
  end if;
  if not has_table_privilege('authenticated', 'public.checklist_submission_photos', 'SELECT')
     or not has_table_privilege('authenticated', 'public.checklist_submission_photos', 'INSERT') then
    raise exception 'authenticated photo metadata privileges are incomplete';
  end if;
  if has_table_privilege('authenticated', 'public.checklist_submission_photos', 'UPDATE')
     or has_table_privilege('authenticated', 'public.checklist_submission_photos', 'DELETE') then
    raise exception 'authenticated must not update or delete photo metadata directly';
  end if;
  if has_table_privilege('anon', 'public.checklist_photo_rules', 'SELECT')
     or has_table_privilege('anon', 'public.checklist_submission_photos', 'SELECT') then
    raise exception 'anon must not read checklist photo data';
  end if;

  if to_regprocedure('public.replace_checklist_photo_rules(text,jsonb)') is null
     or to_regprocedure('public.finalize_checklist_photo_submission(uuid,jsonb)') is null
     or to_regprocedure('public.set_checklist_photo_retained(uuid,boolean)') is null then
    raise exception 'Checklist photo RPC functions are missing';
  end if;
  if not has_function_privilege('authenticated', 'public.replace_checklist_photo_rules(text,jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.finalize_checklist_photo_submission(uuid,jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.set_checklist_photo_retained(uuid,boolean)', 'EXECUTE') then
    raise exception 'Authenticated checklist photo RPC privileges are incomplete';
  end if;

  select public, file_size_limit, allowed_mime_types
    into bucket_public, bucket_limit, bucket_types
  from storage.buckets where id = 'checklist-photo-reports';
  if not found then raise exception 'Private checklist photo bucket is missing'; end if;
  if bucket_public is not false then raise exception 'Checklist photo bucket must remain private'; end if;
  if bucket_limit <> 3145728 then raise exception 'Checklist photo bucket size limit is incorrect'; end if;
  if not coalesce(bucket_types, array[]::text[]) @> array['image/jpeg','image/webp'] then
    raise exception 'Checklist photo bucket MIME restrictions are incomplete';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'checklist_submission_photos'
      and policyname = 'checklist_submission_photos_select_visible'
  ) or not exists (
    select 1 from pg_policies where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'checklist_photo_storage_insert_owner'
  ) or not exists (
    select 1 from pg_policies where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'checklist_photo_storage_select_visible'
  ) then
    raise exception 'Checklist photo access policies are incomplete';
  end if;
end
$verify$;
`;
await executeSql(verificationSql);

const result = {
  ok: true,
  projectRef,
  migration: migrationFile,
  bucket: 'checklist-photo-reports',
  retentionDays: 90,
  verifiedAt: new Date().toISOString(),
};
await fs.writeFile(path.join(outputDir, 'database-verification.json'), JSON.stringify(result, null, 2));
console.log('Production checklist photo database migration and security verification passed.');
