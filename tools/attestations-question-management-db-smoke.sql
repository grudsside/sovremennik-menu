\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  admin_id uuid := '10000000-0000-0000-0000-000000000001';
  employee_id uuid := '10000000-0000-0000-0000-000000000003';
  question_id uuid;
  blocked boolean := false;
BEGIN
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  insert into public.attestation_questions (
    topic, source_type, source_key, source_title, source_version,
    question_type, prompt, options, correct_answer, tolerance,
    explanation, fingerprint, is_active, created_by
  ) values (
    'coffee', 'lesson', 'coffee-basics', 'Теория кофе', 'v1',
    'single', 'Вопрос до редактирования?', '["A","B","C"]'::jsonb, '"A"'::jsonb, 0,
    '', 'question-management-smoke', true, admin_id
  ) returning id into question_id;

  update public.attestation_questions
  set prompt = 'Вопрос после редактирования?'
  where id = question_id;

  if not exists (
    select 1 from public.attestation_questions
    where id = question_id
      and prompt = 'Вопрос после редактирования?'
      and updated_by = admin_id
  ) then
    raise exception 'Administrator question edit was not persisted';
  end if;

  update public.attestation_questions
  set is_active = false, deleted_at = now(), deleted_by = admin_id
  where id = question_id;

  if not exists (
    select 1 from public.attestation_questions
    where id = question_id and deleted_at is not null and deleted_by = admin_id and is_active = false
  ) then
    raise exception 'Administrator soft deletion was not persisted';
  end if;

  perform set_config('request.jwt.claim.sub', employee_id::text, true);
  begin
    update public.attestation_questions set prompt = 'Запрещённое изменение' where id = question_id;
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'Employee unexpectedly edited an attestation question'; end if;

  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  delete from public.attestation_questions where id = question_id;
END
$$;

RESET ROLE;
COMMIT;

DO $$
BEGIN
  IF NOT EXISTS (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='attestation_questions' and column_name='deleted_at'
  ) THEN RAISE EXCEPTION 'attestation_questions.deleted_at is missing'; END IF;
  IF NOT EXISTS (
    select 1 from pg_policies
    where schemaname='public' and tablename='attestation_questions' and policyname='attestation_questions_admin_update'
  ) THEN RAISE EXCEPTION 'Administrator update policy is missing'; END IF;
  IF NOT EXISTS (
    select 1 from pg_policies
    where schemaname='public' and tablename='attestation_questions' and policyname='attestation_questions_admin_delete'
  ) THEN RAISE EXCEPTION 'Administrator delete policy is missing'; END IF;
END
$$;