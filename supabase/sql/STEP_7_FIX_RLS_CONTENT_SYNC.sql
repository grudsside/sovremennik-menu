-- FIX RLS for content sync: menu photos + tech card overrides
-- Run this file in Supabase SQL Editor.
-- It does not delete your data. It only fixes admin detection and RLS policies.

-- 1) Make sure the first admin profile is active and has role='admin'.
-- This is important because RLS policies allow editing only for admin.
insert into public.profiles (id, login, name, role, is_active)
select id, 'grigory', 'Григорий', 'admin', true
from auth.users
where email = 'grigory@sovremennik.local'
on conflict (id) do update set
  login = 'grigory',
  name = 'Григорий',
  role = 'admin',
  is_active = true,
  updated_at = now();

update public.profiles
set role = 'admin', is_active = true, updated_at = now()
where login = 'grigory';

-- 2) Recreate admin check function in a more direct and reliable way.
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
      and coalesce(p.is_active, false) = true
      and lower(p.role) = 'admin'
  );
$$;

grant execute on function public.is_admin() to authenticated;

-- 3) Make sure content sync tables exist.
create table if not exists public.menu_item_overrides (
  item_key text primary key,
  image_url text not null,
  storage_path text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.tech_card_overrides (
  card_key text primary key,
  title text not null,
  category text default '',
  output text default '',
  technology text default '',
  ingredients jsonb not null default '[]'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.menu_item_overrides enable row level security;
alter table public.tech_card_overrides enable row level security;

grant select, insert, update, delete on public.menu_item_overrides to authenticated;
grant select, insert, update, delete on public.tech_card_overrides to authenticated;

-- 4) Recreate RLS policies for shared menu photos.
drop policy if exists "menu_item_overrides_select_authenticated" on public.menu_item_overrides;
drop policy if exists "menu_item_overrides_insert_admin" on public.menu_item_overrides;
drop policy if exists "menu_item_overrides_update_admin" on public.menu_item_overrides;
drop policy if exists "menu_item_overrides_delete_admin" on public.menu_item_overrides;

create policy "menu_item_overrides_select_authenticated"
on public.menu_item_overrides
for select
to authenticated
using (true);

create policy "menu_item_overrides_insert_admin"
on public.menu_item_overrides
for insert
to authenticated
with check (public.is_admin());

create policy "menu_item_overrides_update_admin"
on public.menu_item_overrides
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "menu_item_overrides_delete_admin"
on public.menu_item_overrides
for delete
to authenticated
using (public.is_admin());

-- 5) Recreate RLS policies for editable tech cards.
drop policy if exists "tech_card_overrides_select_authenticated" on public.tech_card_overrides;
drop policy if exists "tech_card_overrides_insert_admin" on public.tech_card_overrides;
drop policy if exists "tech_card_overrides_update_admin" on public.tech_card_overrides;
drop policy if exists "tech_card_overrides_delete_admin" on public.tech_card_overrides;

create policy "tech_card_overrides_select_authenticated"
on public.tech_card_overrides
for select
to authenticated
using (true);

create policy "tech_card_overrides_insert_admin"
on public.tech_card_overrides
for insert
to authenticated
with check (public.is_admin());

create policy "tech_card_overrides_update_admin"
on public.tech_card_overrides
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "tech_card_overrides_delete_admin"
on public.tech_card_overrides
for delete
to authenticated
using (public.is_admin());

-- 6) Make sure Storage bucket exists and is public for reading images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menu-photos',
  'menu-photos',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

-- 7) Recreate Storage policies for menu photos.
drop policy if exists "menu_photos_read_public" on storage.objects;
drop policy if exists "menu_photos_insert_admin" on storage.objects;
drop policy if exists "menu_photos_update_admin" on storage.objects;
drop policy if exists "menu_photos_delete_admin" on storage.objects;

create policy "menu_photos_read_public"
on storage.objects
for select
to public
using (bucket_id = 'menu-photos');

create policy "menu_photos_insert_admin"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'menu-photos' and public.is_admin());

create policy "menu_photos_update_admin"
on storage.objects
for update
to authenticated
using (bucket_id = 'menu-photos' and public.is_admin())
with check (bucket_id = 'menu-photos' and public.is_admin());

create policy "menu_photos_delete_admin"
on storage.objects
for delete
to authenticated
using (bucket_id = 'menu-photos' and public.is_admin());

-- 8) Quick check. You should see one active admin row for grigory.
select id, login, name, role, is_active
from public.profiles
where login = 'grigory';
