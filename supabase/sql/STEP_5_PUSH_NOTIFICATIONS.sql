-- STEP_5_PUSH_NOTIFICATIONS.sql
-- Выполнить в Supabase SQL Editor после предыдущих шагов v18.
-- Добавляет таблицы для Web Push, настройки уведомлений и историю отправок.

create extension if not exists pgcrypto;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh_key text not null,
  auth_key text not null,
  subscription_json jsonb not null,
  device_name text,
  user_agent text,
  is_active boolean not null default true,
  last_seen_at timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  task_assigned boolean not null default true,
  vip_tasks boolean not null default true,
  task_deadline_24h boolean not null default true,
  task_deadline_1h boolean not null default true,
  task_overdue boolean not null default true,
  task_completed boolean not null default true,
  checklist_submitted boolean not null default true,
  revision_submitted boolean not null default true,
  error_report_submitted boolean not null default true,
  schedule_event_added boolean not null default true,
  quiet_hours_start time,
  quiet_hours_end time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null,
  event_key text not null,
  source_table text,
  source_id uuid,
  title text not null,
  body text not null,
  url text,
  status text not null default 'created',
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, event_key)
);

create index if not exists idx_push_subscriptions_user_active on public.push_subscriptions(user_id, is_active);
create index if not exists idx_notification_events_user_created on public.notification_events(user_id, created_at desc);
create index if not exists idx_notification_events_event_key on public.notification_events(event_key);

alter table public.push_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_events enable row level security;

drop policy if exists "push own select" on public.push_subscriptions;
drop policy if exists "push own insert" on public.push_subscriptions;
drop policy if exists "push own update" on public.push_subscriptions;
drop policy if exists "push admin select" on public.push_subscriptions;
create policy "push own select" on public.push_subscriptions for select using (auth.uid() = user_id);
create policy "push own insert" on public.push_subscriptions for insert with check (auth.uid() = user_id);
create policy "push own update" on public.push_subscriptions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "push admin select" on public.push_subscriptions for select using (exists(select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','manager')));

drop policy if exists "prefs own select" on public.notification_preferences;
drop policy if exists "prefs own insert" on public.notification_preferences;
drop policy if exists "prefs own update" on public.notification_preferences;
drop policy if exists "prefs admin select" on public.notification_preferences;
create policy "prefs own select" on public.notification_preferences for select using (auth.uid() = user_id);
create policy "prefs own insert" on public.notification_preferences for insert with check (auth.uid() = user_id);
create policy "prefs own update" on public.notification_preferences for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "prefs admin select" on public.notification_preferences for select using (exists(select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','manager')));

drop policy if exists "events own select" on public.notification_events;
drop policy if exists "events admin select" on public.notification_events;
create policy "events own select" on public.notification_events for select using (auth.uid() = user_id);
create policy "events admin select" on public.notification_events for select using (exists(select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','manager')));

insert into public.notification_preferences (user_id)
select id from public.profiles where is_active = true
on conflict (user_id) do nothing;
