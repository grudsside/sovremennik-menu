import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/live-preview.yml', 'utf8');
const deploy = fs.readFileSync('tools/live-preview-deploy.mjs', 'utf8');
const smoke = fs.readFileSync('tools/live-preview-smoke.mjs', 'utf8');
const config = fs.readFileSync('supabase/config.toml', 'utf8');

const required = [
  [workflow.includes('supabase --experimental branches create'), 'live preview must create an isolated Supabase branch'],
  [!workflow.includes('--with-data'), 'preview branch must not copy production data'],
  [workflow.includes('PREVIEW_BRANCH_PROJECT_REF') && workflow.includes('Refusing to deploy against the production project'), 'workflow must reject production deployment'],
  [workflow.includes('20260720193000_section_maintenance.sql'), 'maintenance migration must be applied to preview'],
  [workflow.includes('functions deploy admin-employees') && workflow.includes('functions deploy admin-maintenance'), 'preview admin functions must be deployed'],
  [workflow.includes('PREVIEW_TEST_PASSWORD') && workflow.includes('SUPABASE_ACCESS_TOKEN'), 'preview workflow must require protected credentials'],
  [deploy.includes("bucketId = 'open-test-preview'"), 'preview frontend must use a dedicated Storage bucket'],
  [deploy.includes('preview-admin') && deploy.includes('preview-manager') && deploy.includes('preview-barista') && deploy.includes('preview-waiter'), 'all role accounts must be seeded'],
  [deploy.includes('Preview project ref must differ from production'), 'preview deploy script must reject production'],
  [smoke.includes('Current admin demotion must be rejected'), 'live test must verify current admin protection'],
  [smoke.includes('Non-admin role change must be rejected'), 'live test must verify role authorization'],
  [smoke.includes('direct client maintenance write rejected'), 'live test must verify maintenance write protection'],
  [smoke.includes("sectionId: 'home'"), 'live test must verify protected sections'],
  [smoke.includes("role: 'barista'") && smoke.includes('isClosed: false'), 'live test must restore changed preview data'],
  [config.includes('[functions.admin-employees]') && config.includes('[functions.admin-maintenance]'), 'admin functions must be declared in config.toml'],
];

const forbidden = [
  [/\bdb push\b[\s\S]*PARENT_SUPABASE_PROJECT_REF/.test(workflow), 'workflow must not push migrations to the production parent'],
  [/functions deploy[\s\S]{0,200}PARENT_SUPABASE_PROJECT_REF/.test(workflow), 'workflow must not deploy functions to the production parent'],
  [/sb_secret_|service_role_[A-Za-z0-9]/.test(workflow + deploy + smoke), 'secret keys must never be hardcoded'],
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

console.log('Live preview workflow checks passed.');
