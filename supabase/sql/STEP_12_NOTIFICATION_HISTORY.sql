-- STEP 12: Employee notification history, read status and Realtime updates.
-- Apply after STEP_10_HARDEN_RLS.sql and STEP_10B_HARDEN_RLS_VIEW_PRIVILEGES.sql.
--
-- The existing notification_events table remains the single notification
-- history. This patch does not delete notification data and is idempotent.
-- Take a database backup before applying it in production.

begin;

-- Existing events predate the inbox and must not create a large unread badge.
-- Backfill only when the column is first introduced, so rerunning this patch
-- never marks newer unread notifications as read.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notification_events'
      and column_name = 'read_at'
  ) then
    alter table public.notification_events
      add column read_at timestamptz;

    update public.notification_events
    set read_at = coalesce(sent_at, created_at)
    where read_at is null;
  end if;
end
$$;

comment on column public.notification_events.read_at is
  'When the recipient opened this notification in the employee inbox.';

create index if not exists idx_notification_events_user_unread_created
on public.notification_events (user_id, created_at desc)
where read_at is null;

-- STEP 10 grants authenticated users SELECT only. Keep all delivery fields
-- server-owned and allow the browser to update only read_at.
revoke update on table public.notification_events from authenticated, anon;
grant update (read_at) on public.notification_events to authenticated;

drop policy if exists "notification_events_update_read_active_own"
on public.notification_events;

create policy "notification_events_update_read_active_own"
on public.notification_events
for update
to authenticated
using (
  public.is_active_user()
  and user_id = auth.uid()
)
with check (
  public.is_active_user()
  and user_id = auth.uid()
);

-- Realtime is used only for new rows. RLS still decides which recipient may
-- receive a notification row through the authenticated client connection.
do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notification_events'
  ) then
    alter publication supabase_realtime
      add table public.notification_events;
  end if;
end
$$;

commit;

-- ---------------------------------------------------------------------------
-- Verification output (read-only)
-- ---------------------------------------------------------------------------

select
  'step_12_notification_history_done' as status,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notification_events'
      and column_name = 'read_at'
      and data_type = 'timestamp with time zone'
  ) as read_at_exists,
  has_column_privilege(
    'authenticated',
    'public.notification_events',
    'read_at',
    'UPDATE'
  ) as authenticated_can_update_read_at,
  has_column_privilege(
    'authenticated',
    'public.notification_events',
    'title',
    'UPDATE'
  ) as authenticated_can_update_title,
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notification_events'
  ) as realtime_enabled;

select
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'notification_events'
order by policyname;
