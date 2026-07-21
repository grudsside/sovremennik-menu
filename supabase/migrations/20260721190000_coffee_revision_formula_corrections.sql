-- Correct coffee revision business formulas.
-- Write-offs are losses; a negative discrepancy adds unaccounted loss.

begin;

create or replace view public.coffee_revision_report as
with base as (
  select
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
  total_loss_weight_calc as total_loss_weight
from loss_calc
order by revision_date;

alter view public.coffee_revision_report set (security_invoker = true);
revoke all on table public.coffee_revision_report from public, anon;
grant select on table public.coffee_revision_report to authenticated, service_role;

comment on view public.coffee_revision_report is
  'Coffee revision calculations: write-offs plus negative unaccounted discrepancy are total losses.';

commit;
