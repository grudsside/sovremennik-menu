-- STEP 10B: Finalize STEP 10 view privileges.
-- Apply immediately after STEP_10_HARDEN_RLS.sql in the same release.
-- Kept separate so the original reviewed migration remains append-only.

begin;

revoke all on table public.coffee_revision_report from authenticated;
grant select on table public.coffee_revision_report to authenticated;

commit;

select
  'step_10b_harden_rls_view_privileges_done' as status,
  c.reloptions as coffee_revision_report_options,
  c.relacl as coffee_revision_report_acl
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'coffee_revision_report'
  and c.relkind = 'v';
