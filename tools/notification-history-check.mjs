import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const sql = read('supabase/sql/STEP_12_NOTIFICATION_HISTORY.sql');
const rollback = read('supabase/sql/ROLLBACK_STEP_12_NOTIFICATION_HISTORY.sql');
const core = read('assets/js/notification-history-core.js');
const client = read('assets/js/notifications.js');
const app = read('assets/js/app.js');
const html = read('index.html');
const css = read('assets/css/styles.css');
const push = read('supabase/functions/_shared/push.ts');
const notify = read('supabase/functions/notify-event/index.ts');

const failures = [];
function requirePattern(source, pattern, message){
  if(!pattern.test(source)) failures.push(message);
}

requirePattern(sql, /\bbegin;[\s\S]*\ncommit;/i, 'STEP 12 must run in one transaction.');
requirePattern(sql, /add column read_at timestamptz/i, 'STEP 12 must add read_at.');
requirePattern(sql, /if not exists[\s\S]*column_name\s*=\s*'read_at'[\s\S]*set read_at\s*=\s*coalesce\(sent_at, created_at\)/i, 'Existing notifications must be backfilled only when read_at is first added.');
requirePattern(sql, /revoke update on table public\.notification_events from authenticated, anon/i, 'Broad client UPDATE privileges must be revoked.');
requirePattern(sql, /grant update\s*\(read_at\)[\s\S]*to authenticated/i, 'Authenticated users need column-limited read_at updates.');
requirePattern(sql, /create policy "notification_events_update_read_active_own"[\s\S]*is_active_user\(\)[\s\S]*user_id\s*=\s*auth\.uid\(\)/i, 'Notification read updates must be active-owner-only.');
requirePattern(sql, /alter publication supabase_realtime[\s\S]*add table public\.notification_events/i, 'Notification events must be added to Realtime idempotently.');
requirePattern(rollback, /pg_publication_tables[\s\S]*alter publication supabase_realtime[\s\S]*drop table public\.notification_events/i, 'Rollback must remove notification_events from Realtime idempotently.');
requirePattern(rollback, /drop policy if exists "notification_events_update_read_active_own"/i, 'Rollback must remove the STEP 12 UPDATE policy.');
requirePattern(rollback, /revoke update \(read_at\)[\s\S]*authenticated/i, 'Rollback must revoke read_at updates.');
requirePattern(rollback, /drop index if exists public\.idx_notification_events_user_unread_created/i, 'Rollback must remove the unread index.');
if(/drop column[\s\S]*read_at|delete[\s\S]*notification_events/i.test(rollback)){
  failures.push('Safe rollback must retain read_at and notification history rows.');
}

const eventInsert = push.indexOf('.insert({');
const preferenceCheck = push.indexOf('if (!prefAllows');
if(eventInsert < 0 || preferenceCheck < 0 || eventInsert > preferenceCheck){
  failures.push('Addressed notification events must be inserted before Push preferences are checked.');
}
requirePattern(push, /status:\s*"preference_disabled"/i, 'Preference-disabled delivery status is required.');
requirePattern(notify, /eventKeySource\s*=\s*revision\.revision_date[\s\S]*eventKeySource\s*\|\|\s*sourceId/i, 'Revision date must be used for dedupe without writing it to UUID source_id.');

for(const [pattern, message] of [
  [/const PAGE_SIZE = 20/, 'The first notification page must contain 20 rows.'],
  [/У вас пока нет уведомлений/, 'The empty notification message is missing.'],
  [/Не удалось загрузить уведомления\. Попробуйте ещё раз/, 'The notification load error is missing.'],
  [/Отметить все как прочитанные/, 'Mark-all action is missing.'],
  [/Показать ещё/, 'Notification pagination action is missing.'],
  [/\.update\(\{\s*read_at\s*:\s*readAt\s*\}\)/, 'Individual read status update is missing.'],
  [/\.select\(SELECT_COLUMNS\)[\s\S]*?\.eq\('user_id', userId\)/, 'Notification pages must be explicitly scoped to the current employee.'],
  [/\.update\(\{\s*read_at\s*:\s*readAt\s*\}\)[\s\S]*?\.eq\('user_id', userId\)/, 'Read updates must be explicitly scoped to the current employee.'],
  [/event:\s*'INSERT'[\s\S]*table:\s*TABLE[\s\S]*user_id=eq\./, 'Owner-filtered Realtime subscription is missing.']
]) requirePattern(client, pattern, message);

requirePattern(client, /\.order\('created_at',[\s\S]*?\.order\('id',[\s\S]*?\.limit\(limit \+ 1\)/, 'History must use stable created_at/id keyset ordering.');
requirePattern(client, /created_at\.lt\.[\s\S]*created_at\.eq\.[\s\S]*id\.lt\./, 'History keyset cursor filter is missing.');
if(/\.range\(|state\.rows\.length[\s\S]*from/i.test(client)){
  failures.push('Notification pagination must not use mutable offset/range loading.');
}
requirePattern(core, /generation \+= 1[\s\S]*function activate[\s\S]*generation \+= 1|function activate[\s\S]*generation \+= 1[\s\S]*function deactivate[\s\S]*generation \+= 1/i, 'Activation and deactivation must advance the state generation.');
requirePattern(core, /topRefreshPending[\s\S]*listBusy[\s\S]*schedulePendingTopRefresh/i, 'Realtime top refreshes must be serialized with list loading.');
requirePattern(core, /countChain[\s\S]*fetchUnreadCount[\s\S]*lastAppliedCountRequest/i, 'Unread count refreshes must be ordered and stale-safe.');
requirePattern(core, /uniqueSortedRows\(state\.rows, page\.rows\)/i, 'Top and cursor pages must merge without losing loaded rows.');

requirePattern(app, /window\.sovremennikSupabase\s*=\s*supa/, 'Notification module must reuse the app Supabase client.');
requirePattern(html, /assets\/js\/notification-history-core\.js[\s\S]*assets\/js\/notifications\.js/, 'The notification controller must load before notifications.js.');
requirePattern(css, /\.notification-bell/, 'Notification bell styles are missing.');
requirePattern(css, /\.notification-panel/, 'Notification panel styles are missing.');

if(failures.length){
  console.error('Notification history checks failed:');
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log('Notification history checks passed.');
