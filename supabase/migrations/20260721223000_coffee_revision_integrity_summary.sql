-- Prevent accidental overwrites, support opening balance anchors and restore confirmed July data.
-- The summary calculation is implemented in the frontend; this migration protects and repairs its source data.

begin;

alter table public.coffee_revisions
  add column if not exists opening_clean_hopper_weight numeric(10,3),
  add column if not exists opening_total_grain_balance numeric(12,3);

alter table public.coffee_revisions
  drop constraint if exists coffee_revisions_opening_clean_hopper_nonnegative,
  drop constraint if exists coffee_revisions_opening_total_grain_nonnegative;

alter table public.coffee_revisions
  add constraint coffee_revisions_opening_clean_hopper_nonnegative
    check (opening_clean_hopper_weight is null or opening_clean_hopper_weight >= 0),
  add constraint coffee_revisions_opening_total_grain_nonnegative
    check (opening_total_grain_balance is null or opening_total_grain_balance >= 0);

-- Opening anchors override the previous row when a confirmed start-of-day balance is available.
-- Existing report columns and their order remain unchanged.
create or replace view public.coffee_revision_report as
with recursive base as (
  select
    row_number() over (order by cr.revision_date) as sequence_number,
    cr.*,
    (
      case
        when cr.hopper_weight is null then null
        else greatest(cr.hopper_weight - 0.847, 0)
      end
    )::numeric(10,3) as clean_hopper_weight,
    lag(
      (
        case
          when cr.hopper_weight is null then null
          else greatest(cr.hopper_weight - 0.847, 0)
        end
      )::numeric(10,3)
    ) over (order by cr.revision_date) as previous_clean_hopper_weight
  from public.coffee_revisions cr
), usage_calc as (
  select
    base.*,
    case
      when coalesce(opening_clean_hopper_weight, previous_clean_hopper_weight) is null
        or opened_packs is null
        or clean_hopper_weight is null
      then null
      else round((
        coalesce(opening_clean_hopper_weight, previous_clean_hopper_weight)
        + opened_packs::numeric
        - clean_hopper_weight
      )::numeric, 3)
    end as total_coffee_usage_calc
  from base
), difference_calc as (
  select
    usage_calc.*,
    case
      when total_coffee_usage_calc is null or write_offs is null or iiko_sales is null then null
      else round((iiko_sales - write_offs - total_coffee_usage_calc)::numeric, 3)
    end as difference_calc
  from usage_calc
), loss_calc as (
  select
    difference_calc.*,
    case
      when difference_calc is null or write_offs is null then null
      else round((write_offs + greatest(-difference_calc, 0))::numeric, 3)
    end as total_loss_weight_calc
  from difference_calc
), stock_calc as (
  select
    loss_calc.*,
    case
      when stock_balance_override is not null
        then stock_balance_override::numeric(12,3)
      when opening_total_grain_balance is null or total_coffee_usage_calc is null
        then null::numeric(12,3)
      else round((
        opening_total_grain_balance
        + coalesce(grain_delivery, 0)
        - total_coffee_usage_calc
      )::numeric, 3)::numeric(12,3)
    end as total_grain_balance_calc
  from loss_calc
  where sequence_number = 1

  union all

  select
    current_row.*,
    case
      when current_row.stock_balance_override is not null
        then current_row.stock_balance_override::numeric(12,3)
      when current_row.opening_total_grain_balance is not null
        and current_row.total_coffee_usage_calc is not null
        then round((
          current_row.opening_total_grain_balance
          + coalesce(current_row.grain_delivery, 0)
          - current_row.total_coffee_usage_calc
        )::numeric, 3)::numeric(12,3)
      when previous_row.total_grain_balance_calc is null
        or current_row.total_coffee_usage_calc is null
        then null::numeric(12,3)
      else round((
        previous_row.total_grain_balance_calc
        + coalesce(current_row.grain_delivery, 0)
        - current_row.total_coffee_usage_calc
      )::numeric, 3)::numeric(12,3)
    end as total_grain_balance_calc
  from stock_calc previous_row
  join loss_calc current_row
    on current_row.sequence_number = previous_row.sequence_number + 1
)
select
  revision_date,
  employee_id,
  employee_name,
  hopper_weight,
  opened_packs,
  write_offs,
  iiko_sales,
  checked,
  clean_hopper_weight,
  total_coffee_usage_calc as total_coffee_usage,
  difference_calc as difference,
  case
    when total_loss_weight_calc is null or iiko_sales is null or iiko_sales <= 0 then null
    else round((total_loss_weight_calc / iiko_sales * 100)::numeric, 2)
  end as losses_percent,
  created_at,
  updated_at,
  total_loss_weight_calc as total_loss_weight,
  grain_delivery,
  stock_balance_override,
  total_grain_balance_calc as total_grain_balance
from stock_calc
order by revision_date;

alter view public.coffee_revision_report set (security_invoker = true);
revoke all on table public.coffee_revision_report from public, anon;
grant select on table public.coffee_revision_report to authenticated, service_role;

-- A normal client may submit a date once. Operational fields then become immutable.
-- Admin/manager may still enter write-offs, iiko sales and the checking note directly.
-- Full changes are available only through the audited administrator RPC below.
create or replace function public.enforce_coffee_revision_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  actor_role text;
  correction_mode boolean :=
    coalesce(current_setting('app.coffee_revision_admin_correction', true), '') = 'on';
begin
  -- Management/service operations do not carry an end-user uid.
  if actor_id is null then
    return new;
  end if;

  select p.name, p.role
    into actor_name, actor_role
  from public.profiles p
  where p.id = actor_id
    and p.is_active = true;

  if actor_role is null then
    raise exception 'Active profile required' using errcode = '42501';
  end if;

  if actor_role not in ('admin', 'manager', 'barista') then
    raise exception 'Revision access denied' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.employee_id := actor_id;
    new.employee_name := actor_name;

    if actor_role = 'barista'
      and (
        new.write_offs is not null
        or new.iiko_sales is not null
        or nullif(btrim(coalesce(new.checked, '')), '') is not null
        or new.grain_delivery is not null
        or new.stock_balance_override is not null
        or new.opening_clean_hopper_weight is not null
        or new.opening_total_grain_balance is not null
      )
    then
      raise exception 'Barista may submit operational revision fields only'
        using errcode = '42501';
    end if;

    if actor_role in ('admin', 'manager')
      and new.hopper_weight is null
      and new.opened_packs is null
      and (
        new.write_offs is not null
        or new.iiko_sales is not null
        or nullif(btrim(coalesce(new.checked, '')), '') is not null
      )
    then
      raise exception 'Submit operational revision before control values'
        using errcode = '23514';
    end if;

    return new;
  end if;

  new.revision_date := old.revision_date;
  new.employee_id := old.employee_id;
  new.employee_name := old.employee_name;

  if correction_mode then
    if actor_role <> 'admin' then
      raise exception 'Administrator correction mode required' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.hopper_weight is distinct from old.hopper_weight
     or new.opened_packs is distinct from old.opened_packs
     or new.grain_delivery is distinct from old.grain_delivery
     or new.stock_balance_override is distinct from old.stock_balance_override
     or new.opening_clean_hopper_weight is distinct from old.opening_clean_hopper_weight
     or new.opening_total_grain_balance is distinct from old.opening_total_grain_balance
  then
    raise exception 'Revision already submitted; use protected administrator correction'
      using errcode = '23505';
  end if;

  if actor_role = 'barista'
     and (
       new.write_offs is distinct from old.write_offs
       or new.iiko_sales is distinct from old.iiko_sales
       or new.checked is distinct from old.checked
     )
  then
    raise exception 'Barista cannot change a submitted revision'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_coffee_revision_write() from public, anon, authenticated;

drop trigger if exists enforce_coffee_revision_write on public.coffee_revisions;
create trigger enforce_coffee_revision_write
before insert or update on public.coffee_revisions
for each row execute function public.enforce_coffee_revision_write();

drop function if exists public.correct_coffee_revision(date, numeric, integer, numeric, numeric, text, numeric, numeric, text);

create or replace function public.correct_coffee_revision(
  p_revision_date date,
  p_hopper_weight numeric,
  p_opened_packs integer,
  p_write_offs numeric,
  p_iiko_sales numeric,
  p_checked text,
  p_grain_delivery numeric,
  p_stock_balance_override numeric,
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
  if p_grain_delivery is not null and p_grain_delivery < 0 then
    raise exception 'Grain delivery must be zero or greater' using errcode = '23514';
  end if;
  if p_stock_balance_override is not null and p_stock_balance_override < 0 then
    raise exception 'Stock balance override must be zero or greater' using errcode = '23514';
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

  perform set_config('app.coffee_revision_admin_correction', 'on', true);

  update public.coffee_revisions
  set hopper_weight = p_hopper_weight,
      opened_packs = p_opened_packs,
      write_offs = p_write_offs,
      iiko_sales = p_iiko_sales,
      checked = nullif(btrim(coalesce(p_checked, '')), ''),
      grain_delivery = p_grain_delivery,
      stock_balance_override = p_stock_balance_override
  where revision_date = p_revision_date
  returning * into corrected_row;

  perform set_config('app.coffee_revision_admin_correction', 'off', true);

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

revoke execute on function public.correct_coffee_revision(date, numeric, integer, numeric, numeric, text, numeric, numeric, text)
  from public, anon;
grant execute on function public.correct_coffee_revision(date, numeric, integer, numeric, numeric, text, numeric, numeric, text)
  to authenticated;

-- Restore the values confirmed by the owner from the operational spreadsheet.
-- On clean preview databases the rows do not exist and this block intentionally does nothing.
do $repair$
declare
  target record;
  previous_row public.coffee_revisions%rowtype;
  corrected_row public.coffee_revisions%rowtype;
  gleb_id uuid;
  dima_id uuid;
begin
  select p.id
    into gleb_id
  from public.profiles p
  where p.name ~* '(^|[[:space:]])глеб([[:space:]]|$)'
  order by p.is_active desc, p.id
  limit 1;

  select p.id
    into dima_id
  from public.profiles p
  where p.name ~* '(^|[[:space:]])(дима|дмитрий)([[:space:]]|$)'
  order by p.is_active desc, p.id
  limit 1;

  for target in
    select *
    from (values
      (
        date '2026-07-13', 'Глеб'::text, gleb_id,
        1.194::numeric, 4::integer, 0.504::numeric, 4.200::numeric,
        0.235::numeric, 60.235::numeric
      ),
      (
        date '2026-07-14', 'Дима'::text, dima_id,
        1.613::numeric, 4::integer, 0.198::numeric, 3.330::numeric,
        null::numeric, null::numeric
      ),
      (
        date '2026-07-15', 'Глеб'::text, gleb_id,
        1.392::numeric, 3::integer, 0.118::numeric, 3.528::numeric,
        null::numeric, null::numeric
      )
    ) as values_to_restore(
      revision_date,
      employee_name,
      employee_id,
      hopper_weight,
      opened_packs,
      write_offs,
      iiko_sales,
      opening_clean_hopper_weight,
      opening_total_grain_balance
    )
  loop
    select *
      into previous_row
    from public.coffee_revisions
    where revision_date = target.revision_date
    for update;

    if not found then
      continue;
    end if;

    if previous_row.employee_name is not distinct from target.employee_name
       and previous_row.employee_id is not distinct from coalesce(target.employee_id, previous_row.employee_id)
       and previous_row.hopper_weight is not distinct from target.hopper_weight
       and previous_row.opened_packs is not distinct from target.opened_packs
       and previous_row.write_offs is not distinct from target.write_offs
       and previous_row.iiko_sales is not distinct from target.iiko_sales
       and previous_row.checked is null
       and previous_row.grain_delivery is null
       and previous_row.stock_balance_override is null
       and previous_row.opening_clean_hopper_weight is not distinct from target.opening_clean_hopper_weight
       and previous_row.opening_total_grain_balance is not distinct from target.opening_total_grain_balance
    then
      continue;
    end if;

    update public.coffee_revisions
    set employee_id = coalesce(target.employee_id, employee_id),
        employee_name = target.employee_name,
        hopper_weight = target.hopper_weight,
        opened_packs = target.opened_packs,
        write_offs = target.write_offs,
        iiko_sales = target.iiko_sales,
        checked = null,
        grain_delivery = null,
        stock_balance_override = null,
        opening_clean_hopper_weight = target.opening_clean_hopper_weight,
        opening_total_grain_balance = target.opening_total_grain_balance
    where revision_date = target.revision_date
    returning * into corrected_row;

    insert into public.coffee_revision_edits (
      revision_date,
      edited_by,
      editor_name,
      reason,
      before_data,
      after_data
    ) values (
      target.revision_date,
      null,
      'Системное исправление',
      'Восстановление подтверждённых данных из рабочей таблицы за 13–15.07.2026',
      to_jsonb(previous_row),
      to_jsonb(corrected_row)
    );
  end loop;
end;
$repair$;

comment on column public.coffee_revisions.opening_clean_hopper_weight is
  'Confirmed clean hopper weight before this revision; when present it overrides the previous row for usage calculation.';
comment on column public.coffee_revisions.opening_total_grain_balance is
  'Confirmed total grain balance before this revision; when present it starts a new stock calculation anchor.';
comment on function public.enforce_coffee_revision_write() is
  'Prevents client overwrites of submitted operational revision values; full edits require the audited administrator RPC.';
comment on view public.coffee_revision_report is
  'Coffee revision calculations with opening anchors, write-offs included in losses and rolling total grain stock.';

commit;
