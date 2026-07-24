-- Central role lifecycle: exclusive roles, immutable audit, notifications,
-- manager operational access and last-admin protection.
begin;

do $$
begin
  if exists (
    select 1 from public.profiles
    where role is null or lower(btrim(role)) not in ('admin','manager','barista','waiter')
  ) then
    raise exception 'Profiles contain an unknown role; migration stopped without changing users';
  end if;
end
$$;

alter table public.profiles drop constraint if exists profiles_role_allowed;
alter table public.profiles add constraint profiles_role_allowed
  check (role in ('admin','manager','barista','waiter')) not valid;
alter table public.profiles validate constraint profiles_role_allowed;
alter table public.profiles alter column role set not null;

create table if not exists public.role_change_audit (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete restrict,
  old_role text not null check (old_role in ('admin','manager','barista','waiter')),
  new_role text not null check (new_role in ('admin','manager','barista','waiter')),
  changed_by uuid not null references public.profiles(id) on delete restrict,
  changed_at timestamptz not null default now(),
  check (old_role <> new_role)
);
create index if not exists role_change_audit_employee_idx
  on public.role_change_audit(employee_id,changed_at desc);
alter table public.role_change_audit enable row level security;
revoke all on public.role_change_audit from public,anon,authenticated;
grant select on public.role_change_audit to authenticated;
drop policy if exists role_change_audit_admin_read on public.role_change_audit;
create policy role_change_audit_admin_read on public.role_change_audit
for select to authenticated using (public.is_admin());

create or replace function public.change_employee_role(p_employee_id uuid,p_new_role text)
returns public.profiles
language plpgsql
security definer
set search_path=public
as $$
declare
  actor_id uuid:=auth.uid();
  target public.profiles%rowtype;
  result public.profiles%rowtype;
  normalized text:=lower(btrim(coalesce(p_new_role,'')));
  admin_count integer;
  role_title text;
begin
  if actor_id is null or not public.is_admin() then
    raise exception 'Administrator profile required' using errcode='42501';
  end if;
  if normalized not in ('admin','manager','barista','waiter') then
    raise exception 'Unknown employee role' using errcode='22023';
  end if;
  select * into target from public.profiles where id=p_employee_id for update;
  if target.id is null then
    raise exception 'Employee profile not found' using errcode='P0002';
  end if;
  if target.role=normalized then return target; end if;
  if target.role='admin' and normalized<>'admin' then
    select count(*) into admin_count
    from public.profiles where role='admin' and is_active=true;
    if admin_count<=1 and target.is_active=true then
      raise exception 'Нельзя понизить последнего действующего администратора' using errcode='23514';
    end if;
  end if;

  update public.profiles set role=normalized where id=target.id returning * into result;
  insert into public.role_change_audit(employee_id,old_role,new_role,changed_by)
  values(target.id,target.role,normalized,actor_id);

  role_title:=case normalized
    when 'admin' then 'Администратор'
    when 'manager' then 'Руководитель'
    when 'barista' then 'Бариста'
    when 'waiter' then 'Официант'
  end;

  if to_regclass('public.notification_events') is not null then
    insert into public.notification_events(
      user_id,event_type,event_key,source_table,source_id,title,body,url,status
    ) values (
      target.id,
      'role_changed',
      'role_changed:'||target.id::text||':'||extract(epoch from clock_timestamp())::text,
      'profiles',
      target.id,
      'Ваша роль изменена',
      'Новая роль: '||role_title||'. Интерфейс обновится автоматически.',
      '#home',
      'created'
    );
  end if;
  return result;
end;
$$;
revoke all on function public.change_employee_role(uuid,text) from public,anon;
grant execute on function public.change_employee_role(uuid,text) to authenticated;

create or replace function public.protect_last_active_admin()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare admin_count integer;
begin
  if old.role='admin' and old.is_active=true
     and (tg_op='DELETE' or new.role<>'admin' or new.is_active=false) then
    select count(*) into admin_count
    from public.profiles where role='admin' and is_active=true and id<>old.id;
    if admin_count<1 then
      raise exception 'Нельзя удалить, заблокировать или понизить последнего действующего администратора' using errcode='23514';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function public.protect_last_active_admin() from public,anon,authenticated;
drop trigger if exists protect_last_active_admin on public.profiles;
create trigger protect_last_active_admin
before update of role,is_active or delete on public.profiles
for each row execute function public.protect_last_active_admin();

-- A manager needs operational visibility across tasks, but still cannot delete
-- tasks or use administrator-only employee/system functions.
drop policy if exists "tasks_select_participant" on public.tasks;
drop policy if exists "tasks_select_control_or_participant" on public.tasks;
create policy "tasks_select_control_or_participant"
on public.tasks for select to authenticated
using (
  public.is_active_user()
  and (
    public.is_admin_or_manager()
    or creator_id=auth.uid()
    or assignee_id=auth.uid()
  )
);

drop policy if exists "tasks_update_status_participant" on public.tasks;
drop policy if exists "tasks_update_status_control_or_participant" on public.tasks;
create policy "tasks_update_status_control_or_participant"
on public.tasks for update to authenticated
using (
  public.is_active_user()
  and (
    public.is_admin_or_manager()
    or creator_id=auth.uid()
    or assignee_id=auth.uid()
  )
)
with check (
  public.is_active_user()
  and (
    public.is_admin_or_manager()
    or (
      (creator_id=auth.uid() or assignee_id=auth.uid())
      and status in ('open','done')
      and (
        (status='open' and completed_at is null)
        or (status='done' and completed_at is not null)
      )
    )
  )
);

-- Role changes update an open PWA without reinstalling it. RLS continues to
-- decide which profile rows each authenticated client can receive.
do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname='supabase_realtime'
         and schemaname='public'
         and tablename='profiles'
     ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end
$$;

commit;