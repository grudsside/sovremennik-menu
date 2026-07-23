-- Shift handoff preview: structured notes, optional photos and personal acknowledgements.
begin;

create table if not exists public.shift_handoffs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_by_name text not null,
  created_by_role text not null,
  unfinished text[] not null default '{}',
  out_of_stock text[] not null default '{}',
  equipment_issues text[] not null default '{}',
  next_shift_control text[] not null default '{}',
  notes text not null default '',
  created_at timestamptz not null default now(),
  visible_until timestamptz not null default (now() + interval '72 hours'),
  check (created_by_role in ('admin','manager','barista','waiter')),
  check (cardinality(unfinished) <= 30),
  check (cardinality(out_of_stock) <= 30),
  check (cardinality(equipment_issues) <= 30),
  check (cardinality(next_shift_control) <= 30),
  check (length(notes) <= 2000),
  check (
    cardinality(unfinished) > 0
    or cardinality(out_of_stock) > 0
    or cardinality(equipment_issues) > 0
    or cardinality(next_shift_control) > 0
    or length(btrim(notes)) > 0
  )
);

create table if not exists public.shift_handoff_acknowledgements (
  handoff_id uuid not null references public.shift_handoffs(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete restrict,
  employee_name text not null,
  acknowledged_at timestamptz not null default now(),
  primary key (handoff_id, employee_id)
);

create table if not exists public.shift_handoff_photos (
  id uuid primary key default gen_random_uuid(),
  handoff_id uuid not null references public.shift_handoffs(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null default 'image/jpeg' check (mime_type in ('image/jpeg','image/webp')),
  file_size integer not null check (file_size between 1 and 3145728),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (length(btrim(storage_path)) > 0)
);

create index if not exists shift_handoffs_created_idx on public.shift_handoffs(created_at desc);
create index if not exists shift_handoffs_visible_idx on public.shift_handoffs(visible_until desc, created_at desc);
create index if not exists shift_handoff_ack_employee_idx on public.shift_handoff_acknowledgements(employee_id, acknowledged_at desc);
create index if not exists shift_handoff_photos_handoff_idx on public.shift_handoff_photos(handoff_id, created_at);

alter table public.shift_handoffs enable row level security;
alter table public.shift_handoff_acknowledgements enable row level security;
alter table public.shift_handoff_photos enable row level security;

create or replace function public.prepare_shift_handoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
begin
  select profile.* into actor
  from public.profiles profile
  where profile.id = auth.uid() and profile.is_active = true;
  if actor.id is null then
    raise exception 'Active profile required' using errcode = '42501';
  end if;

  new.created_by := actor.id;
  new.created_by_name := actor.name;
  new.created_by_role := actor.role;
  new.unfinished := coalesce(new.unfinished, '{}');
  new.out_of_stock := coalesce(new.out_of_stock, '{}');
  new.equipment_issues := coalesce(new.equipment_issues, '{}');
  new.next_shift_control := coalesce(new.next_shift_control, '{}');
  new.notes := left(btrim(coalesce(new.notes, '')), 2000);
  new.created_at := coalesce(new.created_at, now());
  new.visible_until := new.created_at + interval '72 hours';
  return new;
end;
$$;

revoke execute on function public.prepare_shift_handoff() from public, anon, authenticated;
drop trigger if exists prepare_shift_handoff on public.shift_handoffs;
create trigger prepare_shift_handoff
before insert on public.shift_handoffs
for each row execute function public.prepare_shift_handoff();

create or replace function public.create_shift_handoff(
  p_id uuid,
  p_unfinished text[],
  p_out_of_stock text[],
  p_equipment_issues text[],
  p_next_shift_control text[],
  p_notes text
)
returns setof public.shift_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not public.is_active_user() then
    raise exception 'Active profile required' using errcode = '42501';
  end if;

  update public.shift_handoffs as previous_handoff
  set visible_until = least(previous_handoff.visible_until, now())
  where previous_handoff.visible_until > now();

  return query
  insert into public.shift_handoffs as inserted_handoff (
    id, created_by, created_by_name, created_by_role,
    unfinished, out_of_stock, equipment_issues, next_shift_control, notes
  ) values (
    coalesce(p_id, gen_random_uuid()), actor_id, '', '',
    coalesce(p_unfinished, '{}'), coalesce(p_out_of_stock, '{}'),
    coalesce(p_equipment_issues, '{}'), coalesce(p_next_shift_control, '{}'),
    coalesce(p_notes, '')
  )
  returning inserted_handoff.*;
end;
$$;

create or replace function public.acknowledge_shift_handoff(p_handoff_id uuid)
returns setof public.shift_handoff_acknowledgements
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  source public.shift_handoffs%rowtype;
begin
  select profile.* into actor
  from public.profiles profile
  where profile.id = auth.uid() and profile.is_active = true;
  if actor.id is null then
    raise exception 'Active profile required' using errcode = '42501';
  end if;

  select handoff.* into source
  from public.shift_handoffs handoff
  where handoff.id = p_handoff_id;
  if source.id is null or source.created_at < now() - interval '30 days' then
    raise exception 'Shift handoff is unavailable' using errcode = 'P0002';
  end if;
  if source.created_by = actor.id then
    raise exception 'The author cannot acknowledge their own handoff' using errcode = '42501';
  end if;

  insert into public.shift_handoff_acknowledgements (
    handoff_id, employee_id, employee_name, acknowledged_at
  ) values (
    source.id, actor.id, actor.name, now()
  )
  on conflict on constraint shift_handoff_acknowledgements_pkey do nothing;

  return query
  select acknowledgement.*
  from public.shift_handoff_acknowledgements acknowledgement
  where acknowledgement.handoff_id = source.id
    and acknowledgement.employee_id = actor.id;
end;
$$;

create or replace function public.enforce_shift_handoff_photo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  source public.shift_handoffs%rowtype;
  expected_prefix text;
begin
  if actor_id is null or not public.is_active_user() then
    raise exception 'Active profile required' using errcode = '42501';
  end if;

  select handoff.* into source
  from public.shift_handoffs handoff
  where handoff.id = new.handoff_id;
  if source.id is null or source.created_by <> actor_id then
    raise exception 'Only the handoff author may attach photos' using errcode = '42501';
  end if;
  if (
    select count(*)
    from public.shift_handoff_photos photo
    where photo.handoff_id = source.id
  ) >= 3 then
    raise exception 'A shift handoff may contain up to three photos' using errcode = '23514';
  end if;

  expected_prefix := actor_id::text || '/' || source.id::text || '/';
  if left(new.storage_path, length(expected_prefix)) <> expected_prefix then
    raise exception 'Photo storage path must use the owner and handoff prefix' using errcode = '23514';
  end if;

  new.created_by := actor_id;
  new.created_at := coalesce(new.created_at, now());
  return new;
end;
$$;

revoke execute on function public.enforce_shift_handoff_photo() from public, anon, authenticated;
drop trigger if exists enforce_shift_handoff_photo on public.shift_handoff_photos;
create trigger enforce_shift_handoff_photo
before insert on public.shift_handoff_photos
for each row execute function public.enforce_shift_handoff_photo();

drop policy if exists shift_handoffs_select_active on public.shift_handoffs;
create policy shift_handoffs_select_active on public.shift_handoffs
for select to authenticated
using (public.is_active_user() and shift_handoffs.created_at >= now() - interval '30 days');

drop policy if exists shift_handoff_ack_select_active on public.shift_handoff_acknowledgements;
create policy shift_handoff_ack_select_active on public.shift_handoff_acknowledgements
for select to authenticated
using (public.is_active_user());

drop policy if exists shift_handoff_photos_select_active on public.shift_handoff_photos;
create policy shift_handoff_photos_select_active on public.shift_handoff_photos
for select to authenticated
using (public.is_active_user());

drop policy if exists shift_handoff_photos_insert_owner on public.shift_handoff_photos;
create policy shift_handoff_photos_insert_owner on public.shift_handoff_photos
for insert to authenticated
with check (
  public.is_active_user()
  and shift_handoff_photos.created_by = auth.uid()
  and exists (
    select 1 from public.shift_handoffs handoff
    where handoff.id = shift_handoff_photos.handoff_id
      and handoff.created_by = auth.uid()
  )
);

revoke all on public.shift_handoffs from anon, authenticated;
revoke all on public.shift_handoff_acknowledgements from anon, authenticated;
revoke all on public.shift_handoff_photos from anon, authenticated;
grant select on public.shift_handoffs to authenticated;
grant select on public.shift_handoff_acknowledgements to authenticated;
grant select, insert on public.shift_handoff_photos to authenticated;
grant execute on function public.create_shift_handoff(uuid,text[],text[],text[],text[],text) to authenticated;
grant execute on function public.acknowledge_shift_handoff(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shift-handoff-photos', 'shift-handoff-photos', false, 3145728, array['image/jpeg','image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists shift_handoff_storage_select_active on storage.objects;
create policy shift_handoff_storage_select_active on storage.objects
for select to authenticated
using (bucket_id = 'shift-handoff-photos' and public.is_active_user());

drop policy if exists shift_handoff_storage_insert_owner on storage.objects;
create policy shift_handoff_storage_insert_owner on storage.objects
for insert to authenticated
with check (
  bucket_id = 'shift-handoff-photos'
  and public.is_active_user()
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1 from public.shift_handoffs handoff
    where handoff.id::text = (storage.foldername(name))[2]
      and handoff.created_by = auth.uid()
  )
);

drop policy if exists shift_handoff_storage_delete_owner on storage.objects;
create policy shift_handoff_storage_delete_owner on storage.objects
for delete to authenticated
using (
  bucket_id = 'shift-handoff-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

commit;
