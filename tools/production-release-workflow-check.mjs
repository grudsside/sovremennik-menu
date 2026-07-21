import fs from 'node:fs';

const workflow = fs.readFileSync(
  '.github/workflows/production-admin-controls-release.yml',
  'utf8',
);
const release = fs.readFileSync(
  'tools/production-admin-controls-release.mjs',
  'utf8',
);

const productionRef = 'tjibbzfdughhjenumzxo';
const previewRef = 'enkftanmqlwvjydliwue';

const coffeeMigrations = [
  '20260721183000_coffee_revision_admin_correction.sql',
  '20260721190000_coffee_revision_formula_corrections.sql',
  '20260721203000_coffee_revision_total_stock.sql',
];

const required = [
  [workflow.includes('branches:\n      - main'), 'workflow must run only from main'],
  [workflow.includes(`PRODUCTION_PROJECT_REF: ${productionRef}`), 'workflow must use the fixed production ref'],
  [workflow.includes('PRODUCTION_PAGES_URL: https://grudsside.github.io/sovremennik-menu'), 'workflow must verify the fixed production Pages URL'],
  [workflow.includes('SUPABASE_ACCESS_TOKEN'), 'workflow must use the protected Supabase access token'],
  [workflow.includes('production-admin-controls-release.mjs'), 'workflow must use the reviewed production release script'],
  [coffeeMigrations.every(file => workflow.includes(file)), 'workflow must trigger for every coffee revision migration'],
  [coffeeMigrations.every(file => release.includes(file)), 'release script must apply every coffee revision migration'],
  [workflow.includes('assets/js/coffee-revision-editor.js') && workflow.includes('assets/css/coffee-revision-editor.css'), 'workflow must trigger for revision interface assets'],
  [workflow.includes('functions deploy admin-employees'), 'admin-employees must be deployed'],
  [workflow.includes('functions deploy admin-maintenance'), 'admin-maintenance must be deployed'],
  [workflow.includes("status\" == '401'") || workflow.includes("status\" == '403'"), 'workflow must verify authentication gates'],
  [workflow.includes('Verify published GitHub Pages frontend'), 'workflow must verify the published frontend'],
  [workflow.includes('section-maintenance.js') && workflow.includes('mobile-photo-expand.js'), 'workflow must verify existing frontend features'],
  [workflow.includes('coffee-revision-editor.js') && workflow.includes('coffee-revision-formula-fix.js'), 'workflow must verify coffee revision frontend assets'],
  [workflow.includes('grid-template-columns: repeat(12') && workflow.includes('height: 48px'), 'workflow must verify ordered equal-height correction controls'],
  [workflow.includes(`! grep -q '${previewRef}'`), 'workflow must reject preview configuration on production Pages'],
  [workflow.includes('statuses: write'), 'workflow must be allowed to publish a commit status'],
  [workflow.includes('Publish machine-readable production status'), 'workflow must publish a machine-readable release status'],
  [workflow.includes("context='production/admin-controls'"), 'production status must use a stable context'],
  [workflow.includes('repos/${GITHUB_REPOSITORY}/statuses/${GITHUB_SHA}'), 'production status must be attached to the released commit'],
  [workflow.includes("state='success'") && workflow.includes("state='failure'"), 'production status must represent both success and failure'],
  [workflow.includes('name: Publish machine-readable production status\n        if: always()\n        continue-on-error: true'), 'status reporting must run after both successful and failed releases without masking deployment results'],
  [workflow.includes('issues: write') && workflow.includes('Publish permanent release receipt'), 'workflow must publish a permanent audit receipt'],
  [workflow.includes('issues/33/comments'), 'release receipt must be attached to the approved production PR'],
  [workflow.includes("printf '%s\\n\\n' \"$heading\""), 'release receipt must use YAML-safe printf construction'],
  [workflow.includes('/tmp/production-release-comment.md'), 'release receipt must be written to a temporary file before posting'],
  [workflow.includes('name: Publish permanent release receipt\n        if: always()\n        continue-on-error: true'), 'optional receipt publishing must not fail a successful production deployment'],
  [release.includes(`/projects/${'${projectRef}'}/database/query`), 'release must use the Management API database query endpoint'],
  [release.includes('20260720193000_section_maintenance.sql'), 'release must apply the reviewed maintenance migration'],
  [release.includes('exactly 9 allowed maintenance sections'), 'release must verify all maintenance rows'],
  [release.includes("has_table_privilege('authenticated'"), 'release must verify authenticated privileges'],
  [release.includes("has_table_privilege('anon'"), 'release must verify anon privileges'],
  [release.includes('relrowsecurity'), 'release must verify RLS'],
  [release.includes('coffee_revision_edits') && release.includes('audit RLS'), 'release must verify correction audit protection'],
  [release.includes('grain_delivery') && release.includes('stock_balance_override'), 'release must verify total stock source columns'],
  [release.includes('total_loss_weight') && release.includes('total_grain_balance'), 'release must verify report formula columns'],
  [release.includes('security_invoker=true'), 'release must verify the reporting view security mode'],
  [release.includes('correct_coffee_revision(date,numeric,integer,numeric,numeric,text,numeric,numeric,text)'), 'release must verify the stock-aware correction RPC'],
  [release.includes("date '2199-12-27'") && release.includes('rollback;'), 'formula verification must run in a rolled-back production transaction'],
  [release.includes('day_two.total_grain_balance <> 65.500') && release.includes('day_three.total_grain_balance <> 61.200'), 'release must verify delivery and rolling stock calculations'],
];

const forbidden = [
  [new RegExp(`PRODUCTION_PROJECT_REF:\\s*${previewRef}`).test(workflow), 'production Project Ref must never point to preview'],
  [new RegExp(`PRODUCTION_SUPABASE_URL:[^\\n]*${previewRef}`).test(workflow), 'production URL must never point to preview'],
  [workflow.includes('functions deploy preview-site'), 'preview-site must not be deployed to production'],
  [workflow.includes('PREVIEW_DB_PASSWORD') || workflow.includes('PREVIEW_TEST_PASSWORD'), 'production release must not use preview credentials'],
  [/sbp_[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]{16,}|service_role_[A-Za-z0-9_-]{16,}/.test(workflow + release), 'secrets must never be hardcoded'],
  [workflow.includes('--no-verify-jwt'), 'production admin functions must keep JWT verification enabled'],
  [workflow.includes('body="${heading}\n'), 'release receipt must not use YAML-breaking unindented multiline assignment'],
  [release.includes('read_only: true'), 'production migrations must not be submitted as read-only'],
  [release.includes('delete from public.coffee_revisions') && !release.includes('rollback;'), 'formula checks must never leave production test deletions committed'],
];

const failures = [
  ...required.filter(([ok]) => !ok).map(([, message]) => message),
  ...forbidden.filter(([matched]) => matched).map(([, message]) => message),
];

if (failures.length) {
  console.error('Production release workflow checks failed:');
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log('Production release safety and machine-readable status checks passed.');