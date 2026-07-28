-- Attestation question management: administrator editing, soft deletion and audit fields.
begin;

alter table public.attestation_questions
  add column if not exists updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

create index if not exists attestation_questions_deleted_at_idx
  on public.attestation_questions(deleted_at)
  where deleted_at is not null;

create or replace function public.touch_attestation_question_management()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null and public.is_admin() then
    new.updated_by := auth.uid();
  elsif new.updated_by is null then
    new.updated_by := new.created_by;
  end if;

  if new.deleted_at is null then
    new.deleted_by := null;
  elsif new.deleted_by is null then
    new.deleted_by := coalesce(auth.uid(), new.updated_by, new.created_by);
  end if;
  return new;
end;
$$;

drop trigger if exists attestation_questions_management_touch on public.attestation_questions;
create trigger attestation_questions_management_touch
before insert or update on public.attestation_questions
for each row execute function public.touch_attestation_question_management();

drop policy if exists "attestation_questions_admin_all" on public.attestation_questions;
drop policy if exists "attestation_questions_admin_select" on public.attestation_questions;
drop policy if exists "attestation_questions_admin_insert" on public.attestation_questions;
drop policy if exists "attestation_questions_admin_update" on public.attestation_questions;
drop policy if exists "attestation_questions_admin_delete" on public.attestation_questions;

create policy "attestation_questions_admin_select"
on public.attestation_questions
for select
to authenticated
using (public.is_admin());

create policy "attestation_questions_admin_insert"
on public.attestation_questions
for insert
to authenticated
with check (
  public.is_admin()
  and created_by = auth.uid()
  and (deleted_by is null or deleted_by = auth.uid())
);

create policy "attestation_questions_admin_update"
on public.attestation_questions
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "attestation_questions_admin_delete"
on public.attestation_questions
for delete
to authenticated
using (public.is_admin());

revoke execute on function public.touch_attestation_question_management() from public, anon, authenticated;

commit;