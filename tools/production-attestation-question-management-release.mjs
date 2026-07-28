import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const expectedProductionRef = 'tjibbzfdughhjenumzxo';
const previewRef = 'enkftanmqlwvjydliwue';
const projectRef = String(process.env.PRODUCTION_PROJECT_REF || '').trim();
const accessToken = String(process.env.SUPABASE_ACCESS_TOKEN || '').trim();
const migrationFile = '20260728223000_attestation_question_management.sql';

assert(accessToken, 'SUPABASE_ACCESS_TOKEN is required.');
assert.equal(projectRef, expectedProductionRef, 'Question management release must target the fixed production Project Ref.');

const managementApi = 'https://api.supabase.com/v1';
const outputDir = path.join(process.cwd(), 'artifacts', 'production-attestation-question-management-release');

async function managementRequest(endpoint, options = {}) {
  const response = await fetch(`${managementApi}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? {'Content-Type':'application/json'} : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if(!response.ok) throw new Error(`Supabase Management API ${response.status} for ${endpoint}: ${text.slice(0, 800)}`);
  if(!text.trim()) return null;
  try{ return JSON.parse(text); }catch{ return text; }
}

async function executeSql(query){
  return managementRequest(`/projects/${projectRef}/database/query`, {
    method:'POST',
    body:JSON.stringify({query, read_only:false})
  });
}

await fs.mkdir(outputDir, {recursive:true});
const project = await managementRequest(`/projects/${projectRef}`);
assert.equal(String(project?.ref || project?.id || '').trim(), projectRef, 'Management API returned another project.');

const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', migrationFile);
const migrationSql = await fs.readFile(migrationPath, 'utf8');
for(const marker of [
  'add column if not exists updated_by',
  'add column if not exists deleted_at',
  'add column if not exists deleted_by',
  'attestation_questions_admin_update',
  'attestation_questions_admin_delete',
  'touch_attestation_question_management'
]) assert(migrationSql.includes(marker), `Question management migration marker is missing: ${marker}`);
assert(!migrationSql.includes(expectedProductionRef));
assert(!migrationSql.includes(previewRef));
await executeSql(migrationSql);

const verificationSql = String.raw`
do $verify$
declare
  question_rls boolean;
begin
  if to_regclass('public.attestation_questions') is null then
    raise exception 'attestation_questions table is missing';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='attestation_questions' and column_name='updated_by')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='attestation_questions' and column_name='deleted_at')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='attestation_questions' and column_name='deleted_by') then
    raise exception 'Question management audit columns are incomplete';
  end if;

  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='attestation_questions_deleted_at_idx') then
    raise exception 'Question deletion index is missing';
  end if;

  select c.relrowsecurity into question_rls
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='attestation_questions';
  if coalesce(question_rls,false) is not true then raise exception 'Question bank RLS must remain enabled'; end if;

  if to_regprocedure('public.touch_attestation_question_management()') is null then
    raise exception 'Question management audit trigger function is missing';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid='public.attestation_questions'::regclass
      and tgname='attestation_questions_management_touch'
      and not tgisinternal
  ) then raise exception 'Question management audit trigger is missing'; end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='attestation_questions' and policyname='attestation_questions_admin_select')
     or not exists (select 1 from pg_policies where schemaname='public' and tablename='attestation_questions' and policyname='attestation_questions_admin_insert')
     or not exists (select 1 from pg_policies where schemaname='public' and tablename='attestation_questions' and policyname='attestation_questions_admin_update')
     or not exists (select 1 from pg_policies where schemaname='public' and tablename='attestation_questions' and policyname='attestation_questions_admin_delete') then
    raise exception 'Question management RLS policies are incomplete';
  end if;

  if has_function_privilege('authenticated','public.touch_attestation_question_management()','EXECUTE')
     or has_function_privilege('anon','public.touch_attestation_question_management()','EXECUTE') then
    raise exception 'Audit trigger function must not be directly executable by clients';
  end if;
  if has_table_privilege('anon','public.attestation_questions','SELECT') then
    raise exception 'Anon must not read the question bank';
  end if;
end
$verify$;
`;
await executeSql(verificationSql);

const result = {
  ok:true,
  projectRef,
  migration:migrationFile,
  table:'attestation_questions',
  capabilities:['edit questions','soft delete questions','suppress deleted generated questions'],
  verifiedAt:new Date().toISOString()
};
await fs.writeFile(path.join(outputDir, 'verification.json'), JSON.stringify(result, null, 2));
console.log('Production attestation question management migration and security verification passed.');