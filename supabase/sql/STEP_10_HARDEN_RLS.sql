-- STEP 10: Harden production RLS and separate admin/manager privileges.
-- Apply after STEP_9_MOBILE_TASKS_ERRORS_NOTIFICATIONS.sql.
--
-- This migration is intentionally fail-closed and runs in one transaction.
-- Take a database backup before applying it in production.

begin;

-- ---------------------------------------------------------------------------
-- 1. Trusted role helpers
-- ---------------------------------------------------------------------------

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active = true;
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
  );
$$;

-- Admin means admin only. STEP 9 previously included manager here.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and p.role = 'admin'
  );
$$;

create or replace function public.is_admin_or_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and p.role in ('admin', 'manager')
  );
$$;

revoke execute on function public.current_role() from public, anon;
revoke execute on function public.is_active_user() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_admin_or_manager() from public, anon;

grant execute on function public.current_role() to authenticated, service_role;
grant execute on function public.is_active_user() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.is_admin_or_manager() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Server-owned identity fields
-- ---------------------------------------------------------------------------

create or replace function public.set_employee_submission_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
begin
  -- service_role operations do not carry an end-user uid and keep supplied data.
  if actor_id is null then
    return new;
  end if;

  select p.name
    into actor_name
  from public.profiles p
  where p.id = actor_id
    and p.is_active = true;

  if actor_name is null then
    raise exception 'Active profile required' using errcode = '42501';
  end if;

  new.employee_id := actor_id;
  new.employee_name := actor_name;
  return new;
end;
$$;

revoke execute on function public.set_employee_submission_identity() from public, anon, authenticated;

drop trigger if exists checklist_submission_identity on public.checklist_submissions;
create trigger checklist_submission_identity
before insert on public.checklist_submissions
for each row execute function public.set_employee_submission_identity();

drop trigger if exists error_report_identity on public.error_reports;
create trigger error_report_identity
before insert on public.error_reports
for each row execute function public.set_employee_submission_identity();

create or replace function public.set_schedule_creator_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  actor_role text;
begin
  if actor_id is null then
    return new;
  end if;

  select p.name, p.role
    into actor_name, actor_role
  from public.profiles p
  where p.id = actor_id
    and p.is_active = true;

  if actor_role not in ('admin', 'manager') then
    raise exception 'Admin or manager profile required' using errcode = '42501';
  end if;

  new.created_by := actor_id;
  new.employee_name := actor_name;
  return new;
end;
$$;

revoke execute on function public.set_schedule_creator_identity() from public, anon, authenticated;

drop trigger if exists schedule_creator_identity on public.schedule_events;
create trigger schedule_creator_identity
before insert on public.schedule_events
for each row execute function public.set_schedule_creator_identity();

-- One revision row is shared per date. Baristas may edit only operational
-- values on rows they own. Admin/manager may add control values, but an upsert
-- must not replace the employee who submitted the operational revision.
create or replace function public.enforce_coffee_revision_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  actor_role text;
begin
  if actor_id is null then
    return new;
  end if;

  select p.name, p.role
    into actor_name, actor_role
  from public.profiles p
  where p.id = actor_id
    and p.is_active = true;

  if actor_role is null then
    raise exception 'Active profile required' using errcode = '42501';
  end if;

  if actor_role not in ('admin', 'manager', 'barista') then
    raise exception 'Revision access denied' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.employee_id := actor_id;
    new.employee_name := actor_name;

    if actor_role = 'barista'
      and (
        new.write_offs is not null
        or new.iiko_sales is not null
        or nullif(btrim(coalesce(new.checked, '')), '') is not null
      )
    then
      raise exception 'Barista may submit operational revision fields only'
        using errcode = '42501';
    end if;

    if actor_role in ('admin', 'manager')
      and new.hopper_weight is null
      and new.opened_packs is null
      and (
        new.write_offs is not null
        or new.iiko_sales is not null
        or nullif(btrim(coalesce(new.checked, '')), '') is not null
      )
    then
      raise exception 'Submit operational revision before control values'
        using errcode = '23514';
    end if;

    return new;
  end if;

  -- Identity and date are immutable. This also keeps manager manual upserts
  -- from overwriting the original employee_id/employee_name.
  new.revision_date := old.revision_date;
  new.employee_id := old.employee_id;
  new.employee_name := old.employee_name;

  if actor_role = 'barista' then
    if old.employee_id is distinct from actor_id then
      raise exception 'Only the revision owner may update operational values'
        using errcode = '42501';
    end if;

    if new.write_offs is distinct from old.write_offs
      or new.iiko_sales is distinct from old.iiko_sales
      or new.checked is distinct from old.checked
    then
      raise exception 'Barista may update operational revision fields only'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_coffee_revision_write() from public, anon, authenticated;

drop trigger if exists enforce_coffee_revision_write on public.coffee_revisions;
create trigger enforce_coffee_revision_write
before insert or update on public.coffee_revisions
for each row execute function public.enforce_coffee_revision_write();

-- ---------------------------------------------------------------------------
-- 3. Explicit API privileges
-- ---------------------------------------------------------------------------

-- Internal application data is never available to anon.
revoke all on table public.profiles from public, anon;
revoke all on table public.tasks from public, anon;
revoke all on table public.checklist_submissions from public, anon;
revoke all on table public.coffee_revisions from public, anon;
revoke all on table public.coffee_revision_report from public, anon;
revoke all on table public.error_reports from public, anon;
revoke all on table public.schedule_events from public, anon;
revoke all on table public.role_permissions from public, anon;
revoke all on table public.menu_item_overrides from public, anon;
revoke all on table public.tech_card_overrides from public, anon;
revoke all on table public.push_subscriptions from public, anon;
revoke all on table public.notification_preferences from public, anon;
revoke all on table public.notification_events from public, anon;

-- Replace broad authenticated grants with the operations used by the app.
revoke all on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;

revoke all on table public.tasks from authenticated;
grant select, insert, delete on table public.tasks to authenticated;
grant update (status, completed_at) on table public.tasks to authenticated;

revoke all on table public.checklist_submissions from authenticated;
grant select, insert on table public.checklist_submissions to authenticated;

revoke all on table public.coffee_revisions from authenticated;
grant select, insert, update on table public.coffee_revisions to authenticated;

grant select on table public.coffee_revision_report to authenticated;

revoke all on table public.error_reports from authenticated;
grant select, insert on table public.error_reports to authenticated;
grant update (status) on table public.error_reports to authenticated;

revoke all on table public.schedule_events from authenticated;
grant select, insert, delete on table public.schedule_events to authenticated;
grant update (
  event_date,
  event_type,
  title,
  description,
  employee_name,
  source
) on table public.schedule_events to authenticated;

revoke all on table public.role_permissions from authenticated;
grant select, insert, update, delete on table public.role_permissions to authenticated;

revoke all on table public.menu_item_overrides from authenticated;
grant select, insert, update, delete on table public.menu_item_overrides to authenticated;

revoke all on table public.tech_card_overrides from authenticated;
grant select, insert, update, delete on table public.tech_card_overrides to authenticated;

revoke all on table public.push_subscriptions from authenticated;
grant select, insert, update on table public.push_subscriptions to authenticated;

revoke all on table public.notification_preferences from authenticated;
grant select, insert, update on table public.notification_preferences to authenticated;

revoke all on table public.notification_events from authenticated;
grant select on table public.notification_events to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS policies
-- ---------------------------------------------------------------------------

-- Profiles: active employees see the active directory; only active admins may
-- also see inactive profiles. Writes remain service-role-only.
drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_select_active"
on public.profiles
for select
to authenticated
using (
  public.is_active_user()
  and (is_active = true or public.is_admin())
);

-- Tasks: manager has no global access. Admin sees all; other active employees,
-- including manager, see only tasks they created or were assigned.
drop policy if exists "tasks_select_visible" on public.tasks;
drop policy if exists "tasks_insert_authenticated" on public.tasks;
drop policy if exists "tasks_update_visible" on public.tasks;
drop policy if exists "tasks_delete_admin" on public.tasks;

create policy "tasks_select_participant"
on public.tasks
for select
to authenticated
using (
  public.is_active_user()
  and (
    public.is_admin()
    or creator_id = auth.uid()
    or assignee_id = auth.uid()
  )
);

create policy "tasks_insert_active_creator"
on public.tasks
for insert
to authenticated
with check (
  public.is_active_user()
  and creator_id = auth.uid()
  and status = 'open'
  and completed_at is null
  and exists (
    select 1
    from public.profiles assignee
    where assignee.id = assignee_id
      and assignee.is_active = true
  )
);

create policy "tasks_update_status_participant"
on public.tasks
for update
to authenticated
using (
  public.is_active_user()
  and (
    public.is_admin()
    or creator_id = auth.uid()
    or assignee_id = auth.uid()
  )
)
with check (
  public.is_active_user()
  and (
    public.is_admin()
    or (
      (creator_id = auth.uid() or assignee_id = auth.uid())
      and status in ('open', 'done')
      and (
        (status = 'open' and completed_at is null)
        or (status = 'done' and completed_at is not null)
      )
    )
  )
);

create policy "tasks_delete_admin_only"
on public.tasks
for delete
to authenticated
using (public.is_admin());

-- Checklist submissions.
drop policy if exists "checklist_insert_own" on public.checklist_submissions;
drop policy if exists "checklist_select_visible" on public.checklist_submissions;

create policy "checklist_insert_active_own"
on public.checklist_submissions
for insert
to authenticated
with check (
  public.is_active_user()
  and employee_id = auth.uid()
);

create policy "checklist_select_control_or_own"
on public.checklist_submissions
for select
to authenticated
using (
  public.is_active_user()
  and (
    public.is_admin_or_manager()
    or employee_id = auth.uid()
  )
);

-- Coffee revisions.
drop policy if exists "coffee_revision_upsert_authenticated" on public.coffee_revisions;
drop policy if exists "coffee_revision_update_authenticated" on public.coffee_revisions;
drop policy if exists "coffee_revision_select_visible" on public.coffee_revisions;

create policy "coffee_revision_insert_allowed_role"
on public.coffee_revisions
for insert
to authenticated
with check (
  public.is_active_user()
  and public.current_role() in ('admin', 'manager', 'barista')
  and employee_id = auth.uid()
);

create policy "coffee_revision_update_control_or_owner"
on public.coffee_revisions
for update
to authenticated
using (
  public.is_active_user()
  and (
    public.is_admin_or_manager()
    or (
      public.current_role() = 'barista'
      and employee_id = auth.uid()
    )
  )
)
with check (
  public.is_active_user()
  and (
    public.is_admin_or_manager()
    or (
      public.current_role() = 'barista'
      and employee_id = auth.uid()
    )
  )
);

create policy "coffee_revision_select_control_or_own"
on public.coffee_revisions
for select
to authenticated
using (
  public.is_active_user()
  and (
    public.is_admin_or_manager()
    or employee_id = auth.uid()
  )
);

-- The view must apply the caller's policies on coffee_revisions.
alter view public.coffee_revision_report set (security_invoker = true);

-- Error reports.
drop policy if exists "error_reports_insert_authenticated" on public.error_reports;
drop policy if exists "error_reports_select_visible" on public.error_reports;
drop policy if exists "error_reports_update_admin" on public.error_reports;

create policy "error_reports_insert_active_own"
on public.error_reports
for insert
to authenticated
with check (
  public.is_active_user()
  and employee_id = auth.uid()
  and status = 'new'
);

create policy "error_reports_select_control_or_own"
on public.error_reports
for select
to authenticated
using (
  public.is_active_user()
  and (
    public.is_admin_or_manager()
    or employee_id = auth.uid()
  )
);

create policy "error_reports_update_control"
on public.error_reports
for update
to authenticated
using (public.is_admin_or_manager())
with check (public.is_admin_or_manager());

-- Schedule: all active employees read; admin/manager manage.
drop policy if exists "schedule_select_authenticated" on public.schedule_events;
drop policy if exists "schedule_insert_admin" on public.schedule_events;
drop policy if exists "schedule_update_admin" on public.schedule_events;
drop policy if exists "schedule_delete_admin" on public.schedule_events;

create policy "schedule_select_active"
on public.schedule_events
for select
to authenticated
using (public.is_active_user());

create policy "schedule_insert_control"
on public.schedule_events
for insert
to authenticated
with check (
  public.is_admin_or_manager()
  and created_by = auth.uid()
);

create policy "schedule_update_control"
on public.schedule_events
for update
to authenticated
using (public.is_admin_or_manager())
with check (public.is_admin_or_manager());

create policy "schedule_delete_control"
on public.schedule_events
for delete
to authenticated
using (public.is_admin_or_manager());

-- Role permissions: readable by active employees, writable by admin only.
drop policy if exists "role_permissions_select_authenticated" on public.role_permissions;
drop policy if exists "role_permissions_insert_admin" on public.role_permissions;
drop policy if exists "role_permissions_update_admin" on public.role_permissions;
drop policy if exists "role_permissions_delete_admin" on public.role_permissions;

create policy "role_permissions_select_active"
on public.role_permissions
for select
to authenticated
using (public.is_active_user());

create policy "role_permissions_insert_admin_only"
on public.role_permissions
for insert
to authenticated
with check (public.is_admin());

create policy "role_permissions_update_admin_only"
on public.role_permissions
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "role_permissions_delete_admin_only"
on public.role_permissions
for delete
to authenticated
using (public.is_admin());

-- Shared menu and tech-card content: active employees read, admin only writes.
drop policy if exists "menu_item_overrides_select_authenticated" on public.menu_item_overrides;
drop policy if exists "menu_item_overrides_insert_admin" on public.menu_item_overrides;
drop policy if exists "menu_item_overrides_update_admin" on public.menu_item_overrides;
drop policy if exists "menu_item_overrides_delete_admin" on public.menu_item_overrides;

create policy "menu_item_overrides_select_active"
on public.menu_item_overrides
for select
to authenticated
using (public.is_active_user());

create policy "menu_item_overrides_insert_admin_only"
on public.menu_item_overrides
for insert
to authenticated
with check (public.is_admin());

create policy "menu_item_overrides_update_admin_only"
on public.menu_item_overrides
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "menu_item_overrides_delete_admin_only"
on public.menu_item_overrides
for delete
to authenticated
using (public.is_admin());

drop policy if exists "tech_card_overrides_select_authenticated" on public.tech_card_overrides;
drop policy if exists "tech_card_overrides_insert_admin" on public.tech_card_overrides;
drop policy if exists "tech_card_overrides_update_admin" on public.tech_card_overrides;
drop policy if exists "tech_card_overrides_delete_admin" on public.tech_card_overrides;

create policy "tech_card_overrides_select_active"
on public.tech_card_overrides
for select
to authenticated
using (public.is_active_user());

create policy "tech_card_overrides_insert_admin_only"
on public.tech_card_overrides
for insert
to authenticated
with check (public.is_admin());

create policy "tech_card_overrides_update_admin_only"
on public.tech_card_overrides
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "tech_card_overrides_delete_admin_only"
on public.tech_card_overrides
for delete
to authenticated
using (public.is_admin());

-- Public image reads remain intentional. Only active admins may write.
drop policy if exists "menu_photos_insert_admin" on storage.objects;
drop policy if exists "menu_photos_update_admin" on storage.objects;
drop policy if exists "menu_photos_delete_admin" on storage.objects;

create policy "menu_photos_insert_admin_only"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'menu-photos'
  and public.is_admin()
);

create policy "menu_photos_update_admin_only"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'menu-photos'
  and public.is_admin()
)
with check (
  bucket_id = 'menu-photos'
  and public.is_admin()
);

create policy "menu_photos_delete_admin_only"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'menu-photos'
  and public.is_admin()
);

-- Push records are private to their owner. Edge Functions use service_role and
-- do not require client policies that expose endpoints or key material.
drop policy if exists "push admin select" on public.push_subscriptions;
drop policy if exists "push own insert" on public.push_subscriptions;
drop policy if exists "push own select" on public.push_subscriptions;
drop policy if exists "push own update" on public.push_subscriptions;

create policy "push_subscriptions_insert_active_own"
on public.push_subscriptions
for insert
to authenticated
with check (
  public.is_active_user()
  and user_id = auth.uid()
);

create policy "push_subscriptions_select_active_own"
on public.push_subscriptions
for select
to authenticated
using (
  public.is_active_user()
  and user_id = auth.uid()
);

create policy "push_subscriptions_update_active_own"
on public.push_subscriptions
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

drop policy if exists "prefs admin select" on public.notification_preferences;
drop policy if exists "prefs own insert" on public.notification_preferences;
drop policy if exists "prefs own select" on public.notification_preferences;
drop policy if exists "prefs own update" on public.notification_preferences;

create policy "notification_preferences_insert_active_own"
on public.notification_preferences
for insert
to authenticated
with check (
  public.is_active_user()
  and user_id = auth.uid()
);

create policy "notification_preferences_select_active_own"
on public.notification_preferences
for select
to authenticated
using (
  public.is_active_user()
  and user_id = auth.uid()
);

create policy "notification_preferences_update_active_own"
on public.notification_preferences
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

drop policy if exists "events admin select" on public.notification_events;
drop policy if exists "events own select" on public.notification_events;

create policy "notification_events_select_active_own"
on public.notification_events
for select
to authenticated
using (
  public.is_active_user()
  and user_id = auth.uid()
);

commit;

-- ---------------------------------------------------------------------------
-- Verification output (read-only)
-- ---------------------------------------------------------------------------

select
  'step_10_harden_rls_done' as status,
  public.is_admin() as caller_is_admin,
  public.is_admin_or_manager() as caller_is_admin_or_manager,
  public.is_active_user() as caller_is_active,
  (
    select c.reloptions
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'coffee_revision_report'
      and c.relkind = 'v'
  ) as coffee_revision_report_options;

select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where (schemaname, tablename) in (
  ('public', 'profiles'),
  ('public', 'tasks'),
  ('public', 'checklist_submissions'),
  ('public', 'coffee_revisions'),
  ('public', 'error_reports'),
  ('public', 'schedule_events'),
  ('public', 'role_permissions'),
  ('public', 'menu_item_overrides'),
  ('public', 'tech_card_overrides'),
  ('public', 'push_subscriptions'),
  ('public', 'notification_preferences'),
  ('public', 'notification_events'),
  ('storage', 'objects')
)
order by schemaname, tablename, policyname;
