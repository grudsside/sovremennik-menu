-- Checklist review tools preview: comments-to-tasks, admin deletion and audit metadata.
begin;

alter table public.checklist_submissions
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists deletion_reason text;

create index if not exists checklist_submissions_active_created_idx
  on public.checklist_submissions(created_at desc)
  where deleted_at is null;

create table if not exists public.checklist_submission_comments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.checklist_submissions(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  author_name text not null,
  assignee_id uuid not null references public.profiles(id) on delete restrict,
  assignee_name text not null,
  body text not null,
  task_id uuid references public.tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  check (length(btrim(author_name)) > 0),
  check (length(btrim(assignee_name)) > 0),
  check (length(btrim(body)) between 1 and 2000)
);

create index if not exists checklist_submission_comments_submission_idx
  on public.checklist_submission_comments(submission_id, created_at);
create index if not exists checklist_submission_comments_assignee_idx
  on public.checklist_submission_comments(assignee_id, created_at desc);

alter table public.checklist_submission_comments enable row level security;

create or replace function public.create_checklist_submission_comment(
  p_submission_id uuid,
  p_assignee_id uuid,
  p_body text
)
returns setof public.checklist_submission_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  assignee_name_value text;
  submission public.checklist_submissions%rowtype;
  normalized_body text := btrim(coalesce(p_body, ''));
  created_task_id uuid := gen_random_uuid();
  created_comment_id uuid := gen_random_uuid();
  task_title text;
  task_description text;
begin
  if actor_id is null or not public.is_admin_or_manager() then
    raise exception 'Administrator or manager profile required' using errcode = '42501';
  end if;

  if length(normalized_body) < 1 or length(normalized_body) > 2000 then
    raise exception 'Comment must contain from 1 to 2000 characters' using errcode = '22023';
  end if;

  select * into submission
  from public.checklist_submissions
  where id = p_submission_id
    and deleted_at is null;

  if submission.id is null then
    raise exception 'Checklist submission not found' using errcode = 'P0002';
  end if;

  select name into actor_name
  from public.profiles
  where id = actor_id
    and is_active = true;

  select name into assignee_name_value
  from public.profiles
  where id = p_assignee_id
    and is_active = true;

  if nullif(btrim(coalesce(actor_name, '')), '') is null then
    raise exception 'Active author profile required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(assignee_name_value, '')), '') is null then
    raise exception 'Active assignee profile required' using errcode = '22023';
  end if;

  task_title := left(
    'Комментарий к чек-листу: ' || coalesce(nullif(btrim(submission.checklist_title), ''), 'Чек-лист'),
    180
  );
  task_description := concat_ws(E'\n',
    normalized_body,
    '',
    'Отправленный чек-лист: ' || coalesce(nullif(btrim(submission.checklist_title), ''), 'Чек-лист'),
    'Сотрудник в отчёте: ' || coalesce(nullif(btrim(submission.employee_name), ''), 'не указан'),
    'Комментарий оставил: ' || actor_name,
    'Дата отчёта: ' || to_char(submission.created_at at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI')
  );

  insert into public.tasks (
    id,
    title,
    description,
    creator_id,
    assignee_id,
    is_vip,
    due_date,
    due_at
  ) values (
    created_task_id,
    task_title,
    task_description,
    actor_id,
    p_assignee_id,
    true,
    current_date,
    now()
  );

  insert into public.checklist_submission_comments (
    id,
    submission_id,
    author_id,
    author_name,
    assignee_id,
    assignee_name,
    body,
    task_id
  ) values (
    created_comment_id,
    submission.id,
    actor_id,
    actor_name,
    p_assignee_id,
    assignee_name_value,
    normalized_body,
    created_task_id
  );

  return query
  select *
  from public.checklist_submission_comments
  where id = created_comment_id;
end;
$$;

create or replace function public.delete_checklist_submission(
  p_submission_id uuid,
  p_reason text default 'Удалено администратором'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  deleted_submission_id uuid;
begin
  if actor_id is null or not public.is_admin() then
    raise exception 'Administrator profile required' using errcode = '42501';
  end if;

  update public.checklist_submissions
  set deleted_at = now(),
      deleted_by = actor_id,
      deletion_reason = left(coalesce(nullif(btrim(p_reason), ''), 'Удалено администратором'), 500)
  where id = p_submission_id
    and deleted_at is null
  returning id into deleted_submission_id;

  if deleted_submission_id is null then
    raise exception 'Checklist submission not found or already deleted' using errcode = 'P0002';
  end if;

  delete from public.tasks task
  using public.checklist_submission_comments comment
  where comment.submission_id = deleted_submission_id
    and comment.task_id = task.id
    and task.status = 'open';

  return deleted_submission_id;
end;
$$;

-- Soft-deleted submissions must disappear from every ordinary application query,
-- including the employee's "work for today" status. The security-definer delete
-- function remains able to update the row for audit purposes.
drop policy if exists "checklist_select_control_or_own" on public.checklist_submissions;
create policy "checklist_select_control_or_own"
on public.checklist_submissions
for select
to authenticated
using (
  deleted_at is null
  and public.is_active_user()
  and (
    public.is_admin_or_manager()
    or employee_id = auth.uid()
  )
);

revoke all on table public.checklist_submission_comments from public, anon, authenticated;
grant select on table public.checklist_submission_comments to authenticated;

revoke execute on function public.create_checklist_submission_comment(uuid, uuid, text) from public, anon;
revoke execute on function public.delete_checklist_submission(uuid, text) from public, anon;
grant execute on function public.create_checklist_submission_comment(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.delete_checklist_submission(uuid, text) to authenticated, service_role;

drop policy if exists "checklist_submission_comments_select_visible" on public.checklist_submission_comments;
create policy "checklist_submission_comments_select_visible"
on public.checklist_submission_comments
for select
to authenticated
using (
  public.is_active_user()
  and (
    public.is_admin_or_manager()
    or assignee_id = auth.uid()
  )
);

commit;
