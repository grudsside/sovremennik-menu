-- Apply administrator access and latest-until-next-closing lifecycle to already prepared Preview environments.
begin;

create or replace function public.is_shift_handoff_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.is_active = true
      and profile.role in ('admin','barista')
  );
$$;

revoke all on function public.is_shift_handoff_user() from public, anon;
grant execute on function public.is_shift_handoff_user() to authenticated;

create or replace function public.is_shift_handoff_barista()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_shift_handoff_user();
$$;

revoke all on function public.is_shift_handoff_barista() from public, anon;
grant execute on function public.is_shift_handoff_barista() to authenticated;

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
  where profile.id = auth.uid()
    and profile.is_active = true
    and profile.role in ('admin','barista');

  if actor.id is null then
    raise exception 'Active administrator or barista profile required' using errcode = '42501';
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
  new.visible_until := '9999-12-31 23:59:59+00'::timestamptz;
  return new;
end;
$$;

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
  actor public.profiles%rowtype;
begin
  select profile.* into actor
  from public.profiles profile
  where profile.id = auth.uid()
    and profile.is_active = true
    and profile.role in ('admin','barista');

  if actor.id is null then
    raise exception 'Active administrator or barista profile required' using errcode = '42501';
  end if;

  update public.shift_handoffs as previous_handoff
  set visible_until = least(previous_handoff.visible_until, now())
  where previous_handoff.visible_until > now();

  return query
  insert into public.shift_handoffs as inserted_handoff (
    id, created_by, created_by_name, created_by_role,
    unfinished, out_of_stock, equipment_issues, next_shift_control, notes
  ) values (
    coalesce(p_id, gen_random_uuid()), actor.id, actor.name, actor.role,
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
  where profile.id = auth.uid()
    and profile.is_active = true
    and profile.role in ('admin','barista');

  if actor.id is null then
    raise exception 'Active administrator or barista profile required' using errcode = '42501';
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
  if actor_id is null or not public.is_shift_handoff_user() then
    raise exception 'Active administrator or barista profile required' using errcode = '42501';
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

update public.shift_handoffs
set visible_until = '9999-12-31 23:59:59+00'::timestamptz
where visible_until > now();

drop policy if exists shift_handoffs_select_active on public.shift_handoffs;
create policy shift_handoffs_select_active on public.shift_handoffs
for select to authenticated
using (
  public.is_shift_handoff_user()
  and shift_handoffs.created_at >= now() - interval '30 days'
);

drop policy if exists shift_handoff_ack_select_active on public.shift_handoff_acknowledgements;
create policy shift_handoff_ack_select_active on public.shift_handoff_acknowledgements
for select to authenticated
using (public.is_shift_handoff_user());

drop policy if exists shift_handoff_photos_select_active on public.shift_handoff_photos;
create policy shift_handoff_photos_select_active on public.shift_handoff_photos
for select to authenticated
using (public.is_shift_handoff_user());

drop policy if exists shift_handoff_photos_insert_owner on public.shift_handoff_photos;
create policy shift_handoff_photos_insert_owner on public.shift_handoff_photos
for insert to authenticated
with check (
  public.is_shift_handoff_user()
  and shift_handoff_photos.created_by = auth.uid()
  and exists (
    select 1 from public.shift_handoffs handoff
    where handoff.id = shift_handoff_photos.handoff_id
      and handoff.created_by = auth.uid()
  )
);

drop policy if exists shift_handoff_storage_select_active on storage.objects;
create policy shift_handoff_storage_select_active on storage.objects
for select to authenticated
using (
  bucket_id = 'shift-handoff-photos'
  and public.is_shift_handoff_user()
);

drop policy if exists shift_handoff_storage_insert_owner on storage.objects;
create policy shift_handoff_storage_insert_owner on storage.objects
for insert to authenticated
with check (
  bucket_id = 'shift-handoff-photos'
  and public.is_shift_handoff_user()
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
  and public.is_shift_handoff_user()
  and (storage.foldername(name))[1] = auth.uid()::text
);

commit;
