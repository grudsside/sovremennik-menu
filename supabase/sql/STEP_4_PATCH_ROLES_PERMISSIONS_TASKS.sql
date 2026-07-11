-- STEP 4. Patch for roles, editable permissions and task deadlines.
-- Run this file in Supabase SQL Editor after the original schema is already installed.

-- 1) Add the new role: manager / руководитель.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'manager', 'barista', 'waiter'));

-- 2) Store section visibility per role.
create table if not exists public.role_permissions (
  role text primary key check (role in ('admin', 'manager', 'barista', 'waiter')),
  sections text[] not null default '{}',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.role_permissions enable row level security;

drop policy if exists "role_permissions_select_authenticated" on public.role_permissions;
create policy "role_permissions_select_authenticated"
on public.role_permissions
for select
to authenticated
using (true);

drop policy if exists "role_permissions_insert_admin" on public.role_permissions;
create policy "role_permissions_insert_admin"
on public.role_permissions
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "role_permissions_update_admin" on public.role_permissions;
create policy "role_permissions_update_admin"
on public.role_permissions
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "role_permissions_delete_admin" on public.role_permissions;
create policy "role_permissions_delete_admin"
on public.role_permissions
for delete
to authenticated
using (public.is_admin());

insert into public.role_permissions(role, sections)
values
  ('admin', array['home','method','theory','checklists','revisions','techcards','schedule','reportError','employees','control']),
  ('manager', array['home','method','theory','checklists','revisions','techcards','schedule','reportError','control']),
  ('barista', array['home','method','theory','checklists','revisions','techcards','schedule','reportError']),
  ('waiter', array['home','method','theory','schedule','reportError'])
on conflict (role) do nothing;

-- 3) Add exact deadline time for tasks.
alter table public.tasks add column if not exists due_at timestamptz;
create index if not exists tasks_due_at_idx on public.tasks(is_vip, due_at, created_at);

-- 4) Fix task visibility: a normal employee sees only tasks assigned to them.
-- Admin sees every task. Creator does not see a task unless they are the assignee or admin.
drop policy if exists "tasks_select_visible" on public.tasks;
create policy "tasks_select_visible"
on public.tasks
for select
to authenticated
using (public.is_admin() or assignee_id = auth.uid());

drop policy if exists "tasks_update_visible" on public.tasks;
create policy "tasks_update_visible"
on public.tasks
for update
to authenticated
using (public.is_admin() or assignee_id = auth.uid())
with check (public.is_admin() or assignee_id = auth.uid());
