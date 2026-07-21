-- Audited correction of existing coffee revisions.
-- The operational author and revision date remain immutable.

begin;

create table if not exists public.coffee_revision_edits (
  id bigint generated always as identity primary key,
  revision_date date not null,
  edited_by uuid not null references public.profiles(id),
  editor_name text not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  before_data jsonb not null,
  after_data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists coffee_revision_edits_revision_date_created_at_idx
  on public.coffee_revision_edits (revision_date, created_at desc);

alter table public.coffee_revision_edits enable row level security;

revoke all on table public.coffee_revision_edits from public, anon, authenticated;
grant select on table public.coffee_revision_edits to authenticated;

revoke all on sequence public.coffee_revision_edits_id_seq from public, anon, authenticated;

drop policy if exists "coffee_revision_edits_select_admin" on public.coffee_revision_edits;
create policy "coffee_revision_edits_select_admin"
on public.coffee_revision_edits
for select
to authenticated
using (public.is_admin());

create or replace function public.correct_coffee_revision(
  p_revision_date date,
  p_hopper_weight numeric,
  p_opened_packs integer,
  p_write_offs numeric,
  p_iiko_sales numeric,
  p_checked text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  previous_row public.coffee_revisions%rowtype;
  corrected_row public.coffee_revisions%rowtype;
begin
  if actor_id is null or not public.is_admin() then
    raise exception 'Admin profile required' using errcode = '42501';
  end if;

  select p.name
    into actor_name
  from public.profiles p
  where p.id = actor_id
    and p.is_active = true
    and p.role = 'admin';

  if actor_name is null then
    raise exception 'Active admin profile required' using errcode = '42501';
  end if;

  if p_revision_date is null then
    raise exception 'Revision date is required' using errcode = '23502';
  end if;

  if p_hopper_weight is null or p_hopper_weight < 0 then
    raise exception 'Hopper weight must be zero or greater' using errcode = '23514';
  end if;

  if p_opened_packs is null or p_opened_packs < 0 then
    raise exception 'Opened packs must be zero or greater' using errcode = '23514';
  end if;

  if p_write_offs is not null and p_write_offs < 0 then
    raise exception 'Write-offs must be zero or greater' using errcode = '23514';
  end if;

  if p_iiko_sales is not null and p_iiko_sales < 0 then
    raise exception 'iiko sales must be zero or greater' using errcode = '23514';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'Correction reason must contain between 3 and 500 characters' using errcode = '23514';
  end if;

  select *
    into previous_row
  from public.coffee_revisions
  where revision_date = p_revision_date
  for update;

  if not found then
    raise exception 'Coffee revision for % was not found', p_revision_date using errcode = 'P0002';
  end if;

  update public.coffee_revisions
  set hopper_weight = p_hopper_weight,
      opened_packs = p_opened_packs,
      write_offs = p_write_offs,
      iiko_sales = p_iiko_sales,
      checked = nullif(btrim(coalesce(p_checked, '')), '')
  where revision_date = p_revision_date
  returning * into corrected_row;

  insert into public.coffee_revision_edits (
    revision_date,
    edited_by,
    editor_name,
    reason,
    before_data,
    after_data
  ) values (
    p_revision_date,
    actor_id,
    actor_name,
    btrim(p_reason),
    to_jsonb(previous_row),
    to_jsonb(corrected_row)
  );

  return to_jsonb(corrected_row);
end;
$$;

revoke execute on function public.correct_coffee_revision(date, numeric, integer, numeric, numeric, text, text)
  from public, anon;
grant execute on function public.correct_coffee_revision(date, numeric, integer, numeric, numeric, text, text)
  to authenticated, service_role;

comment on table public.coffee_revision_edits is
  'Immutable audit history of administrator corrections to coffee revisions.';
comment on function public.correct_coffee_revision(date, numeric, integer, numeric, numeric, text, text) is
  'Corrects numeric/control values of an existing coffee revision without changing its date or original employee.';

commit;
