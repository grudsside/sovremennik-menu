import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const expectedProductionRef = 'tjibbzfdughhjenumzxo';
const projectRef = String(process.env.PRODUCTION_PROJECT_REF || '').trim();
const accessToken = String(process.env.SUPABASE_ACCESS_TOKEN || '').trim();

assert(accessToken, 'SUPABASE_ACCESS_TOKEN is required.');
assert.equal(projectRef, expectedProductionRef, 'Shared checklist release must target production.');

const managementApi = 'https://api.supabase.com/v1';
const outputDir = path.join(process.cwd(), 'artifacts', 'production-shared-checklists');

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
  try { return JSON.parse(text); } catch { return text; }
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

const migrations = [
  {
    file: '20260804170000_checklist_shared_drafts_schema.sql',
    marker: 'create table if not exists public.checklist_shared_drafts',
  },
  {
    file: '20260804171000_checklist_shared_drafts_photos_finalize.sql',
    marker: 'create or replace function public.finalize_checklist_shared_draft',
  },
  {
    file: '20260804172000_checklist_shared_drafts_security.sql',
    marker: 'checklist_shared_photo_storage_select_accessible',
  },
];

for (const migration of migrations) {
  const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', migration.file);
  const sql = await fs.readFile(migrationPath, 'utf8');
  assert(sql.includes(migration.marker), `Unexpected migration content: ${migration.file}`);
  assert(!sql.includes(expectedProductionRef), `Migration must not hardcode production ref: ${migration.file}`);
  await executeSql(sql);
}

const verificationSql = String.raw`
do $verify$
declare
  table_name_value text;
  rls_enabled boolean;
  function_signature text;
  photo_guard text;
  bucket_public boolean;
begin
  foreach table_name_value in array array[
    'checklist_shared_drafts',
    'checklist_shared_draft_items',
    'checklist_shared_draft_photos'
  ] loop
    if to_regclass('public.' || table_name_value) is null then
      raise exception 'Shared checklist table is missing: %', table_name_value;
    end if;

    select c.relrowsecurity into rls_enabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = table_name_value;

    if coalesce(rls_enabled, false) is not true then
      raise exception 'RLS is disabled for %', table_name_value;
    end if;
    if not has_table_privilege('authenticated', 'public.' || table_name_value, 'SELECT') then
      raise exception 'authenticated cannot read % for Realtime/RLS', table_name_value;
    end if;
    if has_table_privilege('authenticated', 'public.' || table_name_value, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || table_name_value, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || table_name_value, 'DELETE') then
      raise exception 'authenticated received unsafe direct write access to %', table_name_value;
    end if;
    if has_table_privilege('anon', 'public.' || table_name_value, 'SELECT') then
      raise exception 'anon can read %', table_name_value;
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.checklist_shared_drafts'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%(checklist_id, department, work_date)%'
  ) then
    raise exception 'One shared draft per checklist, department and date is not enforced';
  end if;

  foreach function_signature in array array[
    'public.open_checklist_shared_draft(text,text,text,date,jsonb)',
    'public.patch_checklist_shared_draft(uuid,text,jsonb)',
    'public.attach_checklist_shared_draft_photo(uuid,uuid,text,text,text,text,integer,integer)',
    'public.remove_checklist_shared_draft_photo(uuid,uuid)',
    'public.finalize_checklist_shared_draft(uuid,text)'
  ] loop
    if to_regprocedure(function_signature) is null then
      raise exception 'Shared checklist RPC is missing: %', function_signature;
    end if;
    if not has_function_privilege('authenticated', function_signature, 'EXECUTE') then
      raise exception 'authenticated cannot call shared checklist RPC: %', function_signature;
    end if;
    if has_function_privilege('anon', function_signature, 'EXECUTE') then
      raise exception 'anon can call shared checklist RPC: %', function_signature;
    end if;
  end loop;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'checklist_shared_drafts'
  ) or not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'checklist_shared_draft_items'
  ) or not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'checklist_shared_draft_photos'
  ) then
    raise exception 'Shared checklist tables are not fully published to Realtime';
  end if;

  select public into bucket_public
  from storage.buckets
  where id = 'checklist-photo-reports';
  if bucket_public is distinct from false then
    raise exception 'Checklist photo bucket must remain private';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'checklist_shared_photo_storage_select_accessible'
  ) then
    raise exception 'Collaborative private photo read policy is missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'checklist_submission_photos'
      and policyname = 'checklist_submission_photos_select_visible'
      and qual like '%employee_id%'
  ) then
    raise exception 'Finalizer cannot read collaborative final photos';
  end if;

  select pg_get_functiondef('public.enforce_checklist_photo_metadata()'::regprocedure)
    into photo_guard;
  if position('checklist_shared_draft_photos' in photo_guard) = 0
     or position('shared_creator' in photo_guard) = 0 then
    raise exception 'Final photo metadata guard does not preserve collaborator authorship';
  end if;
end
$verify$;
`;

await executeSql(verificationSql);

const report = {
  ok: true,
  projectRef,
  migrations: migrations.map(item => item.file),
  verified: [
    'three shared checklist tables installed with RLS',
    'browser direct writes denied and protected RPCs enabled',
    'role-scoped shared draft access installed',
    'Realtime publication includes draft, item and photo changes',
    'private collaborative photo access installed',
    'transactional one-shot finalization installed',
    'collaborator photo authorship preserved in final reports',
  ],
  completedAt: new Date().toISOString(),
};

await fs.writeFile(
  path.join(outputDir, 'database-release.json'),
  JSON.stringify(report, null, 2),
);
console.log('Production shared checklist migrations applied and verified.');
