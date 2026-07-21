import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const expectedProductionRef = 'tjibbzfdughhjenumzxo';
const projectRef = String(process.env.PRODUCTION_PROJECT_REF || '').trim();
const accessToken = String(process.env.SUPABASE_ACCESS_TOKEN || '').trim();

assert(accessToken, 'SUPABASE_ACCESS_TOKEN is required.');
assert.equal(
  projectRef,
  expectedProductionRef,
  'Production release must target the fixed production Project Ref.',
);

const managementApi = 'https://api.supabase.com/v1';
const outputDir = path.join(process.cwd(), 'artifacts', 'production-release');

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
    throw new Error(
      `Supabase Management API ${response.status} for ${endpoint}: ${text.slice(0, 800)}`,
    );
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
const returnedRef = String(project?.ref || project?.id || '').trim();
assert.equal(returnedRef, projectRef, 'Management API returned a different project.');

const migrationPath = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260720193000_section_maintenance.sql',
);
const migrationSql = await fs.readFile(migrationPath, 'utf8');
assert(
  migrationSql.includes('create table if not exists public.section_maintenance'),
  'Unexpected production migration content.',
);
assert(
  !migrationSql.includes(expectedProductionRef),
  'Migration must not contain a hardcoded project reference.',
);

await executeSql(migrationSql);

const verificationSql = String.raw`
do $verify$
declare
  total_rows integer;
  allowed_rows integer;
  rls_enabled boolean;
begin
  select count(*) into total_rows from public.section_maintenance;
  select count(*) into allowed_rows
  from public.section_maintenance
  where section_id in (
    'tasks','method','theory','checklists','revisions',
    'techcards','schedule','reportError','control'
  );

  if total_rows <> 9 or allowed_rows <> 9 then
    raise exception 'section_maintenance must contain exactly 9 allowed rows';
  end if;

  select c.relrowsecurity into rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'section_maintenance';

  if coalesce(rls_enabled, false) is not true then
    raise exception 'RLS must be enabled for section_maintenance';
  end if;

  if not has_table_privilege('authenticated', 'public.section_maintenance', 'SELECT') then
    raise exception 'authenticated must have SELECT on section_maintenance';
  end if;
  if has_table_privilege('authenticated', 'public.section_maintenance', 'INSERT')
     or has_table_privilege('authenticated', 'public.section_maintenance', 'UPDATE')
     or has_table_privilege('authenticated', 'public.section_maintenance', 'DELETE') then
    raise exception 'authenticated must not write section_maintenance directly';
  end if;
  if has_table_privilege('anon', 'public.section_maintenance', 'SELECT') then
    raise exception 'anon must not read section_maintenance';
  end if;
end
$verify$;
`;

await executeSql(verificationSql);

const report = {
  ok: true,
  projectRef,
  migration: '20260720193000_section_maintenance.sql',
  verified: [
    'exactly 9 allowed maintenance sections',
    'RLS enabled',
    'authenticated SELECT granted',
    'authenticated writes revoked',
    'anon SELECT revoked',
  ],
  completedAt: new Date().toISOString(),
};

await fs.writeFile(
  path.join(outputDir, 'database-release.json'),
  JSON.stringify(report, null, 2),
);
console.log('Production maintenance migration applied and verified.');
