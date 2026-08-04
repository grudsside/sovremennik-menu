-- Shared checklist drafts: multi-device field sync, Realtime and one-shot finalization.
begin;

create table if not exists public.checklist_shared_drafts (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null default gen_random_uuid() unique,
  checklist_id text not null,
  checklist_title text not null,
  department text not null check (department in ('barista','waiter')),
  work_date date not null,
  employee_name text not null default '',
  status text not null default 'draft' check (status in ('draft','submitting','submitted')),
  version bigint not null default 1 check (version >= 1),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  submitted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  unique (checklist_id, department, work_date),
  check (length(btrim(checklist_id)) > 0),
  check (length(btrim(checklist_title)) > 0),
  check (length(employee_name) <= 200)
);

create table if not exists public.checklist_shared_draft_items (
  draft_id uuid not null references public.checklist_shared_drafts(id) on delete cascade,
  item_key text not null,
  item_text text not null,
  section_title text not null default '',
  checked_by_user boolean not null default false,
  photo_required boolean not null default false,
  required_photo_count smallint not null default 0 check (required_photo_count between 0 and 3),
  version bigint not null default 1 check (version >= 1),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (draft_id, item_key),
  check (length(btrim(item_key)) > 0),
  check (length(btrim(item_text)) > 0),
  check ((photo_required and required_photo_count > 0) or (not photo_required and required_photo_count = 0))
);

create table if not exists public.checklist_shared_draft_photos (
  id uuid primary key,
  draft_id uuid not null references public.checklist_shared_drafts(id) on delete cascade,
  item_key text not null,
  photo_index smallint not null check (photo_index between 1 and 3),
  storage_path text not null unique,
  thumbnail_path text not null unique,
  mime_type text not null default 'image/jpeg' check (mime_type in ('image/jpeg','image/webp')),
  file_size integer not null check (file_size between 1 and 3145728),
  thumbnail_size integer not null check (thumbnail_size between 1 and 1048576),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  foreign key (draft_id, item_key)
    references public.checklist_shared_draft_items(draft_id, item_key)
    on delete cascade
);

create index if not exists checklist_shared_drafts_lookup_idx
  on public.checklist_shared_drafts(work_date, department, checklist_id, status);
create index if not exists checklist_shared_draft_items_updated_idx
  on public.checklist_shared_draft_items(draft_id, updated_at desc);
create unique index if not exists checklist_shared_draft_photos_active_idx
  on public.checklist_shared_draft_photos(draft_id, item_key, photo_index)
  where deleted_at is null;

alter table public.checklist_shared_drafts enable row level security;
alter table public.checklist_shared_draft_items enable row level security;
alter table public.checklist_shared_draft_photos enable row level security;

create or replace function public.can_access_checklist_shared_department(p_department text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case
      when role in ('admin','manager') then p_department in ('barista','waiter')
      when role = 'barista' then p_department = 'barista'
      when role = 'waiter' then p_department = 'waiter'
      else false
    end
    from public.profiles
    where id = auth.uid() and is_active = true),
    false
  );
$$;

revoke execute on function public.can_access_checklist_shared_department(text) from public, anon;
grant execute on function public.can_access_checklist_shared_department(text) to authenticated, service_role;

create or replace function public.checklist_shared_draft_payload(p_draft_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', draft.id,
    'submissionId', draft.submission_id,
    'checklistId', draft.checklist_id,
    'checklistTitle', draft.checklist_title,
    'department', draft.department,
    'workDate', draft.work_date,
    'employeeName', draft.employee_name,
    'status', draft.status,
    'version', draft.version,
    'createdAt', draft.created_at,
    'updatedAt', draft.updated_at,
    'submittedAt', draft.submitted_at,
    'submittedBy', draft.submitted_by,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'itemKey', item.item_key,
        'text', item.item_text,
        'sectionTitle', item.section_title,
        'checkedByUser', item.checked_by_user,
        'photoRequired', item.photo_required,
        'requiredPhotoCount', item.required_photo_count,
        'photoCount', coalesce(photo_counts.photo_count, 0),
        'version', item.version,
        'updatedAt', item.updated_at,
        'updatedBy', item.updated_by,
        'updatedByName', item.updated_by_name
      ) order by item.created_at, item.item_key)
      from public.checklist_shared_draft_items item
      left join lateral (
        select count(*)::integer as photo_count
        from public.checklist_shared_draft_photos photo
        where photo.draft_id = item.draft_id
          and photo.item_key = item.item_key
          and photo.deleted_at is null
      ) photo_counts on true
      where item.draft_id = draft.id
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', photo.id,
        'itemKey', photo.item_key,
        'index', photo.photo_index,
        'storagePath', photo.storage_path,
        'thumbnailPath', photo.thumbnail_path,
        'mimeType', photo.mime_type,
        'fileSize', photo.file_size,
        'thumbnailSize', photo.thumbnail_size,
        'createdBy', photo.created_by,
        'createdByName', photo.created_by_name,
        'createdAt', photo.created_at
      ) order by photo.item_key, photo.photo_index)
      from public.checklist_shared_draft_photos photo
      where photo.draft_id = draft.id
        and photo.deleted_at is null
    ), '[]'::jsonb)
  )
  from public.checklist_shared_drafts draft
  where draft.id = p_draft_id
    and public.can_access_checklist_shared_department(draft.department);
$$;

revoke execute on function public.checklist_shared_draft_payload(uuid) from public, anon;
grant execute on function public.checklist_shared_draft_payload(uuid) to authenticated, service_role;

create or replace function public.open_checklist_shared_draft(
  p_checklist_id text,
  p_checklist_title text,
  p_department text,
  p_work_date date,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  draft_id_value uuid;
  normalized_date date := coalesce(p_work_date, current_date);
  item jsonb;
  item_key_value text;
  item_text_value text;
  section_value text;
  required_count integer;
begin
  if actor_id is null or not public.can_access_checklist_shared_department(p_department) then
    raise exception 'Active profile with checklist access required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_checklist_id, '')), '') is null
     or nullif(btrim(coalesce(p_checklist_title, '')), '') is null then
    raise exception 'Checklist id and title are required' using errcode = '22023';
  end if;
  if p_department not in ('barista','waiter') then
    raise exception 'Unsupported checklist department' using errcode = '22023';
  end if;
  if normalized_date < current_date - 1 or normalized_date > current_date + 1 then
    raise exception 'Shared checklist date is outside the allowed window' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Checklist items must be a JSON array' using errcode = '22023';
  end if;

  select name into actor_name
  from public.profiles
  where id = actor_id and is_active = true;

  insert into public.checklist_shared_drafts (
    checklist_id, checklist_title, department, work_date, created_by, updated_by
  ) values (
    btrim(p_checklist_id), btrim(p_checklist_title), p_department, normalized_date, actor_id, actor_id
  )
  on conflict (checklist_id, department, work_date) do update
    set checklist_title = excluded.checklist_title,
        updated_at = case
          when public.checklist_shared_drafts.status = 'draft' then now()
          else public.checklist_shared_drafts.updated_at
        end
  returning id into draft_id_value;

  for item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    item_key_value := btrim(coalesce(item->>'itemKey', item->>'item_key', ''));
    item_text_value := btrim(coalesce(item->>'text', item->>'task', item->>'label', ''));
    section_value := btrim(coalesce(item->>'sectionTitle', item->>'section_title', ''));
    required_count := greatest(0, least(3, coalesce(
      nullif(item->>'requiredPhotoCount', '')::integer,
      nullif(item->>'required_photo_count', '')::integer,
      0
    )));
    if item_key_value = '' or item_text_value = '' then
      raise exception 'Every checklist item requires itemKey and text' using errcode = '22023';
    end if;

    insert into public.checklist_shared_draft_items (
      draft_id, item_key, item_text, section_title, photo_required,
      required_photo_count, updated_by, updated_by_name
    ) values (
      draft_id_value, item_key_value, item_text_value, section_value, required_count > 0,
      required_count, actor_id, coalesce(actor_name, '')
    )
    on conflict (draft_id, item_key) do update
      set item_text = excluded.item_text,
          section_title = excluded.section_title,
          photo_required = excluded.photo_required,
          required_photo_count = excluded.required_photo_count
      where public.checklist_shared_draft_items.draft_id = draft_id_value;
  end loop;

  return public.checklist_shared_draft_payload(draft_id_value);
end;
$$;

create or replace function public.patch_checklist_shared_draft(
  p_draft_id uuid,
  p_employee_name text default null,
  p_changes jsonb default '[]'::jsonb
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
  change jsonb;
  key_value text;
  checked_value boolean;
  changed_count integer := 0;
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
  if jsonb_typeof(coalesce(p_changes, '[]'::jsonb)) <> 'array' then
    raise exception 'Checklist changes must be a JSON array' using errcode = '22023';
  end if;

  select name into actor_name
  from public.profiles
  where id = actor_id and is_active = true;

  if p_employee_name is not null then
    update public.checklist_shared_drafts
    set employee_name = left(btrim(p_employee_name), 200),
        updated_by = actor_id,
        updated_at = now(),
        version = version + 1
    where id = p_draft_id;
    changed_count := changed_count + 1;
  end if;

  for change in select value from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb))
  loop
    key_value := btrim(coalesce(change->>'itemKey', change->>'item_key', ''));
    if key_value = '' or not (change ? 'checkedByUser' or change ? 'checked_by_user' or change ? 'checked') then
      raise exception 'Each change requires itemKey and checkedByUser' using errcode = '22023';
    end if;
    checked_value := lower(coalesce(
      change->>'checkedByUser', change->>'checked_by_user', change->>'checked', 'false'
    )) in ('true','1','yes','да');

    update public.checklist_shared_draft_items
    set checked_by_user = checked_value,
        updated_by = actor_id,
        updated_by_name = coalesce(actor_name, ''),
        updated_at = now(),
        version = version + 1
    where draft_id = p_draft_id and item_key = key_value;
    if not found then
      raise exception 'Checklist item does not exist in shared draft' using errcode = 'P0002';
    end if;
    changed_count := changed_count + 1;
  end loop;

  if changed_count > 0 and p_employee_name is null then
    update public.checklist_shared_drafts
    set updated_by = actor_id,
        updated_at = now(),
        version = version + 1
    where id = p_draft_id;
  end if;

  return public.checklist_shared_draft_payload(p_draft_id);
end;
$$;

commit;
