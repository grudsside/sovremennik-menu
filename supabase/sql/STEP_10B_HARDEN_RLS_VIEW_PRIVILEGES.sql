-- STEP 10B: Finalize STEP 10 task updates and view privileges.
-- Apply immediately after STEP_10_HARDEN_RLS.sql in the same release.
-- Kept separate so the original reviewed migration remains append-only.

begin;

-- An assignee may complete their task. A manager may also complete a task they
-- created or were assigned. Admin retains global status access. Other creators
-- may read their created tasks but cannot complete work assigned to someone else.
drop policy if exists "tasks_update_status_participant" on public.tasks;

create policy "tasks_update_status_authorized"
on public.tasks
for update
to authenticated
using (
  public.is_active_user()
  and (
    public.is_admin()
    or assignee_id = auth.uid()
    or (
      public.current_role() = 'manager'
      and creator_id = auth.uid()
    )
  )
)
with check (
  public.is_active_user()
  and (
    public.is_admin()
    or (
      (
        assignee_id = auth.uid()
        or (
          public.current_role() = 'manager'
          and creator_id = auth.uid()
        )
      )
      and status in ('open', 'done')
      and (
        (status = 'open' and completed_at is null)
        or (status = 'done' and completed_at is not null)
      )
    )
  )
);

revoke all on table public.coffee_revision_report from authenticated;
grant select on table public.coffee_revision_report to authenticated;

commit;

select
  'step_10b_harden_rls_finalized' as status,
  c.reloptions as coffee_revision_report_options,
  c.relacl as coffee_revision_report_acl
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'coffee_revision_report'
  and c.relkind = 'v';
