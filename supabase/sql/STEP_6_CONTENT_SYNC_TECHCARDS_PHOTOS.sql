-- STEP 6. Content sync for tech cards and menu photos.
-- Run this file in Supabase SQL Editor before uploading v22 site files.
-- It adds shared storage for admin edits so all employees see updated photos and tech cards.

create extension if not exists pgcrypto;

-- 1) Shared photo overrides for menu cards.
create table if not exists public.menu_item_overrides (
  item_key text primary key,
  image_url text not null,
  storage_path text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- 2) Shared editable tech card overrides.
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

-- Everyone who can log in can read the latest menu/photo overrides.
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

-- Only admin can edit.
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

-- Updated-at triggers.
drop trigger if exists touch_menu_item_overrides_updated_at on public.menu_item_overrides;
create trigger touch_menu_item_overrides_updated_at before update on public.menu_item_overrides
for each row execute function public.touch_updated_at();

drop trigger if exists touch_tech_card_overrides_updated_at on public.tech_card_overrides;
create trigger touch_tech_card_overrides_updated_at before update on public.tech_card_overrides
for each row execute function public.touch_updated_at();

-- 3) Public storage bucket for menu/card photos.
-- Public read is used so images work on GitHub Pages without signed URLs.
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

-- Public read for images. Write access only for admin.
drop policy if exists "menu_photos_read_public" on storage.objects;
create policy "menu_photos_read_public"
on storage.objects
for select
to public
using (bucket_id = 'menu-photos');

drop policy if exists "menu_photos_insert_admin" on storage.objects;
create policy "menu_photos_insert_admin"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'menu-photos' and public.is_admin());

drop policy if exists "menu_photos_update_admin" on storage.objects;
create policy "menu_photos_update_admin"
on storage.objects
for update
to authenticated
using (bucket_id = 'menu-photos' and public.is_admin())
with check (bucket_id = 'menu-photos' and public.is_admin());

drop policy if exists "menu_photos_delete_admin" on storage.objects;
create policy "menu_photos_delete_admin"
on storage.objects
for delete
to authenticated
using (bucket_id = 'menu-photos' and public.is_admin());
