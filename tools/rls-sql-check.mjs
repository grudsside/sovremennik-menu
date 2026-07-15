import fs from 'node:fs';

const mainPath = 'supabase/sql/STEP_10_HARDEN_RLS.sql';
const finalizePath = 'supabase/sql/STEP_10B_HARDEN_RLS_VIEW_PRIVILEGES.sql';

const main = fs.readFileSync(mainPath, 'utf8');
const finalize = fs.readFileSync(finalizePath, 'utf8');
const failures = [];

function requirePattern(source, pattern, message) {
  if (!pattern.test(source)) failures.push(message);
}

function rejectPattern(source, pattern, message) {
  if (pattern.test(source)) failures.push(message);
}

requirePattern(main, /\bbegin;[\s\S]*\ncommit;/i, 'STEP 10 must run in one transaction.');
requirePattern(main, /create or replace function public\.is_active_user\(\)/i, 'Missing active-profile helper.');
requirePattern(main, /create or replace function public\.is_admin\(\)[\s\S]*?p\.role\s*=\s*'admin'/i, 'is_admin must require the admin role.');
requirePattern(main, /create or replace function public\.is_admin_or_manager\(\)/i, 'Missing admin-or-manager helper.');
requirePattern(main, /grant update\s*\(status,\s*completed_at\)\s*on table public\.tasks/i, 'Task updates must be column-limited.');
requirePattern(main, /create policy "tasks_select_participant"[\s\S]*?creator_id\s*=\s*auth\.uid\(\)[\s\S]*?assignee_id\s*=\s*auth\.uid\(\)/i, 'Task participant policy is incomplete.');
requirePattern(main, /create trigger enforce_coffee_revision_write/i, 'Missing coffee revision write trigger.');
requirePattern(main, /alter view public\.coffee_revision_report set \(security_invoker = true\)/i, 'coffee_revision_report must use security_invoker.');
requirePattern(main, /drop policy if exists "push admin select"/i, 'Old Push admin-read policy must be removed.');
requirePattern(main, /create policy "push_subscriptions_select_active_own"/i, 'Push subscriptions must be owner-only.');
requirePattern(main, /create policy "notification_preferences_select_active_own"/i, 'Notification preferences must be owner-only.');
requirePattern(main, /create policy "notification_events_select_active_own"/i, 'Notification events must be owner-only.');
requirePattern(main, /revoke all on table public\.profiles from public, anon/i, 'Internal tables must be revoked from anon.');
requirePattern(main, /drop policy if exists "profiles_update_admin"/i, 'Direct profile update policy must be removed.');

rejectPattern(main, /create policy "coffee_revision_update_authenticated"/i, 'Broad coffee revision update policy returned.');
rejectPattern(main, /create policy "coffee_revision_upsert_authenticated"/i, 'Broad coffee revision insert policy returned.');
rejectPattern(main, /create policy "push admin select"/i, 'Push admin-read policy was recreated.');
rejectPattern(main, /create policy "prefs admin select"/i, 'Preferences admin-read policy was recreated.');
rejectPattern(main, /create policy "events admin select"/i, 'Events admin-read policy was recreated.');

requirePattern(finalize, /\bbegin;[\s\S]*\ncommit;/i, 'STEP 10B must run in one transaction.');
requirePattern(finalize, /revoke all on table public\.coffee_revision_report from authenticated/i, 'STEP 10B must clear broad view privileges.');
requirePattern(finalize, /grant select on table public\.coffee_revision_report to authenticated/i, 'STEP 10B must grant SELECT only.');

if (failures.length) {
  console.error('RLS migration checks failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('RLS migration structure checks passed.');
