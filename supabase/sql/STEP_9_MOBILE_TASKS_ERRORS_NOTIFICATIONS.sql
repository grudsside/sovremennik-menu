-- STEP 9: Mobile task/error submit fixes + targeted notification support
-- Run this in Supabase SQL Editor after previous patches.

-- 1) Make admin/manager check stable for RLS.
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
      and p.role in ('admin', 'manager')
  );
$$;

grant execute on function public.is_admin() to authenticated;

-- 2) Tasks: creators and assignees must be able to read the rows they participate in.
-- This also fixes mobile inserts that previously failed when INSERT ... RETURNING was used.
drop policy if exists "tasks_select_visible" on public.tasks;
create policy "tasks_select_visible"
on public.tasks
for select
to authenticated
using (
  public.is_admin()
  or assignee_id = auth.uid()
  or creator_id = auth.uid()
);

drop policy if exists "tasks_insert_authenticated" on public.tasks;
create policy "tasks_insert_authenticated"
on public.tasks
for insert
to authenticated
with check (creator_id = auth.uid());

drop policy if exists "tasks_update_visible" on public.tasks;
create policy "tasks_update_visible"
on public.tasks
for update
to authenticated
using (
  public.is_admin()
  or assignee_id = auth.uid()
  or creator_id = auth.uid()
)
with check (
  public.is_admin()
  or assignee_id = auth.uid()
  or creator_id = auth.uid()
);

drop policy if exists "tasks_delete_admin" on public.tasks;
create policy "tasks_delete_admin"
on public.tasks
for delete
to authenticated
using (public.is_admin());

-- 3) Error reports: employees can submit and read their own row; admin/manager can read all.
-- This fixes mobile error submissions when Supabase tries to return/check the inserted row.
drop policy if exists "error_reports_insert_authenticated" on public.error_reports;
create policy "error_reports_insert_authenticated"
on public.error_reports
for insert
to authenticated
with check (employee_id = auth.uid());

drop policy if exists "error_reports_select_admin" on public.error_reports;
drop policy if exists "error_reports_select_visible" on public.error_reports;
create policy "error_reports_select_visible"
on public.error_reports
for select
to authenticated
using (
  public.is_admin()
  or employee_id = auth.uid()
);

drop policy if exists "error_reports_update_admin" on public.error_reports;
create policy "error_reports_update_admin"
on public.error_reports
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- 4) Checklist submissions: employees can read their own submissions; admin/manager can read all.
-- This avoids similar mobile submit errors in Safari/PWA.
drop policy if exists "checklist_select_admin" on public.checklist_submissions;
drop policy if exists "checklist_select_visible" on public.checklist_submissions;
create policy "checklist_select_visible"
on public.checklist_submissions
for select
to authenticated
using (
  public.is_admin()
  or employee_id = auth.uid()
);

drop policy if exists "checklist_insert_own" on public.checklist_submissions;
create policy "checklist_insert_own"
on public.checklist_submissions
for insert
to authenticated
with check (employee_id = auth.uid());

-- 5) Coffee revisions: employees can read their own rows; admin/manager can read all.
drop policy if exists "coffee_revision_select_admin" on public.coffee_revisions;
drop policy if exists "coffee_revision_select_visible" on public.coffee_revisions;
create policy "coffee_revision_select_visible"
on public.coffee_revisions
for select
to authenticated
using (
  public.is_admin()
  or employee_id = auth.uid()
);

-- 6) Quick verification output.
select
  'step_9_mobile_tasks_errors_notifications_done' as status,
  p.login,
  p.role,
  p.is_active
from public.profiles p
where p.login = 'grigory';
