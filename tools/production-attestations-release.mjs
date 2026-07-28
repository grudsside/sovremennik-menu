import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const expectedProductionRef = 'tjibbzfdughhjenumzxo';
const previewRef = 'enkftanmqlwvjydliwue';
const projectRef = String(process.env.PRODUCTION_PROJECT_REF || '').trim();
const accessToken = String(process.env.SUPABASE_ACCESS_TOKEN || '').trim();
const migrationFile = '20260728130000_attestations_preview.sql';
const outputDir = path.join(process.cwd(), 'artifacts', 'production-attestations-release');

assert(accessToken, 'SUPABASE_ACCESS_TOKEN is required.');
assert.equal(projectRef, expectedProductionRef, 'Attestations release must target the fixed production Project Ref.');
assert.notEqual(projectRef, previewRef, 'Attestations production release must never target preview.');

const managementApi = 'https://api.supabase.com/v1';

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
    throw new Error(`Supabase Management API ${response.status} for ${endpoint}: ${text.slice(0, 1000)}`);
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

const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', migrationFile);
const migrationSql = await fs.readFile(migrationPath, 'utf8');
const migrationLower = migrationSql.toLowerCase();
for (const marker of [
  'create table if not exists public.attestation_questions',
  'create table if not exists public.attestation_tests',
  'create table if not exists public.attestation_test_questions',
  'create table if not exists public.attestation_assignments',
  'create table if not exists public.attestation_attempts',
  'create or replace function public.create_attestation_test',
  'create or replace function public.list_admin_attestation_tests',
  'create or replace function public.list_my_attestations',
  'create or replace function public.start_attestation_attempt',
  'create or replace function public.submit_attestation_attempt',
  'create or replace function public.list_attestation_results',
  "question.snapshot - 'correctanswer' - 'explanation'",
  'alter table public.attestation_questions enable row level security',
  'grant execute on function public.create_attestation_test',
]) {
  assert(migrationLower.includes(marker), `Attestations migration marker is missing: ${marker}`);
}
assert(!migrationSql.includes(expectedProductionRef), 'Migration must not hardcode production Project Ref.');
assert(!migrationSql.includes(previewRef), 'Migration must not reference preview Project Ref.');

await executeSql(migrationSql);

const verificationSql = String.raw`
do $verify$
declare
  table_name_value text;
  function_signature text;
  function_row record;
  function_definition text;
begin
  foreach table_name_value in array array[
    'attestation_questions',
    'attestation_tests',
    'attestation_test_questions',
    'attestation_assignments',
    'attestation_attempts'
  ] loop
    if to_regclass('public.' || table_name_value) is null then
      raise exception 'Missing attestation table: %', table_name_value;
    end if;
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = table_name_value and c.relrowsecurity = true
    ) then
      raise exception 'RLS is not enabled for %', table_name_value;
    end if;
    if has_table_privilege('anon', 'public.' || table_name_value, 'SELECT') then
      raise exception 'anon must not read %', table_name_value;
    end if;
  end loop;

  if not has_table_privilege('authenticated', 'public.attestation_questions', 'SELECT')
     or not has_table_privilege('authenticated', 'public.attestation_questions', 'INSERT')
     or not has_table_privilege('authenticated', 'public.attestation_questions', 'UPDATE')
     or not has_table_privilege('authenticated', 'public.attestation_questions', 'DELETE') then
    raise exception 'Admin question-bank table grants are incomplete';
  end if;

  foreach table_name_value in array array[
    'attestation_tests',
    'attestation_test_questions',
    'attestation_assignments',
    'attestation_attempts'
  ] loop
    if not has_table_privilege('authenticated', 'public.' || table_name_value, 'SELECT') then
      raise exception 'authenticated SELECT grant is missing for %', table_name_value;
    end if;
    if has_table_privilege('authenticated', 'public.' || table_name_value, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || table_name_value, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || table_name_value, 'DELETE') then
      raise exception 'Direct authenticated write must remain blocked for %', table_name_value;
    end if;
  end loop;

  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='attestation_questions_topic_active_idx')
     or not exists (select 1 from pg_indexes where schemaname='public' and indexname='attestation_assignments_employee_idx')
     or not exists (select 1 from pg_indexes where schemaname='public' and indexname='attestation_attempts_assignment_idx')
     or not exists (select 1 from pg_indexes where schemaname='public' and indexname='attestation_attempts_submitted_idx') then
    raise exception 'Attestation indexes are incomplete';
  end if;

  foreach function_signature in array array[
    'public.create_attestation_test(text,text,jsonb,jsonb,jsonb,uuid[],timestamptz)',
    'public.list_admin_attestation_tests()',
    'public.list_my_attestations()',
    'public.start_attestation_attempt(uuid)',
    'public.submit_attestation_attempt(uuid,jsonb)',
    'public.list_attestation_results()'
  ] loop
    if to_regprocedure(function_signature) is null then
      raise exception 'Missing attestation RPC: %', function_signature;
    end if;
    select p.prosecdef, p.proconfig, pg_get_functiondef(p.oid)
      into function_row
      from pg_proc p
      where p.oid = to_regprocedure(function_signature);
    if coalesce(function_row.prosecdef, false) is not true then
      raise exception 'RPC must be SECURITY DEFINER: %', function_signature;
    end if;
    if not coalesce(function_row.proconfig, array[]::text[]) @> array['search_path=public'] then
      raise exception 'RPC search_path protection is missing: %', function_signature;
    end if;
    if not has_function_privilege('authenticated', function_signature, 'EXECUTE') then
      raise exception 'authenticated EXECUTE grant is missing: %', function_signature;
    end if;
    if has_function_privilege('anon', function_signature, 'EXECUTE') then
      raise exception 'anon must not execute %', function_signature;
    end if;
  end loop;

  select pg_get_functiondef('public.start_attestation_attempt(uuid)'::regprocedure) into function_definition;
  if lower(function_definition) not like '%correctanswer%'
     or lower(function_definition) not like '%explanation%'
     or lower(function_definition) not like '%snapshot - %' then
    raise exception 'Employee attempt payload stripping is missing';
  end if;

  select pg_get_functiondef('public.list_attestation_results()'::regprocedure) into function_definition;
  if lower(function_definition) not like '%is_admin_or_manager%' then
    raise exception 'Manager/admin result access guard is missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='attestation_questions'
      and policyname='attestation_questions_admin_all'
  ) or not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='attestation_assignments'
      and policyname='attestation_assignments_visible'
  ) or not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='attestation_attempts'
      and policyname='attestation_attempts_visible'
  ) then
    raise exception 'Attestation RLS policies are incomplete';
  end if;
end
$verify$;
`;

await executeSql(verificationSql);

const result = {
  ok: true,
  projectRef,
  migration: migrationFile,
  tables: [
    'attestation_questions',
    'attestation_tests',
    'attestation_test_questions',
    'attestation_assignments',
    'attestation_attempts',
  ],
  functions: [
    'create_attestation_test',
    'list_admin_attestation_tests',
    'list_my_attestations',
    'start_attestation_attempt',
    'submit_attestation_attempt',
    'list_attestation_results',
  ],
  verifiedAt: new Date().toISOString(),
};
await fs.writeFile(path.join(outputDir, 'database-verification.json'), JSON.stringify(result, null, 2));
console.log('Production attestations migration, RLS and RPC verification passed.');
