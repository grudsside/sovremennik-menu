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

const migrations = [
  {
    file: '20260720193000_section_maintenance.sql',
    marker: 'create table if not exists public.section_maintenance',
  },
  {
    file: '20260721183000_coffee_revision_admin_correction.sql',
    marker: 'create table if not exists public.coffee_revision_edits',
  },
  {
    file: '20260721190000_coffee_revision_formula_corrections.sql',
    marker: 'total_loss_weight_calc',
  },
  {
    file: '20260721203000_coffee_revision_total_stock.sql',
    marker: 'total_grain_balance_calc',
  },
];

for (const migration of migrations) {
  const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', migration.file);
  const migrationSql = await fs.readFile(migrationPath, 'utf8');
  assert(
    migrationSql.includes(migration.marker),
    `Unexpected production migration content: ${migration.file}`,
  );
  assert(
    !migrationSql.includes(expectedProductionRef),
    `Migration must not contain a hardcoded project reference: ${migration.file}`,
  );
  await executeSql(migrationSql);
}

const verificationSql = String.raw`
do $verify$
declare
  total_rows integer;
  allowed_rows integer;
  maintenance_rls boolean;
  audit_rls boolean;
  view_options text[];
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

  select c.relrowsecurity into maintenance_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'section_maintenance';

  if coalesce(maintenance_rls, false) is not true then
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

  if to_regclass('public.coffee_revision_edits') is null then
    raise exception 'coffee revision edit history table is missing';
  end if;

  select c.relrowsecurity into audit_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'coffee_revision_edits';

  if coalesce(audit_rls, false) is not true then
    raise exception 'RLS must be enabled for coffee_revision_edits';
  end if;

  if not has_table_privilege('authenticated', 'public.coffee_revision_edits', 'SELECT') then
    raise exception 'authenticated must receive SELECT for audit RLS evaluation';
  end if;
  if has_table_privilege('authenticated', 'public.coffee_revision_edits', 'INSERT')
     or has_table_privilege('authenticated', 'public.coffee_revision_edits', 'UPDATE')
     or has_table_privilege('authenticated', 'public.coffee_revision_edits', 'DELETE') then
    raise exception 'authenticated must not write coffee revision audit rows directly';
  end if;
  if has_table_privilege('anon', 'public.coffee_revision_edits', 'SELECT') then
    raise exception 'anon must not read coffee revision audit rows';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'coffee_revisions'
      and column_name = 'grain_delivery'
  ) then
    raise exception 'coffee_revisions.grain_delivery is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'coffee_revisions'
      and column_name = 'stock_balance_override'
  ) then
    raise exception 'coffee_revisions.stock_balance_override is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'coffee_revision_report'
      and column_name = 'total_loss_weight'
  ) then
    raise exception 'coffee_revision_report.total_loss_weight is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'coffee_revision_report'
      and column_name = 'total_grain_balance'
  ) then
    raise exception 'coffee_revision_report.total_grain_balance is missing';
  end if;

  select c.reloptions into view_options
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'coffee_revision_report';

  if not coalesce(view_options, array[]::text[]) @> array['security_invoker=true'] then
    raise exception 'coffee_revision_report must use security_invoker';
  end if;

  if not has_table_privilege('authenticated', 'public.coffee_revision_report', 'SELECT') then
    raise exception 'authenticated must read coffee_revision_report';
  end if;
  if has_table_privilege('anon', 'public.coffee_revision_report', 'SELECT') then
    raise exception 'anon must not read coffee_revision_report';
  end if;

  if to_regprocedure('public.correct_coffee_revision(date,numeric,integer,numeric,numeric,text,numeric,numeric,text)') is null then
    raise exception 'stock-aware correct_coffee_revision function is missing';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.correct_coffee_revision(date,numeric,integer,numeric,numeric,text,numeric,numeric,text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated must be able to call protected coffee revision correction';
  end if;
end
$verify$;
`;

await executeSql(verificationSql);

const formulaVerificationSql = String.raw`
begin;

delete from public.coffee_revision_edits
where revision_date between date '2199-12-27' and date '2199-12-29';
delete from public.coffee_revisions
where revision_date between date '2199-12-27' and date '2199-12-29';

insert into public.coffee_revisions (
  revision_date,
  employee_name,
  hopper_weight,
  opened_packs,
  write_offs,
  iiko_sales,
  grain_delivery,
  stock_balance_override
) values
  (date '2199-12-27', 'Production Formula Check', 1.847, 0, 0, 0, 0, 60.000),
  (date '2199-12-28', 'Production Formula Check', 1.347, 4, 0.200, 4.400, 10.000, null),
  (date '2199-12-29', 'Production Formula Check', 1.047, 4, 0.100, 4.500, 0, null);

do $formula$
declare
  day_one record;
  day_two record;
  day_three record;
begin
  select total_grain_balance
    into day_one
  from public.coffee_revision_report
  where revision_date = date '2199-12-27';

  if day_one.total_grain_balance <> 60.000 then
    raise exception 'Starting total grain stock is incorrect: %', row_to_json(day_one);
  end if;

  select clean_hopper_weight, total_coffee_usage, difference,
         total_loss_weight, losses_percent, total_grain_balance
    into day_two
  from public.coffee_revision_report
  where revision_date = date '2199-12-28';

  if day_two.clean_hopper_weight <> 0.500
     or day_two.total_coffee_usage <> 4.500
     or day_two.difference <> -0.300
     or day_two.total_loss_weight <> 0.500
     or day_two.losses_percent <> 11.36
     or day_two.total_grain_balance <> 65.500 then
    raise exception 'Day two coffee formulas are incorrect: %', row_to_json(day_two);
  end if;

  select total_coffee_usage, difference, total_loss_weight,
         losses_percent, total_grain_balance
    into day_three
  from public.coffee_revision_report
  where revision_date = date '2199-12-29';

  if day_three.total_coffee_usage <> 4.300
     or day_three.difference <> 0.100
     or day_three.total_loss_weight <> 0.100
     or day_three.losses_percent <> 2.22
     or day_three.total_grain_balance <> 61.200 then
    raise exception 'Day three coffee formulas are incorrect: %', row_to_json(day_three);
  end if;
end
$formula$;

rollback;
`;

await executeSql(formulaVerificationSql);

const report = {
  ok: true,
  projectRef,
  migrations: migrations.map(item => item.file),
  verified: [
    'exactly 9 allowed maintenance sections',
    'maintenance and coffee audit RLS enabled',
    'authenticated and anon privileges restricted',
    'coffee correction audit history available only through RLS',
    'grain delivery and stock anchor columns installed',
    'loss and total stock view columns installed',
    'security-invoker reporting view enabled',
    'stock-aware administrator correction RPC installed',
    'loss, delivery and rolling stock formulas verified in a rolled-back production transaction',
  ],
  completedAt: new Date().toISOString(),
};

await fs.writeFile(
  path.join(outputDir, 'database-release.json'),
  JSON.stringify(report, null, 2),
);
console.log('Production maintenance and coffee revision migrations applied and verified.');