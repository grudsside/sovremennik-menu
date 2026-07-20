import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/live-preview.yml', 'utf8');
const deploy = fs.readFileSync('tools/live-preview-deploy.mjs', 'utf8');
const smoke = fs.readFileSync('tools/live-preview-smoke.mjs', 'utf8');
const resolver = fs.readFileSync('tools/live-preview-resolve-keys.mjs', 'utf8');
const migrations = fs.readFileSync('tools/live-preview-prepare-migrations.mjs', 'utf8');
const config = fs.readFileSync('supabase/config.toml', 'utf8');

const previewRef = 'enkftanmqlwvjydliwue';
const productionRef = 'tjibbzfdughhjenumzxo';

const required = [
  [workflow.includes(`PREVIEW_PROJECT_REF: ${previewRef}`), 'workflow must target the dedicated Free preview project'],
  [workflow.includes(`PREVIEW_SUPABASE_URL: https://${previewRef}.supabase.co`), 'workflow preview URL must match the dedicated project'],
  [workflow.includes(`PRODUCTION_SUPABASE_PROJECT_REF: ${productionRef}`), 'workflow must identify the production project explicitly'],
  [workflow.includes('Refusing to deploy against the production project'), 'workflow must reject production database deployment'],
  [workflow.includes('Refusing to deploy Edge Functions against production'), 'workflow must reject production function deployment'],
  [workflow.includes('SUPABASE_ACCESS_TOKEN') && workflow.includes('PREVIEW_DB_PASSWORD') && workflow.includes('PREVIEW_TEST_PASSWORD'), 'Free preview workflow must require all three protected credentials'],
  [workflow.includes('/api-keys?reveal=true') && workflow.includes('live-preview-resolve-keys.mjs'), 'workflow must resolve preview API keys through the Management API'],
  [workflow.includes('live-preview-prepare-migrations.mjs'), 'workflow must prepare a deterministic migration bundle'],
  [workflow.includes('supabase link') && workflow.includes('--password "$SUPABASE_DB_PASSWORD"'), 'workflow must link only with the preview database password'],
  [workflow.includes('supabase db push --dry-run --include-all'), 'workflow must preview database changes before applying them'],
  [workflow.includes('supabase db push --include-all --yes'), 'workflow must apply the reviewed migration bundle'],
  [workflow.includes('functions deploy admin-employees') && workflow.includes('functions deploy admin-maintenance'), 'preview admin functions must be deployed'],
  [resolver.includes('PREVIEW_PUBLIC_KEY') && resolver.includes('PREVIEW_SECRET_KEY') && resolver.includes('::add-mask::'), 'preview keys must be masked and exported safely'],
  [deploy.includes("bucketId = 'open-test-preview'"), 'preview frontend must use a dedicated Storage bucket'],
  [deploy.includes('preview-admin') && deploy.includes('preview-manager') && deploy.includes('preview-barista') && deploy.includes('preview-waiter'), 'all role accounts must be seeded'],
  [deploy.includes('Preview project ref must differ from production'), 'preview deploy script must reject production'],
  [deploy.includes('Preview URL must match the dedicated preview project ref'), 'preview deploy script must bind URL to Project Ref'],
  [smoke.includes('current admin demotion rejected'), 'live test must verify current admin protection'],
  [smoke.includes('non-admin role change rejected'), 'live test must verify role authorization'],
  [smoke.includes('direct client maintenance write rejected'), 'live test must verify maintenance write protection'],
  [smoke.includes("sectionId: 'home'"), 'live test must verify protected sections'],
  [smoke.includes("role: 'barista'") && smoke.includes('isClosed: false'), 'live test must restore changed preview data'],
  [migrations.includes('STEP_1_SCHEMA_AND_POLICIES.sql') && migrations.includes('STEP_10_HARDEN_RLS.sql') && migrations.includes('STEP_12_NOTIFICATION_HISTORY.sql'), 'preview migration bundle must include the application base and current security patches'],
  [migrations.includes('20260720193000_section_maintenance.sql'), 'preview migration bundle must include section maintenance'],
  [migrations.includes('STEP_2_SEED_ADMIN_AFTER_AUTH_USER.sql') && migrations.includes('Forbidden preview SQL selected'), 'migration builder must explicitly guard forbidden production-oriented SQL'],
  [config.includes('[functions.admin-employees]') && config.includes('[functions.admin-maintenance]'), 'admin functions must be declared in config.toml'],
];

const forbidden = [
  [/supabase\s+--experimental\s+branches\s+(create|get)/i.test(workflow), 'paid Supabase Branching must not be used for the Free preview'],
  [/--with-data/.test(workflow), 'preview must not copy production data'],
  [/functions deploy[\s\S]{0,240}PRODUCTION_SUPABASE_PROJECT_REF/.test(workflow), 'workflow must not deploy functions using the production ref'],
  [/\bdb push\b[\s\S]{0,240}PRODUCTION_SUPABASE_PROJECT_REF/.test(workflow), 'workflow must not push migrations using the production ref'],
  [/\['supabase\/sql\/STEP_2_SEED_ADMIN_AFTER_AUTH_USER\.sql'\s*,/.test(migrations), 'preview bundle must not seed the production administrator'],
  [/\['supabase\/sql\/STEP_3_OPTIONAL_JULY_SCHEDULE\.sql'\s*,/.test(migrations), 'preview bundle must not load optional production schedule data'],
  [/\['supabase\/sql\/STEP_7_FIX_RLS_CONTENT_SYNC\.sql'\s*,/.test(migrations), 'preview bundle must not run the hardcoded grigory patch'],
  [/\['supabase\/sql\/ROLLBACK_STEP_12_NOTIFICATION_HISTORY\.sql'\s*,/.test(migrations), 'preview bundle must not apply rollback SQL'],
  [/sb_secret_[A-Za-z0-9_-]{16,}|service_role_[A-Za-z0-9_-]{16,}/.test(workflow + deploy + smoke + resolver), 'secret keys must never be hardcoded'],
];

const failures = [
  ...required.filter(([ok]) => !ok).map(([, message]) => message),
  ...forbidden.filter(([matched]) => matched).map(([, message]) => message),
];

if (failures.length) {
  console.error('Live preview workflow checks failed:');
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log('Dedicated Free live preview workflow checks passed.');
