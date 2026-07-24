import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const expectedProductionRef = 'tjibbzfdughhjenumzxo';
const projectRef = String(process.env.PRODUCTION_PROJECT_REF || '').trim();
const accessToken = String(process.env.SUPABASE_ACCESS_TOKEN || '').trim();
const migrationFile = '20260724110000_checklist_template_editor_preview.sql';

assert(accessToken, 'SUPABASE_ACCESS_TOKEN is required.');
assert.equal(projectRef, expectedProductionRef, 'Checklist editor release must target the fixed production Project Ref.');

const managementApi = 'https://api.supabase.com/v1';
const outputDir = path.join(process.cwd(), 'artifacts', 'production-checklist-editor-release');

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

const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', migrationFile);
const migrationSql = await fs.readFile(migrationPath, 'utf8');
for (const marker of [
  'create table if not exists public.checklist_template_overrides',
  'create table if not exists public.checklist_template_edits',
  'save_checklist_template_override',
  'reset_checklist_template_override',
  'Checklist template was changed by another administrator',
  'checklist_template_edits_select_admin',
]) {
  assert(migrationSql.includes(marker), `Checklist editor migration marker is missing: ${marker}`);
}
assert(!migrationSql.includes(expectedProductionRef), 'Migration must not hardcode the production Project Ref.');
await executeSql(migrationSql);

const verificationSql = String.raw`
do $verify$
declare
  overrides_rls boolean;
  edits_rls boolean;
begin
  if to_regclass('public.checklist_template_overrides') is null then
    raise exception 'checklist_template_overrides table is missing';
  end if;
  if to_regclass('public.checklist_template_edits') is null then
    raise exception 'checklist_template_edits table is missing';
  end if;

  select c.relrowsecurity into overrides_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'checklist_template_overrides';
  select c.relrowsecurity into edits_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'checklist_template_edits';
  if coalesce(overrides_rls, false) is not true or coalesce(edits_rls, false) is not true then
    raise exception 'Checklist editor RLS must be enabled';
  end if;

  if not has_table_privilege('authenticated', 'public.checklist_template_overrides', 'SELECT') then
    raise exception 'authenticated must read active checklist overrides';
  end if;
  if not has_table_privilege('authenticated', 'public.checklist_template_edits', 'SELECT') then
    raise exception 'authenticated needs SELECT for audit RLS evaluation';
  end if;
  if has_table_privilege('authenticated', 'public.checklist_template_overrides', 'INSERT')
     or has_table_privilege('authenticated', 'public.checklist_template_overrides', 'UPDATE')
     or has_table_privilege('authenticated', 'public.checklist_template_overrides', 'DELETE')
     or has_table_privilege('authenticated', 'public.checklist_template_edits', 'INSERT')
     or has_table_privilege('authenticated', 'public.checklist_template_edits', 'UPDATE')
     or has_table_privilege('authenticated', 'public.checklist_template_edits', 'DELETE') then
    raise exception 'Authenticated clients must not write checklist editor tables directly';
  end if;
  if has_table_privilege('anon', 'public.checklist_template_overrides', 'SELECT')
     or has_table_privilege('anon', 'public.checklist_template_edits', 'SELECT') then
    raise exception 'Anonymous clients must not read checklist editor data';
  end if;

  if to_regprocedure('public.normalize_checklist_template_sections(text,jsonb)') is null
     or to_regprocedure('public.save_checklist_template_override(text,text,text,jsonb,integer)') is null
     or to_regprocedure('public.reset_checklist_template_override(text)') is null then
    raise exception 'Checklist editor RPC functions are missing';
  end if;
  if not has_function_privilege('authenticated', 'public.save_checklist_template_override(text,text,text,jsonb,integer)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.reset_checklist_template_override(text)', 'EXECUTE') then
    raise exception 'Authenticated checklist editor RPC privileges are incomplete';
  end if;
  if has_function_privilege('anon', 'public.save_checklist_template_override(text,text,text,jsonb,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.reset_checklist_template_override(text)', 'EXECUTE') then
    raise exception 'Anonymous clients must not execute checklist editor RPCs';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'checklist_template_overrides'
      and policyname = 'checklist_template_overrides_select_active'
  ) or not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'checklist_template_edits'
      and policyname = 'checklist_template_edits_select_admin'
  ) then
    raise exception 'Checklist editor access policies are incomplete';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.checklist_template_overrides'::regclass
      and tgname = 'touch_checklist_template_overrides_updated_at'
      and not tgisinternal
  ) then
    raise exception 'Checklist template updated_at trigger is missing';
  end if;
end
$verify$;
`;
await executeSql(verificationSql);

const result = {
  ok: true,
  projectRef,
  migration: migrationFile,
  tables: ['checklist_template_overrides', 'checklist_template_edits'],
  verifiedAt: new Date().toISOString(),
};
await fs.writeFile(path.join(outputDir, 'database-verification.json'), JSON.stringify(result, null, 2));
console.log('Production checklist editor database migration and security verification passed.');
