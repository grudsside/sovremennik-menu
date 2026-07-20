import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const maintenance = read('assets/js/section-maintenance.js');
const maintenanceCss = read('assets/css/section-maintenance.css');
const photo = read('assets/js/mobile-photo-expand.js');
const photoCss = read('assets/css/mobile-photo-expand.css');
const config = read('assets/js/supabase-config.js');
const loader = read('assets/js/push.js');
const edge = read('supabase/functions/admin-maintenance/index.ts');
const migration = read('supabase/migrations/20260720193000_section_maintenance.sql');

const required = [
  [config.includes('maintenanceFunctionUrl'), 'maintenance Edge Function URL must be configured'],
  [loader.includes('section-maintenance.css') && loader.includes('section-maintenance.js'), 'maintenance assets must be loaded'],
  [loader.includes('mobile-photo-expand.css') && loader.includes('mobile-photo-expand.js'), 'mobile photo assets must be loaded'],
  [maintenance.includes("PROTECTED_SECTIONS = new Set(['home', 'employees'])"), 'home and employee administration must stay available'],
  [maintenance.includes(".from('section_maintenance')"), 'clients must read centralized maintenance state'],
  [maintenance.includes("action:'set'"), 'admin maintenance changes must use the protected Edge Function'],
  [maintenance.includes('data-maintenance-panel'), 'closed sections must render a maintenance panel'],
  [maintenanceCss.includes('.maintenance-message-card'), 'maintenance message styling is required'],
  [edge.includes('evaluateAdminAccess'), 'maintenance writes must verify an active admin profile'],
  [edge.includes('allowedSections'), 'maintenance writes must use a section allowlist'],
  [edge.includes('.from("section_maintenance")') && edge.includes('.upsert('), 'maintenance state must be persisted'],
  [migration.includes('enable row level security'), 'maintenance table must use RLS'],
  [migration.includes('grant select on table public.section_maintenance to authenticated'), 'authenticated users must be able to read maintenance state'],
  [migration.includes('revoke insert, update, delete'), 'clients must not write maintenance state directly'],
  [photo.includes("document.addEventListener('click'"), 'mobile photo viewer must use delegated click handling'],
  [photo.includes('stopImmediatePropagation'), 'mobile photo viewer must suppress the fragile card toggle'],
  [photo.includes('data-mobile-photo-viewer'), 'mobile photo viewer dialog is required'],
  [photoCss.includes('position:fixed') && photoCss.includes('touch-action'), 'mobile photo viewer must be full-screen and touch-safe'],
];

const failures = required.filter(([ok]) => !ok).map(([, message]) => message);
if(failures.length){
  console.error('Open-test admin control checks failed:');
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log('Open-test admin control checks passed.');
