-- STEP 8. Editing menu positions and tech cards inside the service.
-- Run in Supabase SQL Editor before uploading v25.
-- Adds shared fields for menu card editing/deletion and tech card deletion.

create extension if not exists pgcrypto;

-- menu_item_overrides was originally photo-only. It now also stores edited/new/deleted menu positions.
create table if not exists public.menu_item_overrides (
  item_key text primary key,
  image_url text,
  storage_path text,
  payload jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.menu_item_overrides
  alter column image_url drop not null;

alter table public.menu_item_overrides
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists is_deleted boolean not null default false;

-- tech_card_overrides now supports deletion as a soft override.
create table if not exists public.tech_card_overrides (
  card_key text primary key,
  title text not null,
  category text default '',
  output text default '',
  technology text default '',
  ingredients jsonb not null default '[]'::jsonb,
  is_deleted boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.tech_card_overrides
  add column if not exists is_deleted boolean not null default false;

alter table public.menu_item_overrides enable row level security;
alter table public.tech_card_overrides enable row level security;

-- Read for all authenticated users.
drop policy if exists "menu_item_overrides_select_authenticated" on public.menu_item_overrides;
create policy "menu_item_overrides_select_authenticated"
on public.menu_item_overrides
for select
to authenticated
using (true);

drop policy if exists "tech_card_overrides_select_authenticated" on public.tech_card_overrides;
create policy "tech_card_overrides_select_authenticated"
on public.tech_card_overrides
for select
to authenticated
using (true);

-- Only admin can write.
drop policy if exists "menu_item_overrides_insert_admin" on public.menu_item_overrides;
create policy "menu_item_overrides_insert_admin"
on public.menu_item_overrides
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "menu_item_overrides_update_admin" on public.menu_item_overrides;
create policy "menu_item_overrides_update_admin"
on public.menu_item_overrides
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "menu_item_overrides_delete_admin" on public.menu_item_overrides;
create policy "menu_item_overrides_delete_admin"
on public.menu_item_overrides
for delete
to authenticated
using (public.is_admin());

drop policy if exists "tech_card_overrides_insert_admin" on public.tech_card_overrides;
create policy "tech_card_overrides_insert_admin"
on public.tech_card_overrides
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "tech_card_overrides_update_admin" on public.tech_card_overrides;
create policy "tech_card_overrides_update_admin"
on public.tech_card_overrides
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "tech_card_overrides_delete_admin" on public.tech_card_overrides;
create policy "tech_card_overrides_delete_admin"
on public.tech_card_overrides
for delete
to authenticated
using (public.is_admin());

-- Updated-at triggers, if touch_updated_at exists from the main schema.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'touch_updated_at') then
    drop trigger if exists touch_menu_item_overrides_updated_at on public.menu_item_overrides;
    create trigger touch_menu_item_overrides_updated_at before update on public.menu_item_overrides
    for each row execute function public.touch_updated_at();

    drop trigger if exists touch_tech_card_overrides_updated_at on public.tech_card_overrides;
    create trigger touch_tech_card_overrides_updated_at before update on public.tech_card_overrides
    for each row execute function public.touch_updated_at();
  end if;
end $$;

select 'STEP_8_CONTENT_EDITING_METHOD_TECH complete' as status;
