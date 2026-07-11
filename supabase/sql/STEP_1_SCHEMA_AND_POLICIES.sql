-- STEP 1. Sovremennik Service Supabase schema and policies.
-- Paste this entire file into Supabase SQL Editor and click Run.

-- Sovremennik Service: Supabase database schema
-- Run this file in Supabase SQL Editor first.

create extension if not exists pgcrypto;

-- Roles are stored as text so you can change labels in the frontend without recreating enum types.
-- Allowed roles: admin, manager, barista, waiter.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login text not null unique,
  name text not null,
  role text not null check (role in ('admin', 'manager', 'barista', 'waiter')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  creator_id uuid references public.profiles(id) on delete set null,
  assignee_id uuid references public.profiles(id) on delete set null,
  is_vip boolean not null default false,
  due_date date,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checklist_submissions (
  id uuid primary key default gen_random_uuid(),
  checklist_id text,
  checklist_title text not null,
  employee_id uuid references public.profiles(id) on delete set null,
  employee_name text not null,
  items jsonb not null default '[]'::jsonb,
  completed_count integer not null default 0,
  total_count integer not null default 0,
  percent integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.coffee_revisions (
  revision_date date primary key,
  employee_id uuid references public.profiles(id) on delete set null,
  employee_name text,
  hopper_weight numeric(10,3),
  opened_packs integer,
  write_offs numeric(10,3),
  iiko_sales numeric(10,3),
  checked text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.error_reports (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.profiles(id) on delete set null,
  employee_name text,
  message text not null,
  status text not null default 'new' check (status in ('new','in_progress','done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  event_type text not null default 'shift',
  title text not null,
  description text default '',
  employee_name text default '',
  source text default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_login_idx on public.profiles(login);
create index if not exists tasks_assignee_status_idx on public.tasks(assignee_id, status, is_vip, due_date);
create index if not exists tasks_due_at_idx on public.tasks(is_vip, due_at, created_at);
create index if not exists checklist_submissions_created_idx on public.checklist_submissions(created_at desc);
create index if not exists error_reports_created_idx on public.error_reports(created_at desc);
create index if not exists schedule_events_date_idx on public.schedule_events(event_date);

create table if not exists public.role_permissions (
  role text primary key check (role in ('admin', 'manager', 'barista', 'waiter')),
  sections text[] not null default '{}',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);


create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_profiles_updated_at on public.profiles;
create trigger touch_profiles_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists touch_tasks_updated_at on public.tasks;
create trigger touch_tasks_updated_at before update on public.tasks
for each row execute function public.touch_updated_at();

drop trigger if exists touch_coffee_revisions_updated_at on public.coffee_revisions;
create trigger touch_coffee_revisions_updated_at before update on public.coffee_revisions
for each row execute function public.touch_updated_at();

drop trigger if exists touch_error_reports_updated_at on public.error_reports;
create trigger touch_error_reports_updated_at before update on public.error_reports
for each row execute function public.touch_updated_at();

drop trigger if exists touch_schedule_events_updated_at on public.schedule_events;
create trigger touch_schedule_events_updated_at before update on public.schedule_events
for each row execute function public.touch_updated_at();

-- Helper: current authenticated user's role.
create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active = true;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role() = 'admin', false);
$$;

-- Coffee revision calculated view.
-- total_coffee_usage = previous_day_clean_hopper_weight + opened_packs - current_day_clean_hopper_weight
-- difference = iiko_sales - write_offs - total_coffee_usage
-- losses_percent = difference / iiko_sales * 100
-- First revision has no previous day, so calculated values remain null.
create or replace view public.coffee_revision_report as
with base as (
  select
    cr.*,
    greatest(coalesce(cr.hopper_weight, 0) - 0.847, 0)::numeric(10,3) as clean_hopper_weight,
    lag(greatest(coalesce(cr.hopper_weight, 0) - 0.847, 0)::numeric(10,3)) over (order by cr.revision_date) as previous_clean_hopper_weight
  from public.coffee_revisions cr
), calc as (
  select
    base.*,
    case
      when previous_clean_hopper_weight is null or opened_packs is null or clean_hopper_weight is null then null
      else round((previous_clean_hopper_weight + opened_packs::numeric - clean_hopper_weight)::numeric, 3)
    end as total_coffee_usage_calc
  from base
)
select
  revision_date,
  employee_id,
  employee_name,
  hopper_weight,
  opened_packs,
  write_offs,
  iiko_sales,
  checked,
  clean_hopper_weight,
  total_coffee_usage_calc as total_coffee_usage,
  case
    when total_coffee_usage_calc is null or write_offs is null or iiko_sales is null then null
    else round((coalesce(iiko_sales,0) - coalesce(write_offs,0) - total_coffee_usage_calc)::numeric, 3)
  end as difference,
  case
    when total_coffee_usage_calc is null or write_offs is null or iiko_sales is null or iiko_sales = 0 then null
    else round(((coalesce(iiko_sales,0) - coalesce(write_offs,0) - total_coffee_usage_calc) / iiko_sales * 100)::numeric, 2)
  end as losses_percent,
  created_at,
  updated_at
from calc
order by revision_date;


-- Sovremennik Service: Row Level Security policies
-- Run after 01_schema.sql.

alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.checklist_submissions enable row level security;
alter table public.coffee_revisions enable row level security;
alter table public.error_reports enable row level security;
alter table public.schedule_events enable row level security;
alter table public.role_permissions enable row level security;

-- Profiles / employee directory.
-- Any authenticated employee can read active profiles so tasks can be assigned by employee name.
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
on public.profiles
for select
to authenticated
using (is_active = true or public.is_admin());

-- Profiles are created/deleted by Edge Function with service_role key.
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
on public.profiles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Tasks: users see tasks assigned to them or created by them; admins see all.
drop policy if exists "tasks_select_visible" on public.tasks;
create policy "tasks_select_visible"
on public.tasks
for select
to authenticated
using (public.is_admin() or assignee_id = auth.uid());

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
using (public.is_admin() or assignee_id = auth.uid())
with check (public.is_admin() or assignee_id = auth.uid());

drop policy if exists "tasks_delete_admin" on public.tasks;
create policy "tasks_delete_admin"
on public.tasks
for delete
to authenticated
using (public.is_admin());

-- Checklist submissions: everyone can submit; only admins can read all control results.
drop policy if exists "checklist_insert_own" on public.checklist_submissions;
create policy "checklist_insert_own"
on public.checklist_submissions
for insert
to authenticated
with check (employee_id = auth.uid());

drop policy if exists "checklist_select_admin" on public.checklist_submissions;
create policy "checklist_select_admin"
on public.checklist_submissions
for select
to authenticated
using (public.is_admin());

-- Coffee revisions: employees can create/update their own operational fields by date; admins can read/update all.
-- Simpler first version: authenticated users can upsert revisions; only admins can read aggregated control table.
drop policy if exists "coffee_revision_upsert_authenticated" on public.coffee_revisions;
create policy "coffee_revision_upsert_authenticated"
on public.coffee_revisions
for insert
to authenticated
with check (true);

drop policy if exists "coffee_revision_update_authenticated" on public.coffee_revisions;
create policy "coffee_revision_update_authenticated"
on public.coffee_revisions
for update
to authenticated
using (true)
with check (true);

drop policy if exists "coffee_revision_select_admin" on public.coffee_revisions;
create policy "coffee_revision_select_admin"
on public.coffee_revisions
for select
to authenticated
using (public.is_admin());

-- Error reports: everyone can submit; admins can read/update statuses.
drop policy if exists "error_reports_insert_authenticated" on public.error_reports;
create policy "error_reports_insert_authenticated"
on public.error_reports
for insert
to authenticated
with check (employee_id = auth.uid());

drop policy if exists "error_reports_select_admin" on public.error_reports;
create policy "error_reports_select_admin"
on public.error_reports
for select
to authenticated
using (public.is_admin());

drop policy if exists "error_reports_update_admin" on public.error_reports;
create policy "error_reports_update_admin"
on public.error_reports
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());


-- Role permissions: all authenticated employees can read current access map; only admins can edit.
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

-- Schedule: all authenticated employees can read; admins can create/edit/delete events.
drop policy if exists "schedule_select_authenticated" on public.schedule_events;
create policy "schedule_select_authenticated"
on public.schedule_events
for select
to authenticated
using (true);

drop policy if exists "schedule_insert_admin" on public.schedule_events;
create policy "schedule_insert_admin"
on public.schedule_events
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "schedule_update_admin" on public.schedule_events;
create policy "schedule_update_admin"
on public.schedule_events
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "schedule_delete_admin" on public.schedule_events;
create policy "schedule_delete_admin"
on public.schedule_events
for delete
to authenticated
using (public.is_admin());
