-- Shared checklist draft photos and transactional finalization.
begin;

create or replace function public.attach_checklist_shared_draft_photo(
  p_draft_id uuid,
  p_photo_id uuid,
  p_item_key text,
  p_storage_path text,
  p_thumbnail_path text,
  p_mime_type text,
  p_file_size integer,
  p_thumbnail_size integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  draft public.checklist_shared_drafts%rowtype;
  item public.checklist_shared_draft_items%rowtype;
  next_index integer;
  expected_prefix text;
begin
  select * into draft
  from public.checklist_shared_drafts
  where id = p_draft_id
  for update;

  if draft.id is null or actor_id is null or not public.can_access_checklist_shared_department(draft.department) then
    raise exception 'Shared checklist draft is not accessible' using errcode = '42501';
  end if;
  if draft.status <> 'draft' then
    raise exception 'Shared checklist draft is already submitted' using errcode = '55000';
  end if;

  select * into item
  from public.checklist_shared_draft_items
  where draft_id = p_draft_id and item_key = btrim(p_item_key)
  for update;
  if item.draft_id is null then
    raise exception 'Checklist item does not exist in shared draft' using errcode = 'P0002';
  end if;

  expected_prefix := actor_id::text || '/shared/' || p_draft_id::text || '/';
  if left(coalesce(p_storage_path, ''), length(expected_prefix)) <> expected_prefix
     or left(coalesce(p_thumbnail_path, ''), length(expected_prefix)) <> expected_prefix then
    raise exception 'Shared photo path must use the current user and draft prefix' using errcode = '23514';
  end if;
  if coalesce(p_mime_type, '') not in ('image/jpeg','image/webp')
     or p_file_size not between 1 and 3145728
     or p_thumbnail_size not between 1 and 1048576 then
    raise exception 'Shared photo metadata is invalid' using errcode = '22023';
  end if;

  select candidate into next_index
  from generate_series(1, item.required_photo_count) candidate
  where not exists (
    select 1 from public.checklist_shared_draft_photos existing
    where existing.draft_id = p_draft_id
      and existing.item_key = item.item_key
      and existing.photo_index = candidate
      and existing.deleted_at is null
  )
  order by candidate
  limit 1;

  if not item.photo_required or item.required_photo_count < 1 then
    raise exception 'This checklist item does not accept photos' using errcode = '22023';
  end if;
  if next_index is null or next_index > item.required_photo_count or next_index > 3 then
    raise exception 'Too many photos for checklist item' using errcode = '22023';
  end if;

  select name into actor_name
  from public.profiles
  where id = actor_id and is_active = true;

  insert into public.checklist_shared_draft_photos (
    id, draft_id, item_key, photo_index, storage_path, thumbnail_path,
    mime_type, file_size, thumbnail_size, created_by, created_by_name
  ) values (
    p_photo_id, p_draft_id, item.item_key, next_index, p_storage_path, p_thumbnail_path,
    p_mime_type, p_file_size, p_thumbnail_size, actor_id, coalesce(actor_name, '')
  )
  on conflict (id) do nothing;

  update public.checklist_shared_drafts
  set updated_by = actor_id, updated_at = now(), version = version + 1
  where id = p_draft_id;

  return public.checklist_shared_draft_payload(p_draft_id);
end;
$$;

create or replace function public.remove_checklist_shared_draft_photo(
  p_draft_id uuid,
  p_photo_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  draft public.checklist_shared_drafts%rowtype;
  removed_item_key text;
begin
  select * into draft
  from public.checklist_shared_drafts
  where id = p_draft_id
  for update;

  if draft.id is null or actor_id is null or not public.can_access_checklist_shared_department(draft.department) then
    raise exception 'Shared checklist draft is not accessible' using errcode = '42501';
  end if;
  if draft.status <> 'draft' then
    raise exception 'Shared checklist draft is already submitted' using errcode = '55000';
  end if;

  update public.checklist_shared_draft_photos
  set deleted_at = now(), deleted_by = actor_id
  where id = p_photo_id and draft_id = p_draft_id and deleted_at is null
  returning item_key into removed_item_key;

  if removed_item_key is null then
    raise exception 'Shared checklist photo was not found' using errcode = 'P0002';
  end if;

  update public.checklist_shared_drafts
  set updated_by = actor_id, updated_at = now(), version = version + 1
  where id = p_draft_id;

  return public.checklist_shared_draft_payload(p_draft_id);
end;
$$;

-- Extend the existing photo metadata guard so a final submission can reuse files
-- uploaded by another permitted collaborator while the draft was open.
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
  shared_creator uuid;
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

  select photo.created_by into shared_creator
  from public.checklist_shared_draft_photos photo
  join public.checklist_shared_drafts draft on draft.id = photo.draft_id
  where draft.submission_id = new.submission_id
    and photo.item_key = new.item_key
    and photo.storage_path = new.storage_path
    and photo.thumbnail_path = new.thumbnail_path
    and photo.deleted_at is null
  limit 1;

  if shared_creator is null then
    expected_prefix := actor_id::text || '/' || new.submission_id::text || '/';
    if left(new.storage_path, length(expected_prefix)) <> expected_prefix
       or left(new.thumbnail_path, length(expected_prefix)) <> expected_prefix then
      raise exception 'Photo storage path must use the owner and submission prefix' using errcode = '23514';
    end if;
    new.created_by := actor_id;
  else
    new.created_by := shared_creator;
  end if;

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

create or replace function public.finalize_checklist_shared_draft(
  p_draft_id uuid,
  p_employee_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  draft public.checklist_shared_drafts%rowtype;
  items_payload jsonb;
  finalized public.checklist_submissions%rowtype;
begin
  select * into draft
  from public.checklist_shared_drafts
  where id = p_draft_id
  for update;

  if draft.id is null or actor_id is null or not public.can_access_checklist_shared_department(draft.department) then
    raise exception 'Shared checklist draft is not accessible' using errcode = '42501';
  end if;
  if draft.status = 'submitted' then
    select * into finalized from public.checklist_submissions where id = draft.submission_id;
    return jsonb_build_object(
      'id', finalized.id,
      'submission_id', finalized.id,
      'status', 'submitted',
      'photo_count', finalized.photo_count,
      'percent', finalized.percent
    );
  end if;
  if nullif(btrim(coalesce(p_employee_name, draft.employee_name, '')), '') is null then
    raise exception 'Employee name is required' using errcode = '22023';
  end if;

  update public.checklist_shared_drafts
  set status = 'submitting',
      employee_name = left(btrim(coalesce(p_employee_name, draft.employee_name)), 200),
      updated_by = actor_id,
      updated_at = now(),
      version = version + 1
  where id = p_draft_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'itemKey', item.item_key,
    'text', item.item_text,
    'sectionTitle', item.section_title,
    'checkedByUser', item.checked_by_user,
    'checked', item.checked_by_user,
    'photoRequired', item.photo_required,
    'requiredPhotoCount', item.required_photo_count,
    'photoCount', coalesce(photo_counts.photo_count, 0)
  ) order by item.created_at, item.item_key), '[]'::jsonb)
  into items_payload
  from public.checklist_shared_draft_items item
  left join lateral (
    select count(*)::integer as photo_count
    from public.checklist_shared_draft_photos photo
    where photo.draft_id = item.draft_id
      and photo.item_key = item.item_key
      and photo.deleted_at is null
  ) photo_counts on true
  where item.draft_id = p_draft_id;

  insert into public.checklist_submissions (
    id, checklist_id, checklist_title, employee_id, employee_name, items,
    completed_count, total_count, percent, photo_required_count, photo_count,
    photo_upload_status, submitted_incomplete, version
  ) values (
    draft.submission_id, draft.checklist_id, draft.checklist_title, actor_id,
    left(btrim(coalesce(p_employee_name, draft.employee_name)), 200), items_payload,
    0, jsonb_array_length(items_payload), 0, 0, 0, 'pending', true, 5
  )
  on conflict (id) do nothing;

  insert into public.checklist_submission_photos (
    submission_id, checklist_id, item_key, item_text, photo_index,
    storage_path, thumbnail_path, mime_type, file_size, thumbnail_size, created_by
  )
  select
    draft.submission_id,
    draft.checklist_id,
    photo.item_key,
    item.item_text,
    photo.photo_index,
    photo.storage_path,
    photo.thumbnail_path,
    photo.mime_type,
    photo.file_size,
    photo.thumbnail_size,
    photo.created_by
  from public.checklist_shared_draft_photos photo
  join public.checklist_shared_draft_items item
    on item.draft_id = photo.draft_id and item.item_key = photo.item_key
  where photo.draft_id = p_draft_id and photo.deleted_at is null
  on conflict (submission_id, item_key, photo_index) do nothing;

  perform public.finalize_checklist_photo_submission(draft.submission_id, items_payload);

  update public.checklist_shared_drafts
  set status = 'submitted',
      submitted_by = actor_id,
      submitted_at = now(),
      updated_by = actor_id,
      updated_at = now(),
      version = version + 1
  where id = p_draft_id;

  select * into finalized
  from public.checklist_submissions
  where id = draft.submission_id;

  return jsonb_build_object(
    'id', finalized.id,
    'submission_id', finalized.id,
    'status', 'submitted',
    'photo_count', finalized.photo_count,
    'percent', finalized.percent,
    'completed_count', finalized.completed_count,
    'total_count', finalized.total_count
  );
exception when others then
  update public.checklist_shared_drafts
  set status = 'draft', updated_at = now()
  where id = p_draft_id and status = 'submitting';
  raise;
end;
$$;

commit;
