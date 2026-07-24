-- Admin checklist template editor with validation, optimistic locking and immutable audit history.
begin;

create table if not exists public.checklist_template_overrides (
  checklist_id text primary key,
  title text not null,
  description text not null default '',
  sections jsonb not null,
  version integer not null default 1,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(btrim(checklist_id)) between 1 and 120),
  check (length(btrim(title)) between 1 and 160),
  check (length(description) <= 2000),
  check (jsonb_typeof(sections) = 'array'),
  check (version >= 1)
);

create table if not exists public.checklist_template_edits (
  id uuid primary key default gen_random_uuid(),
  checklist_id text not null,
  action text not null check (action in ('save','reset')),
  version integer not null check (version >= 1),
  before_data jsonb,
  after_data jsonb,
  edited_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists checklist_template_edits_lookup_idx
  on public.checklist_template_edits(checklist_id, created_at desc);

alter table public.checklist_template_overrides enable row level security;
alter table public.checklist_template_edits enable row level security;

drop trigger if exists touch_checklist_template_overrides_updated_at on public.checklist_template_overrides;
create trigger touch_checklist_template_overrides_updated_at
before update on public.checklist_template_overrides
for each row execute function public.touch_updated_at();

create or replace function public.normalize_checklist_template_sections(
  p_checklist_id text,
  p_sections jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  normalized jsonb := '[]'::jsonb;
  normalized_rows jsonb;
  section_row record;
  item_row record;
  section_title text;
  section_type text;
  item_task text;
  item_key text;
  item_responsible text;
  item_min text;
  seen_keys text[] := array[]::text[];
  section_count integer := 0;
  item_count integer := 0;
begin
  if nullif(btrim(coalesce(p_checklist_id, '')), '') is null then
    raise exception 'Checklist id is required' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_sections, 'null'::jsonb)) <> 'array' then
    raise exception 'Checklist sections must be an array' using errcode = '22023';
  end if;

  section_count := jsonb_array_length(p_sections);
  if section_count < 1 or section_count > 30 then
    raise exception 'Checklist must contain between 1 and 30 sections' using errcode = '22023';
  end if;

  for section_row in
    select value, ordinality
    from jsonb_array_elements(p_sections) with ordinality
  loop
    section_title := btrim(coalesce(section_row.value->>'title', ''));
    if length(section_title) < 1 or length(section_title) > 160 then
      raise exception 'Invalid checklist section title at position %', section_row.ordinality using errcode = '22023';
    end if;
    if jsonb_typeof(coalesce(section_row.value->'rows', 'null'::jsonb)) <> 'array' then
      raise exception 'Checklist section rows must be an array at position %', section_row.ordinality using errcode = '22023';
    end if;
    if jsonb_array_length(section_row.value->'rows') < 1 or jsonb_array_length(section_row.value->'rows') > 100 then
      raise exception 'Checklist section must contain between 1 and 100 rows at position %', section_row.ordinality using errcode = '22023';
    end if;

    normalized_rows := '[]'::jsonb;
    for item_row in
      select value, ordinality
      from jsonb_array_elements(section_row.value->'rows') with ordinality
    loop
      item_count := item_count + 1;
      if item_count > 300 then
        raise exception 'Checklist may contain no more than 300 rows' using errcode = '22023';
      end if;
      item_task := btrim(coalesce(item_row.value->>'task', item_row.value->>'text', item_row.value->>'label', ''));
      if length(item_task) < 1 or length(item_task) > 500 then
        raise exception 'Invalid checklist row text in section %, row %', section_row.ordinality, item_row.ordinality using errcode = '22023';
      end if;
      item_key := btrim(coalesce(
        item_row.value->>'itemKey',
        item_row.value->>'item_key',
        p_checklist_id || ':' || (section_row.ordinality - 1)::text || ':' || (item_row.ordinality - 1)::text
      ));
      if length(item_key) < 1 or length(item_key) > 180 or item_key = any(seen_keys) then
        raise exception 'Invalid or duplicate checklist item key in section %, row %', section_row.ordinality, item_row.ordinality using errcode = '22023';
      end if;
      seen_keys := array_append(seen_keys, item_key);
      item_responsible := btrim(coalesce(item_row.value->>'responsible', ''));
      item_min := btrim(coalesce(item_row.value->>'min', ''));
      if length(item_responsible) > 160 or length(item_min) > 160 then
        raise exception 'Checklist row metadata is too long in section %, row %', section_row.ordinality, item_row.ordinality using errcode = '22023';
      end if;

      normalized_rows := normalized_rows || jsonb_build_array(
        jsonb_strip_nulls(jsonb_build_object(
          'itemKey', item_key,
          'task', item_task,
          'responsible', nullif(item_responsible, ''),
          'min', nullif(item_min, '')
        ))
      );
    end loop;

    section_type := case when section_row.value->>'type' = 'minlist' then 'minlist' else null end;
    normalized := normalized || jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object(
        'title', section_title,
        'type', section_type,
        'rows', normalized_rows
      ))
    );
  end loop;

  return normalized;
end;
$$;

create or replace function public.save_checklist_template_override(
  p_checklist_id text,
  p_title text,
  p_description text,
  p_sections jsonb,
  p_expected_version integer default 0
)
returns setof public.checklist_template_overrides
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  current_row public.checklist_template_overrides%rowtype;
  normalized_sections jsonb;
  next_version integer;
  before_snapshot jsonb;
begin
  if actor_id is null or not public.is_admin() then
    raise exception 'Administrator profile required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_checklist_id, '')), '') is null or length(btrim(p_checklist_id)) > 120 then
    raise exception 'Invalid checklist id' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_title, ''))) < 1 or length(btrim(p_title)) > 160 then
    raise exception 'Checklist title must contain between 1 and 160 characters' using errcode = '22023';
  end if;
  if length(coalesce(p_description, '')) > 2000 then
    raise exception 'Checklist description is too long' using errcode = '22023';
  end if;

  normalized_sections := public.normalize_checklist_template_sections(p_checklist_id, p_sections);

  select * into current_row
  from public.checklist_template_overrides
  where checklist_id = p_checklist_id
  for update;

  if current_row.checklist_id is null then
    if coalesce(p_expected_version, 0) <> 0 then
      raise exception 'Checklist template was changed by another administrator' using errcode = '40001';
    end if;
    next_version := 1;
    before_snapshot := null;
  else
    if coalesce(p_expected_version, 0) <> current_row.version then
      raise exception 'Checklist template was changed by another administrator' using errcode = '40001';
    end if;
    next_version := current_row.version + 1;
    before_snapshot := to_jsonb(current_row) - 'updated_by';
  end if;

  insert into public.checklist_template_overrides (
    checklist_id, title, description, sections, version, updated_by
  ) values (
    btrim(p_checklist_id), btrim(p_title), btrim(coalesce(p_description, '')), normalized_sections, next_version, actor_id
  )
  on conflict (checklist_id) do update set
    title = excluded.title,
    description = excluded.description,
    sections = excluded.sections,
    version = excluded.version,
    updated_by = excluded.updated_by;

  insert into public.checklist_template_edits (
    checklist_id, action, version, before_data, after_data, edited_by
  )
  select
    row.checklist_id,
    'save',
    row.version,
    before_snapshot,
    to_jsonb(row) - 'updated_by',
    actor_id
  from public.checklist_template_overrides row
  where row.checklist_id = p_checklist_id;

  update public.checklist_photo_rules rule
  set item_text = item_value->>'task',
      updated_by = actor_id
  from jsonb_array_elements(normalized_sections) section_value,
       jsonb_array_elements(section_value->'rows') item_value
  where rule.checklist_id = p_checklist_id
    and rule.item_key = item_value->>'itemKey'
    and rule.item_text is distinct from item_value->>'task';

  delete from public.checklist_photo_rules rule
  where rule.checklist_id = p_checklist_id
    and not exists (
      select 1
      from jsonb_array_elements(normalized_sections) section_value,
           jsonb_array_elements(section_value->'rows') item_value
      where item_value->>'itemKey' = rule.item_key
    );

  return query
  select * from public.checklist_template_overrides
  where checklist_id = p_checklist_id;
end;
$$;

create or replace function public.reset_checklist_template_override(
  p_checklist_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  current_row public.checklist_template_overrides%rowtype;
begin
  if actor_id is null or not public.is_admin() then
    raise exception 'Administrator profile required' using errcode = '42501';
  end if;

  select * into current_row
  from public.checklist_template_overrides
  where checklist_id = p_checklist_id
  for update;

  if current_row.checklist_id is null then return false; end if;

  insert into public.checklist_template_edits (
    checklist_id, action, version, before_data, after_data, edited_by
  ) values (
    current_row.checklist_id,
    'reset',
    current_row.version + 1,
    to_jsonb(current_row) - 'updated_by',
    null,
    actor_id
  );

  delete from public.checklist_template_overrides where checklist_id = p_checklist_id;
  return true;
end;
$$;

revoke all on table public.checklist_template_overrides from public, anon, authenticated;
revoke all on table public.checklist_template_edits from public, anon, authenticated;
grant select on table public.checklist_template_overrides to authenticated;
grant select on table public.checklist_template_edits to authenticated;

revoke execute on function public.normalize_checklist_template_sections(text, jsonb) from public, anon, authenticated;
revoke execute on function public.save_checklist_template_override(text, text, text, jsonb, integer) from public, anon;
revoke execute on function public.reset_checklist_template_override(text) from public, anon;
grant execute on function public.save_checklist_template_override(text, text, text, jsonb, integer) to authenticated, service_role;
grant execute on function public.reset_checklist_template_override(text) to authenticated, service_role;

drop policy if exists "checklist_template_overrides_select_active" on public.checklist_template_overrides;
create policy "checklist_template_overrides_select_active"
on public.checklist_template_overrides
for select
to authenticated
using (public.is_active_user());

drop policy if exists "checklist_template_edits_select_admin" on public.checklist_template_edits;
create policy "checklist_template_edits_select_admin"
on public.checklist_template_edits
for select
to authenticated
using (public.is_admin());

commit;
