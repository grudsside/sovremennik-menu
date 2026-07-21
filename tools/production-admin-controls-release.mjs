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
  {
    file: '20260721223000_coffee_revision_integrity_summary.sql',
    marker: 'opening_clean_hopper_weight',
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
  write_guard text;
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
      and table_name = 'coffee_revisions'
      and column_name = 'opening_clean_hopper_weight'
  ) then
    raise exception 'coffee_revisions.opening_clean_hopper_weight is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'coffee_revisions'
      and column_name = 'opening_total_grain_balance'
  ) then
    raise exception 'coffee_revisions.opening_total_grain_balance is missing';
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

  select pg_get_functiondef('public.enforce_coffee_revision_write()'::regprocedure)
    into write_guard;
  if position('app.coffee_revision_admin_correction' in write_guard) = 0
     or position('Revision already submitted' in write_guard) = 0 then
    raise exception 'coffee revision duplicate overwrite guard is missing';
  end if;
end
$verify$;
`;

await executeSql(verificationSql);

const historicalVerificationSql = String.raw`
do $historical$
declare
  day_13 record;
  day_14 record;
  day_15 record;
begin
  select cr.employee_name, cr.hopper_weight, cr.opened_packs, cr.write_offs, cr.iiko_sales,
         cr.checked, cr.opening_clean_hopper_weight, cr.opening_total_grain_balance,
         report.clean_hopper_weight, report.total_coffee_usage, report.difference,
         report.total_loss_weight, report.losses_percent, report.total_grain_balance
    into day_13
  from public.coffee_revisions cr
  join public.coffee_revision_report report using (revision_date)
  where cr.revision_date = date '2026-07-13';

  if not found
     or day_13.employee_name <> 'Глеб'
     or day_13.hopper_weight <> 1.194
     or day_13.opened_packs <> 4
     or day_13.write_offs <> 0.504
     or day_13.iiko_sales <> 4.200
     or day_13.checked is not null
     or day_13.opening_clean_hopper_weight <> 0.235
     or day_13.opening_total_grain_balance <> 60.235
     or day_13.clean_hopper_weight <> 0.347
     or day_13.total_coffee_usage <> 3.888
     or day_13.difference <> -0.192
     or day_13.total_loss_weight <> 0.696
     or day_13.losses_percent <> 16.57
     or day_13.total_grain_balance <> 56.347 then
    raise exception 'Confirmed 13.07 coffee data is incorrect: %', row_to_json(day_13);
  end if;

  select cr.employee_name, cr.hopper_weight, cr.opened_packs, cr.write_offs, cr.iiko_sales,
         cr.checked, report.clean_hopper_weight, report.total_coffee_usage, report.difference,
         report.total_loss_weight, report.losses_percent, report.total_grain_balance
    into day_14
  from public.coffee_revisions cr
  join public.coffee_revision_report report using (revision_date)
  where cr.revision_date = date '2026-07-14';

  if not found
     or day_14.employee_name <> 'Дима'
     or day_14.hopper_weight <> 1.613
     or day_14.opened_packs <> 4
     or day_14.write_offs <> 0.198
     or day_14.iiko_sales <> 3.330
     or day_14.checked is not null
     or day_14.clean_hopper_weight <> 0.766
     or day_14.total_coffee_usage <> 3.581
     or day_14.difference <> -0.449
     or day_14.total_loss_weight <> 0.647
     or day_14.losses_percent <> 19.43
     or day_14.total_grain_balance <> 52.766 then
    raise exception 'Confirmed 14.07 coffee data is incorrect: %', row_to_json(day_14);
  end if;

  select cr.employee_name, cr.hopper_weight, cr.opened_packs, cr.write_offs, cr.iiko_sales,
         cr.checked, report.clean_hopper_weight, report.total_coffee_usage, report.difference,
         report.total_loss_weight, report.losses_percent, report.total_grain_balance
    into day_15
  from public.coffee_revisions cr
  join public.coffee_revision_report report using (revision_date)
  where cr.revision_date = date '2026-07-15';

  if not found
     or day_15.employee_name <> 'Глеб'
     or day_15.hopper_weight <> 1.392
     or day_15.opened_packs <> 3
     or day_15.write_offs <> 0.118
     or day_15.iiko_sales <> 3.528
     or day_15.checked is not null
     or day_15.clean_hopper_weight <> 0.545
     or day_15.total_coffee_usage <> 3.221
     or day_15.difference <> 0.189
     or day_15.total_loss_weight <> 0.118
     or day_15.losses_percent <> 3.34
     or day_15.total_grain_balance <> 49.545 then
    raise exception 'Confirmed 15.07 coffee data is incorrect: %', row_to_json(day_15);
  end if;

  if (
    select count(*)
    from public.coffee_revision_edits
    where revision_date between date '2026-07-13' and date '2026-07-15'
      and reason = 'Восстановление подтверждённых данных из рабочей таблицы за 13–15.07.2026'
  ) < 3 then
    raise exception 'Historical coffee repair audit entries are missing';
  end if;
end
$historical$;
`;

await executeSql(historicalVerificationSql);

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
  stock_balance_override,
  opening_clean_hopper_weight,
  opening_total_grain_balance
) values
  (date '2199-12-27', 'Production Formula Check', 1.847, 0, 0, 0, 0, null, 1.000, 60.000),
  (date '2199-12-28', 'Production Formula Check', 1.347, 4, 0.200, 4.400, 10.000, null, null, null),
  (date '2199-12-29', 'Production Formula Check', 1.047, 4, 0.100, 4.500, 0, null, null, null);

do $formula$
declare
  day_one record;
  day_two record;
  day_three record;
  admin_id uuid;
begin
  select total_coffee_usage, total_grain_balance
    into day_one
  from public.coffee_revision_report
  where revision_date = date '2199-12-27';

  if day_one.total_coffee_usage <> 0.000
     or day_one.total_grain_balance <> 60.000 then
    raise exception 'Opening anchor calculation is incorrect: %', row_to_json(day_one);
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

  select p.id into admin_id
  from public.profiles p
  where p.is_active = true and p.role = 'admin'
  order by p.id
  limit 1;

  if admin_id is null then
    raise exception 'Active production administrator is required for overwrite guard verification';
  end if;

  perform set_config('request.jwt.claim.sub', admin_id::text, true);

  begin
    update public.coffee_revisions
    set hopper_weight = 9
    where revision_date = date '2199-12-28';
    raise exception 'Direct operational overwrite unexpectedly succeeded';
  exception
    when unique_violation then null;
  end;

  perform public.correct_coffee_revision(
    date '2199-12-28',
    1.347,
    4,
    0.200,
    4.400,
    'Production Formula Check',
    10.000,
    null,
    'Production audited correction verification'
  );

  perform set_config('request.jwt.claim.sub', '', true);
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
    'grain delivery, stock and opening anchor columns installed',
    'loss and total stock view columns installed',
    'security-invoker reporting view enabled',
    'submitted operational revisions protected from duplicate overwrites',
    'stock-aware administrator correction RPC installed',
    'confirmed 13–15 July revision values restored with audit history',
    'loss, opening anchor, delivery and rolling stock formulas verified in a rolled-back production transaction',
  ],
  completedAt: new Date().toISOString(),
};

await fs.writeFile(
  path.join(outputDir, 'database-release.json'),
  JSON.stringify(report, null, 2),
);
console.log('Production maintenance and coffee revision migrations applied and verified.');
