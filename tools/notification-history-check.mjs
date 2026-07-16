import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const sql = read('supabase/sql/STEP_12_NOTIFICATION_HISTORY.sql');
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
  [/\.update\(\{ read_at: readAt \}\)/, 'Individual read status update is missing.'],
  [/\.select\(SELECT_COLUMNS,[\s\S]*?\.eq\('user_id', requestUserId\)/, 'Notification pages must be explicitly scoped to the current employee.'],
  [/\.update\(\{ read_at: readAt \}\)[\s\S]*?\.eq\('user_id', state\.userId\)/, 'Read updates must be explicitly scoped to the current employee.'],
  [/event:\s*'INSERT'[\s\S]*table:\s*TABLE[\s\S]*user_id=eq\./, 'Owner-filtered Realtime subscription is missing.']
]) requirePattern(client, pattern, message);

requirePattern(app, /window\.sovremennikSupabase\s*=\s*supa/, 'Notification module must reuse the app Supabase client.');
requirePattern(html, /assets\/js\/notifications\.js/, 'notifications.js must be loaded by index.html.');
requirePattern(css, /\.notification-bell/, 'Notification bell styles are missing.');
requirePattern(css, /\.notification-panel/, 'Notification panel styles are missing.');

if(failures.length){
  console.error('Notification history checks failed:');
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log('Notification history checks passed.');
