-- Checklist photo reports preview: private storage, authoritative completion and 90-day retention.
begin;

alter table public.checklist_submissions
  add column if not exists photo_required_count integer not null default 0,
  add column if not exists photo_count integer not null default 0,
  add column if not exists photo_upload_status text not null default 'not_required',
  add column if not exists submitted_incomplete boolean not null default false,
  add column if not exists version integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.checklist_submissions'::regclass
      and conname = 'checklist_submissions_photo_counts_check'
  ) then
    alter table public.checklist_submissions
      add constraint checklist_submissions_photo_counts_check
      check (photo_required_count >= 0 and photo_count >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.checklist_submissions'::regclass
      and conname = 'checklist_submissions_photo_status_check'
  ) then
    alter table public.checklist_submissions
      add constraint checklist_submissions_photo_status_check
      check (photo_upload_status in ('not_required','pending','partial','complete','expired'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.checklist_submissions'::regclass
      and conname = 'checklist_submissions_version_check'
  ) then
    alter table public.checklist_submissions
      add constraint checklist_submissions_version_check
      check (version >= 1);
  end if;
end
$$;

create table if not exists public.checklist_photo_rules (
  checklist_id text not null,
  item_key text not null,
  item_text text not null,
  required_count smallint not null default 1 check (required_count between 1 and 3),
  hint text not null default '',
  is_active boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (checklist_id, item_key),
  check (length(btrim(checklist_id)) > 0),
  check (length(btrim(item_key)) > 0),
  check (length(btrim(item_text)) > 0)
);

create table if not exists public.checklist_submission_photos (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.checklist_submissions(id) on delete cascade,
  checklist_id text not null,
  item_key text not null,
  item_text text not null,
  photo_index smallint not null check (photo_index between 1 and 3),
  storage_path text not null unique,
  thumbnail_path text not null unique,
  mime_type text not null default 'image/jpeg' check (mime_type in ('image/jpeg','image/webp')),
  file_size integer not null check (file_size between 1 and 3145728),
  thumbnail_size integer not null check (thumbnail_size between 1 and 1048576),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  retained boolean not null default false,
  retained_at timestamptz,
  retained_by uuid references public.profiles(id) on delete set null,
  deleted_at timestamptz,
  deleted_reason text,
  unique (submission_id, item_key, photo_index),
  check (length(btrim(item_key)) > 0),
  check (length(btrim(storage_path)) > 0),
  check (length(btrim(thumbnail_path)) > 0),
  check (storage_path <> thumbnail_path)
);

create index if not exists checklist_photo_rules_active_idx
  on public.checklist_photo_rules(checklist_id, is_active, item_key);
create index if not exists checklist_submission_photos_submission_idx
  on public.checklist_submission_photos(submission_id, item_key, photo_index);
create index if not exists checklist_submission_photos_retention_idx
  on public.checklist_submission_photos(expires_at, retained, deleted_at)
  where retained = false and deleted_at is null;
create index if not exists checklist_submission_photos_creator_idx
  on public.checklist_submission_photos(created_by, created_at desc);

alter table public.checklist_photo_rules enable row level security;
alter table public.checklist_submission_photos enable row level security;

drop trigger if exists touch_checklist_photo_rules_updated_at on public.checklist_photo_rules;
create trigger touch_checklist_photo_rules_updated_at
before update on public.checklist_photo_rules
for each row execute function public.touch_updated_at();

create or replace function public.prepare_checklist_photo_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_items jsonb := '[]'::jsonb;
  normalized_total integer := 0;
  normalized_done integer := 0;
  required_total integer := 0;
  item jsonb;
  checked_by_user boolean;
  required_count integer;
  status text;
begin
  if jsonb_typeof(coalesce(new.items, '[]'::jsonb)) <> 'array' then
    raise exception 'Checklist items must be a JSON array' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(coalesce(new.items, '[]'::jsonb))
  loop
    checked_by_user := lower(coalesce(
      item->>'checkedByUser',
      item->>'checked_by_user',
      item->>'checked',
      'false'
    )) in ('true','1','yes','да');

    select coalesce(max(rule.required_count), 0)
      into required_count
    from public.checklist_photo_rules rule
    where rule.checklist_id = new.checklist_id
      and rule.item_key = coalesce(item->>'itemKey', item->>'item_key', '')
      and rule.is_active = true;

    status := case when required_count > 0 then 'missing' else 'not_required' end;
    normalized_items := normalized_items || jsonb_build_array(
      item || jsonb_build_object(
        'itemKey', coalesce(item->>'itemKey', item->>'item_key', ''),
        'checkedByUser', checked_by_user,
        'checked', checked_by_user and required_count = 0,
        'photoRequired', required_count > 0,
        'requiredPhotoCount', required_count,
        'photoCount', 0,
        'photoStatus', status
      )
    );
    normalized_total := normalized_total + 1;
    if checked_by_user and required_count = 0 then normalized_done := normalized_done + 1; end if;
    required_total := required_total + required_count;
  end loop;

  new.items := normalized_items;
  new.total_count := normalized_total;
  new.completed_count := normalized_done;
  new.percent := case when normalized_total > 0 then round(normalized_done::numeric / normalized_total * 100)::integer else 0 end;
  new.photo_required_count := required_total;
  new.photo_count := 0;
  new.photo_upload_status := case when required_total > 0 then 'pending' else 'not_required' end;
  new.submitted_incomplete := normalized_done < normalized_total;
  new.version := case when required_total > 0 then greatest(coalesce(new.version, 1), 2) else greatest(coalesce(new.version, 1), 1) end;
  return new;
end;
$$;

revoke execute on function public.prepare_checklist_photo_submission() from public, anon, authenticated;

drop trigger if exists prepare_checklist_photo_submission on public.checklist_submissions;
create trigger prepare_checklist_photo_submission
before insert on public.checklist_submissions
for each row execute function public.prepare_checklist_photo_submission();

create or replace function public.enforce_checklist_photo_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  submission public.checklist_submissions%rowtype;
  expected_prefix text;
  expected_item_text text;
begin
  if actor_id is null then return new; end if;
  if not public.is_active_user() then
    raise exception 'Active profile required' using errcode = '42501';
  end if;

  select * into submission
  from public.checklist_submissions
  where id = new.submission_id;

  if submission.id is null or submission.employee_id is distinct from actor_id then
    raise exception 'Only the submission owner may attach photos' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(coalesce(submission.items, '[]'::jsonb)) item
    where coalesce(item->>'itemKey', item->>'item_key', '') = new.item_key
  ) then
    raise exception 'Checklist item does not belong to submission' using errcode = '23514';
  end if;

  select coalesce(item->>'text', item->>'task', item->>'label', new.item_text)
    into expected_item_text
  from jsonb_array_elements(coalesce(submission.items, '[]'::jsonb)) item
  where coalesce(item->>'itemKey', item->>'item_key', '') = new.item_key
  limit 1;

  expected_prefix := actor_id::text || '/' || new.submission_id::text || '/';
  if left(new.storage_path, length(expected_prefix)) <> expected_prefix
     or left(new.thumbnail_path, length(expected_prefix)) <> expected_prefix then
    raise exception 'Photo storage path must use the owner and submission prefix' using errcode = '23514';
  end if;

  new.created_by := actor_id;
  new.checklist_id := submission.checklist_id;
  new.item_text := coalesce(nullif(btrim(expected_item_text), ''), new.item_text, 'Пункт чек-листа');
  new.created_at := coalesce(new.created_at, now());
  new.expires_at := new.created_at + interval '90 days';
  new.retained := false;
  new.retained_at := null;
  new.retained_by := null;
  new.deleted_at := null;
  new.deleted_reason := null;
  return new;
end;
$$;

revoke execute on function public.enforce_checklist_photo_metadata() from public, anon, authenticated;

drop trigger if exists enforce_checklist_photo_metadata on public.checklist_submission_photos;
create trigger enforce_checklist_photo_metadata
before insert on public.checklist_submission_photos
for each row execute function public.enforce_checklist_photo_metadata();

create or replace function public.replace_checklist_photo_rules(
  p_checklist_id text,
  p_rules jsonb
)
returns setof public.checklist_photo_rules
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not public.is_admin() then
    raise exception 'Administrator profile required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_checklist_id, '')), '') is null then
    raise exception 'Checklist id is required' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_rules, '[]'::jsonb)) <> 'array' then
    raise exception 'Rules must be a JSON array' using errcode = '22023';
  end if;

  delete from public.checklist_photo_rules where checklist_id = p_checklist_id;

  insert into public.checklist_photo_rules (
    checklist_id, item_key, item_text, required_count, hint, is_active, updated_by
  )
  select
    p_checklist_id,
    btrim(rule.item_key),
    btrim(rule.item_text),
    rule.required_count::smallint,
    coalesce(rule.hint, ''),
    true,
    actor_id
  from jsonb_to_recordset(coalesce(p_rules, '[]'::jsonb))
    as rule(item_key text, item_text text, required_count integer, hint text)
  where nullif(btrim(coalesce(rule.item_key, '')), '') is not null
    and nullif(btrim(coalesce(rule.item_text, '')), '') is not null
    and rule.required_count between 1 and 3;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_rules, '[]'::jsonb))
      as invalid(item_key text, item_text text, required_count integer, hint text)
    where nullif(btrim(coalesce(invalid.item_key, '')), '') is null
       or nullif(btrim(coalesce(invalid.item_text, '')), '') is null
       or invalid.required_count not between 1 and 3
  ) then
    raise exception 'Invalid checklist photo rule' using errcode = '22023';
  end if;

  return query
  select * from public.checklist_photo_rules
  where checklist_id = p_checklist_id
  order by item_key;
end;
$$;

create or replace function public.finalize_checklist_photo_submission(
  p_submission_id uuid,
  p_items jsonb
)
returns setof public.checklist_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  submission public.checklist_submissions%rowtype;
  normalized_items jsonb := '[]'::jsonb;
  normalized_total integer := 0;
  normalized_done integer := 0;
  required_total integer := 0;
  attached_total integer := 0;
  missing_total integer := 0;
  item jsonb;
  checked_by_user boolean;
  required_count integer;
  attached_count integer;
  photo_status text;
begin
  if actor_id is null or not public.is_active_user() then
    raise exception 'Active profile required' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Checklist items must be a JSON array' using errcode = '22023';
  end if;

  select * into submission
  from public.checklist_submissions
  where id = p_submission_id
  for update;

  if submission.id is null or submission.employee_id is distinct from actor_id then
    raise exception 'Only the submission owner may finalize photos' using errcode = '42501';
  end if;

  for item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    checked_by_user := lower(coalesce(
      item->>'checkedByUser',
      item->>'checked_by_user',
      item->>'checked',
      'false'
    )) in ('true','1','yes','да');

    select coalesce(max(rule.required_count), 0)
      into required_count
    from public.checklist_photo_rules rule
    where rule.checklist_id = submission.checklist_id
      and rule.item_key = coalesce(item->>'itemKey', item->>'item_key', '')
      and rule.is_active = true;

    select count(*)::integer
      into attached_count
    from public.checklist_submission_photos photo
    where photo.submission_id = p_submission_id
      and photo.item_key = coalesce(item->>'itemKey', item->>'item_key', '')
      and photo.deleted_at is null;

    photo_status := case
      when required_count = 0 then 'not_required'
      when attached_count >= required_count then 'complete'
      when attached_count > 0 then 'partial'
      when checked_by_user then 'awaiting_photo'
      else 'missing'
    end;

    normalized_items := normalized_items || jsonb_build_array(
      item || jsonb_build_object(
        'itemKey', coalesce(item->>'itemKey', item->>'item_key', ''),
        'checkedByUser', checked_by_user,
        'checked', checked_by_user and attached_count >= required_count,
        'photoRequired', required_count > 0,
        'requiredPhotoCount', required_count,
        'photoCount', attached_count,
        'photoStatus', photo_status
      )
    );
    normalized_total := normalized_total + 1;
    if checked_by_user and attached_count >= required_count then normalized_done := normalized_done + 1; end if;
    required_total := required_total + required_count;
    attached_total := attached_total + attached_count;
    missing_total := missing_total + greatest(required_count - attached_count, 0);
  end loop;

  update public.checklist_submissions
  set items = normalized_items,
      completed_count = normalized_done,
      total_count = normalized_total,
      percent = case when normalized_total > 0 then round(normalized_done::numeric / normalized_total * 100)::integer else 0 end,
      photo_required_count = required_total,
      photo_count = attached_total,
      photo_upload_status = case
        when required_total = 0 then 'not_required'
        when missing_total = 0 then 'complete'
        when attached_total = 0 then 'pending'
        else 'partial'
      end,
      submitted_incomplete = normalized_done < normalized_total,
      version = greatest(version, 2)
  where id = p_submission_id;

  return query select * from public.checklist_submissions where id = p_submission_id;
end;
$$;

create or replace function public.set_checklist_photo_retained(
  p_photo_id uuid,
  p_retained boolean
)
returns setof public.checklist_submission_photos
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not public.is_admin() then
    raise exception 'Administrator profile required' using errcode = '42501';
  end if;

  update public.checklist_submission_photos
  set retained = coalesce(p_retained, false),
      retained_at = case when coalesce(p_retained, false) then now() else null end,
      retained_by = case when coalesce(p_retained, false) then actor_id else null end,
      expires_at = case when coalesce(p_retained, false) then expires_at else created_at + interval '90 days' end
  where id = p_photo_id
    and deleted_at is null;

  if not found then
    raise exception 'Photo not found or already deleted' using errcode = 'P0002';
  end if;

  return query select * from public.checklist_submission_photos where id = p_photo_id;
end;
$$;

revoke all on table public.checklist_photo_rules from public, anon;
revoke all on table public.checklist_submission_photos from public, anon;
revoke all on table public.checklist_photo_rules from authenticated;
revoke all on table public.checklist_submission_photos from authenticated;
grant select on table public.checklist_photo_rules to authenticated;
grant select, insert on table public.checklist_submission_photos to authenticated;

revoke execute on function public.replace_checklist_photo_rules(text, jsonb) from public, anon;
revoke execute on function public.finalize_checklist_photo_submission(uuid, jsonb) from public, anon;
revoke execute on function public.set_checklist_photo_retained(uuid, boolean) from public, anon;
grant execute on function public.replace_checklist_photo_rules(text, jsonb) to authenticated, service_role;
grant execute on function public.finalize_checklist_photo_submission(uuid, jsonb) to authenticated, service_role;
grant execute on function public.set_checklist_photo_retained(uuid, boolean) to authenticated, service_role;

drop policy if exists "checklist_photo_rules_select_active" on public.checklist_photo_rules;
create policy "checklist_photo_rules_select_active"
on public.checklist_photo_rules
for select
to authenticated
using (public.is_active_user());

drop policy if exists "checklist_submission_photos_select_visible" on public.checklist_submission_photos;
create policy "checklist_submission_photos_select_visible"
on public.checklist_submission_photos
for select
to authenticated
using (
  public.is_active_user()
  and (
    public.is_admin_or_manager()
    or created_by = auth.uid()
  )
);

drop policy if exists "checklist_submission_photos_insert_owner" on public.checklist_submission_photos;
create policy "checklist_submission_photos_insert_owner"
on public.checklist_submission_photos
for insert
to authenticated
with check (
  public.is_active_user()
  and created_by = auth.uid()
  and exists (
    select 1 from public.checklist_submissions submission
    where submission.id = submission_id
      and submission.employee_id = auth.uid()
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'checklist-photo-reports',
  'checklist-photo-reports',
  false,
  3145728,
  array['image/jpeg','image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 3145728,
  allowed_mime_types = array['image/jpeg','image/webp'];

drop policy if exists "checklist_photo_storage_insert_owner" on storage.objects;
create policy "checklist_photo_storage_insert_owner"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'checklist-photo-reports'
  and public.is_active_user()
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "checklist_photo_storage_select_visible" on storage.objects;
create policy "checklist_photo_storage_select_visible"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'checklist-photo-reports'
  and public.is_active_user()
  and (
    public.is_admin_or_manager()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);

commit;
