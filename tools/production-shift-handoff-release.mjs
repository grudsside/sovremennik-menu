import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const expectedProductionRef = 'tjibbzfdughhjenumzxo';
const projectRef = String(process.env.PRODUCTION_PROJECT_REF || '').trim();
const accessToken = String(process.env.SUPABASE_ACCESS_TOKEN || '').trim();
const migrationFiles = [
  '20260723150000_shift_handoff_preview.sql',
  '20260723190000_shift_handoff_barista_only.sql',
  '20260723203000_shift_handoff_admin_lifecycle.sql',
];

assert(accessToken, 'SUPABASE_ACCESS_TOKEN is required.');
assert.equal(
  projectRef,
  expectedProductionRef,
  'Shift handoff release must target the fixed production Project Ref.',
);

const managementApi = 'https://api.supabase.com/v1';
const outputDir = path.join(process.cwd(), 'artifacts', 'production-shift-handoff-release');

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
    throw new Error(`Supabase Management API ${response.status} for ${endpoint}: ${text.slice(0, 1200)}`);
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

for (const migrationFile of migrationFiles) {
  const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', migrationFile);
  const migrationSql = await fs.readFile(migrationPath, 'utf8');
  assert(migrationSql.trim(), `Shift handoff migration is empty: ${migrationFile}`);
  assert(!migrationSql.includes(expectedProductionRef), `${migrationFile} must not hardcode the production Project Ref.`);
  await executeSql(migrationSql);
}

const verificationSql = String.raw`
do $verify$
declare
  handoffs_rls boolean;
  acknowledgements_rls boolean;
  photos_rls boolean;
  bucket_public boolean;
  bucket_limit bigint;
  bucket_types text[];
  role_function text;
begin
  if to_regclass('public.shift_handoffs') is null then
    raise exception 'shift_handoffs table is missing';
  end if;
  if to_regclass('public.shift_handoff_acknowledgements') is null then
    raise exception 'shift_handoff_acknowledgements table is missing';
  end if;
  if to_regclass('public.shift_handoff_photos') is null then
    raise exception 'shift_handoff_photos table is missing';
  end if;

  select c.relrowsecurity into handoffs_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'shift_handoffs';
  select c.relrowsecurity into acknowledgements_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'shift_handoff_acknowledgements';
  select c.relrowsecurity into photos_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'shift_handoff_photos';
  if coalesce(handoffs_rls, false) is not true
     or coalesce(acknowledgements_rls, false) is not true
     or coalesce(photos_rls, false) is not true then
    raise exception 'Shift handoff RLS must be enabled on all tables';
  end if;

  if to_regprocedure('public.is_shift_handoff_user()') is null
     or to_regprocedure('public.create_shift_handoff(uuid,text[],text[],text[],text[],text)') is null
     or to_regprocedure('public.acknowledge_shift_handoff(uuid)') is null then
    raise exception 'Shift handoff RPC functions are missing';
  end if;

  if not has_table_privilege('authenticated', 'public.shift_handoffs', 'SELECT')
     or not has_table_privilege('authenticated', 'public.shift_handoff_acknowledgements', 'SELECT')
     or not has_table_privilege('authenticated', 'public.shift_handoff_photos', 'SELECT')
     or not has_table_privilege('authenticated', 'public.shift_handoff_photos', 'INSERT') then
    raise exception 'Authenticated shift handoff table privileges are incomplete';
  end if;
  if has_table_privilege('anon', 'public.shift_handoffs', 'SELECT')
     or has_table_privilege('anon', 'public.shift_handoff_acknowledgements', 'SELECT')
     or has_table_privilege('anon', 'public.shift_handoff_photos', 'SELECT') then
    raise exception 'Anonymous users must not read shift handoff data';
  end if;
  if not has_function_privilege('authenticated', 'public.is_shift_handoff_user()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.create_shift_handoff(uuid,text[],text[],text[],text[],text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.acknowledge_shift_handoff(uuid)', 'EXECUTE') then
    raise exception 'Authenticated shift handoff RPC privileges are incomplete';
  end if;

  select regexp_replace(lower(pg_get_functiondef('public.is_shift_handoff_user()'::regprocedure)), '\s+', '', 'g')
    into role_function;
  if position('profile.rolein(''admin'',''barista'')' in role_function) = 0 then
    raise exception 'Shift handoff role function must allow administrator and barista';
  end if;
  if position('waiter' in role_function) > 0 then
    raise exception 'Waiter must not be allowed by the shift handoff role function';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'shift_handoffs'
      and policyname = 'shift_handoffs_select_active'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'shift_handoff_acknowledgements'
      and policyname = 'shift_handoff_ack_select_active'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'shift_handoff_photos'
      and policyname = 'shift_handoff_photos_insert_owner'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'shift_handoff_storage_select_active'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'shift_handoff_storage_insert_owner'
  ) then
    raise exception 'Shift handoff access policies are incomplete';
  end if;

  select public, file_size_limit, allowed_mime_types
    into bucket_public, bucket_limit, bucket_types
  from storage.buckets where id = 'shift-handoff-photos';
  if not found then raise exception 'Private shift handoff photo bucket is missing'; end if;
  if bucket_public is not false then raise exception 'Shift handoff photo bucket must remain private'; end if;
  if bucket_limit <> 3145728 then raise exception 'Shift handoff photo bucket size limit is incorrect'; end if;
  if not coalesce(bucket_types, array[]::text[]) @> array['image/jpeg','image/webp'] then
    raise exception 'Shift handoff photo bucket MIME restrictions are incomplete';
  end if;
end
$verify$;
`;

await executeSql(verificationSql);

const result = {
  ok: true,
  projectRef,
  migrations: migrationFiles,
  tables: ['shift_handoffs', 'shift_handoff_acknowledgements', 'shift_handoff_photos'],
  allowedRoles: ['admin', 'barista'],
  blockedRole: 'waiter',
  bucket: 'shift-handoff-photos',
  verifiedAt: new Date().toISOString(),
};
await fs.writeFile(path.join(outputDir, 'database-verification.json'), JSON.stringify(result, null, 2));
console.log('Production shift handoff database migration, roles, RLS and private Storage verification passed.');