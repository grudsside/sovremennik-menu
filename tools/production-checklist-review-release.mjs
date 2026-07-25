import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const expectedProductionRef = 'tjibbzfdughhjenumzxo';
const previewRef = 'enkftanmqlwvjydliwue';
const projectRef = String(process.env.PRODUCTION_PROJECT_REF || '').trim();
const accessToken = String(process.env.SUPABASE_ACCESS_TOKEN || '').trim();
const migrationFile = '20260724210000_checklist_review_tools_preview.sql';

assert(accessToken, 'SUPABASE_ACCESS_TOKEN is required.');
assert.equal(
  projectRef,
  expectedProductionRef,
  'Checklist review release must target the fixed production Project Ref.',
);

const managementApi = 'https://api.supabase.com/v1';
const outputDir = path.join(process.cwd(), 'artifacts', 'production-checklist-review-release');

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
  'create table if not exists public.checklist_submission_comments',
  'create or replace function public.create_checklist_submission_comment',
  'create or replace function public.delete_checklist_submission',
  'deleted_at is null',
  'grant execute on function public.create_checklist_submission_comment',
  'grant execute on function public.delete_checklist_submission',
]) {
  assert(migrationSql.toLowerCase().includes(marker.toLowerCase()), `Checklist review migration marker is missing: ${marker}`);
}
assert(!migrationSql.includes(expectedProductionRef), 'Migration must not hardcode the production Project Ref.');
assert(!migrationSql.includes(previewRef), 'Migration must not reference the preview Project Ref.');
await executeSql(migrationSql);

const verificationSql = String.raw`
do $verify$
declare
  comments_rls boolean;
  comment_secdef boolean;
  delete_secdef boolean;
  comment_config text[];
  delete_config text[];
  submissions_policy text;
begin
  if to_regclass('public.checklist_submission_comments') is null then
    raise exception 'checklist_submission_comments table is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'checklist_submissions' and column_name = 'deleted_at'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'checklist_submissions' and column_name = 'deleted_by'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'checklist_submissions' and column_name = 'deletion_reason'
  ) then
    raise exception 'Checklist submission deletion audit columns are incomplete';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'checklist_submissions_active_created_idx'
  ) or not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'checklist_submission_comments_submission_idx'
  ) then
    raise exception 'Checklist review indexes are incomplete';
  end if;

  select c.relrowsecurity into comments_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'checklist_submission_comments';
  if coalesce(comments_rls, false) is not true then
    raise exception 'Checklist submission comments RLS must be enabled';
  end if;

  if not has_table_privilege('authenticated', 'public.checklist_submission_comments', 'SELECT') then
    raise exception 'authenticated must read visible checklist comments';
  end if;
  if has_table_privilege('authenticated', 'public.checklist_submission_comments', 'INSERT')
     or has_table_privilege('authenticated', 'public.checklist_submission_comments', 'UPDATE')
     or has_table_privilege('authenticated', 'public.checklist_submission_comments', 'DELETE') then
    raise exception 'authenticated must not write checklist comments directly';
  end if;
  if has_table_privilege('anon', 'public.checklist_submission_comments', 'SELECT') then
    raise exception 'anon must not read checklist comments';
  end if;

  if to_regprocedure('public.create_checklist_submission_comment(uuid,uuid,text)') is null
     or to_regprocedure('public.delete_checklist_submission(uuid,text)') is null then
    raise exception 'Checklist review RPC functions are missing';
  end if;

  select p.prosecdef, p.proconfig into comment_secdef, comment_config
  from pg_proc p
  where p.oid = 'public.create_checklist_submission_comment(uuid,uuid,text)'::regprocedure;
  select p.prosecdef, p.proconfig into delete_secdef, delete_config
  from pg_proc p
  where p.oid = 'public.delete_checklist_submission(uuid,text)'::regprocedure;
  if coalesce(comment_secdef, false) is not true or coalesce(delete_secdef, false) is not true then
    raise exception 'Checklist review RPC functions must remain security definer';
  end if;
  if not coalesce(comment_config, array[]::text[]) @> array['search_path=public']
     or not coalesce(delete_config, array[]::text[]) @> array['search_path=public'] then
    raise exception 'Checklist review RPC search_path protection is missing';
  end if;

  if not has_function_privilege('authenticated', 'public.create_checklist_submission_comment(uuid,uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.delete_checklist_submission(uuid,text)', 'EXECUTE') then
    raise exception 'authenticated checklist review RPC privileges are incomplete';
  end if;
  if not has_function_privilege('service_role', 'public.create_checklist_submission_comment(uuid,uuid,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.delete_checklist_submission(uuid,text)', 'EXECUTE') then
    raise exception 'service_role checklist review RPC privileges are incomplete';
  end if;
  if has_function_privilege('anon', 'public.create_checklist_submission_comment(uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.delete_checklist_submission(uuid,text)', 'EXECUTE') then
    raise exception 'anon must not execute checklist review RPC functions';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'checklist_submission_comments'
      and policyname = 'checklist_submission_comments_select_visible'
      and roles @> array['authenticated']::name[]
  ) then
    raise exception 'Checklist comments visibility policy is missing';
  end if;

  select qual into submissions_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'checklist_submissions'
    and policyname = 'checklist_select_control_or_own';
  if submissions_policy is null or lower(submissions_policy) not like '%deleted_at is null%' then
    raise exception 'Soft-deleted checklist submissions are not excluded by the select policy';
  end if;
end
$verify$;
`;
await executeSql(verificationSql);

const result = {
  ok: true,
  projectRef,
  migration: migrationFile,
  table: 'checklist_submission_comments',
  functions: [
    'create_checklist_submission_comment(uuid,uuid,text)',
    'delete_checklist_submission(uuid,text)',
  ],
  verifiedAt: new Date().toISOString(),
};
await fs.writeFile(path.join(outputDir, 'database-verification.json'), JSON.stringify(result, null, 2));
console.log('Production checklist review migration and security verification passed.');
