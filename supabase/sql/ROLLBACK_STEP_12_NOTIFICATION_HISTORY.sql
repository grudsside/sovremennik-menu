-- Safe, idempotent rollback for the STEP 12 notification-history interface.
--
-- This rollback intentionally keeps:
--   * public.notification_events rows;
--   * the read_at column and all read timestamps;
--   * the revision_submitted UUID source_id fix in notify-event.
--
-- Apply only after the STEP 12 frontend has been reverted. The original
-- notification delivery flow can continue using notification_events.

begin;

do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notification_events'
  ) then
    alter publication supabase_realtime
      drop table public.notification_events;
  end if;
end
$$;

drop policy if exists "notification_events_update_read_active_own"
on public.notification_events;

-- Keep all delivery fields server-owned and remove the STEP 12 browser grant.
revoke update on table public.notification_events from authenticated, anon;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notification_events'
      and column_name = 'read_at'
  ) then
    execute 'revoke update (read_at) on public.notification_events from authenticated, anon';
  end if;
end
$$;

drop index if exists public.idx_notification_events_user_unread_created;

commit;

-- Verification output (read-only). read_at_exists must remain true after a
-- normal rollback because notification history is retained.
select
  'rollback_step_12_notification_history_done' as status,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notification_events'
      and column_name = 'read_at'
  ) as read_at_exists,
  exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'notification_events'
      and column_name = 'read_at'
      and grantee = 'authenticated'
      and privilege_type = 'UPDATE'
  ) as authenticated_can_update_read_at,
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'notification_events'
      and policyname = 'notification_events_update_read_active_own'
  ) as update_policy_exists,
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notification_events'
  ) as realtime_enabled,
  to_regclass('public.idx_notification_events_user_unread_created') is not null
    as unread_index_exists;
