-- Track coffee grain deliveries and the calculated total stock at the end of each day.
-- A manual stock override is an end-of-day control point; later days continue from it.

begin;

alter table public.coffee_revisions
  add column if not exists grain_delivery numeric(10,3),
  add column if not exists stock_balance_override numeric(12,3);

alter table public.coffee_revisions
  drop constraint if exists coffee_revisions_grain_delivery_nonnegative,
  drop constraint if exists coffee_revisions_stock_balance_override_nonnegative;

alter table public.coffee_revisions
  add constraint coffee_revisions_grain_delivery_nonnegative
    check (grain_delivery is null or grain_delivery >= 0),
  add constraint coffee_revisions_stock_balance_override_nonnegative
    check (stock_balance_override is null or stock_balance_override >= 0);

-- Keep the existing view columns in their original order and append the new stock fields.
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
      when previous_clean_hopper_weight is null
        or opened_packs is null
        or clean_hopper_weight is null
      then null
      else round((previous_clean_hopper_weight + opened_packs::numeric - clean_hopper_weight)::numeric, 3)
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
      when stock_balance_override is not null then stock_balance_override::numeric(12,3)
      else null::numeric(12,3)
    end as total_grain_balance_calc
  from loss_calc
  where sequence_number = 1

  union all

  select
    current_row.*,
    case
      when current_row.stock_balance_override is not null
        then current_row.stock_balance_override::numeric(12,3)
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

-- Replace the previous correction RPC with a stock-aware version.
drop function if exists public.correct_coffee_revision(date, numeric, integer, numeric, numeric, text, text);

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

comment on column public.coffee_revisions.grain_delivery is
  'Coffee grain received on the revision date, in kilograms.';
comment on column public.coffee_revisions.stock_balance_override is
  'Manual end-of-day total grain stock used as a recalculation anchor.';
comment on view public.coffee_revision_report is
  'Coffee revision calculations including deliveries and total end-of-day grain stock.';
comment on function public.correct_coffee_revision(date, numeric, integer, numeric, numeric, text, numeric, numeric, text) is
  'Corrects an existing coffee revision, including delivery and optional end-of-day stock anchor, without changing date or original employee.';

commit;
