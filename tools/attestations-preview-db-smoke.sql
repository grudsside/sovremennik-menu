\set ON_ERROR_STOP on

DO $$
DECLARE
  admin_id uuid := '10000000-0000-0000-0000-000000000001';
  manager_id uuid := '10000000-0000-0000-0000-000000000002';
  employee_user_id uuid := '10000000-0000-0000-0000-000000000003';
  created_test_id uuid;
  assignment_id_value uuid;
  attempt_payload jsonb;
  attempt_id_value uuid;
  answers_value jsonb;
  submit_payload jsonb;
  result_count integer;
  blocked boolean := false;
BEGIN
  insert into auth.users(id,email) values
    (admin_id,'att-admin@example.test'),
    (manager_id,'att-manager@example.test'),
    (employee_user_id,'att-employee@example.test')
  on conflict (id) do nothing;

  insert into public.profiles(id,login,name,role,is_active) values
    (admin_id,'att-admin','Администратор теста','admin',true),
    (manager_id,'att-manager','Руководитель теста','manager',true),
    (employee_user_id,'att-barista','Бариста теста','barista',true)
  on conflict (id) do update set is_active=true;

  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  created_test_id := public.create_attestation_test(
    'Проверка preview',
    'Автоматически собранный тест',
    '{"passPercent":80,"maxAttempts":2,"timeLimitMinutes":0,"shuffleQuestions":false,"shuffleOptions":false,"showAnswers":true}'::jsonb,
    '{"techcards":1,"coffee":1}'::jsonb,
    '[
      {"id":"q1","fingerprint":"f1","topic":"techcards","sourceType":"techcard","sourceKey":"bar::coffee::espresso","sourceTitle":"Эспрессо","sourceVersion":"v1","type":"single","prompt":"Выберите правильный ответ","options":["18 г","20 г","22 г"],"correctAnswer":"18 г","tolerance":0,"explanation":"Техкарта"},
      {"id":"q2","fingerprint":"f2","topic":"coffee","sourceType":"lesson","sourceKey":"coffee-basics","sourceTitle":"Теория кофе","sourceVersion":"v1","type":"multiple","prompt":"Выберите два ответа","options":["A","B","C"],"correctAnswer":["A","B"],"tolerance":0,"explanation":"Теория"}
    ]'::jsonb,
    array[employee_user_id],
    now() + interval '7 days'
  );

  select id into assignment_id_value
  from public.attestation_assignments
  where test_id = created_test_id and attestation_assignments.employee_id = employee_user_id;
  if assignment_id_value is null then raise exception 'Assignment was not created'; end if;

  perform set_config('request.jwt.claim.sub', employee_user_id::text, true);
  attempt_payload := public.start_attestation_attempt(assignment_id_value);
  attempt_id_value := (attempt_payload->>'attemptId')::uuid;
  if attempt_id_value is null then raise exception 'Attempt was not created'; end if;
  if (attempt_payload->'questions'->0) ? 'correctAnswer' then raise exception 'Correct answer leaked to employee'; end if;

  select jsonb_object_agg(id::text, snapshot->'correctAnswer')
  into answers_value
  from public.attestation_test_questions
  where test_id = created_test_id;

  submit_payload := public.submit_attestation_attempt(attempt_id_value, answers_value);
  if coalesce((submit_payload->>'passed')::boolean, false) is not true then
    raise exception 'Correct attempt must pass: %', submit_payload;
  end if;
  if (submit_payload->>'scorePercent')::numeric <> 100 then
    raise exception 'Expected 100 percent, got %', submit_payload;
  end if;

  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  select count(*) into result_count from public.list_attestation_results();
  if result_count < 1 then raise exception 'Manager cannot see attestation result'; end if;

  begin
    perform public.create_attestation_test(
      'Запрещено', '', '{}'::jsonb, '{}'::jsonb,
      '[{"prompt":"x","sourceKey":"x","correctAnswer":"x"}]'::jsonb,
      array[employee_user_id], now() + interval '1 day'
    );
  exception when sqlstate '42501' then
    blocked := true;
  end;
  if not blocked then raise exception 'Manager unexpectedly created a test'; end if;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.attestation_questions') IS NULL THEN RAISE EXCEPTION 'Question bank table missing'; END IF;
  IF to_regclass('public.attestation_tests') IS NULL THEN RAISE EXCEPTION 'Tests table missing'; END IF;
  IF to_regclass('public.attestation_assignments') IS NULL THEN RAISE EXCEPTION 'Assignments table missing'; END IF;
  IF to_regclass('public.attestation_attempts') IS NULL THEN RAISE EXCEPTION 'Attempts table missing'; END IF;
  IF to_regprocedure('public.create_attestation_test(text,text,jsonb,jsonb,jsonb,uuid[],timestamptz)') IS NULL THEN RAISE EXCEPTION 'Create test RPC missing'; END IF;
  IF to_regprocedure('public.start_attestation_attempt(uuid)') IS NULL THEN RAISE EXCEPTION 'Start attempt RPC missing'; END IF;
  IF to_regprocedure('public.submit_attestation_attempt(uuid,jsonb)') IS NULL THEN RAISE EXCEPTION 'Submit attempt RPC missing'; END IF;
  IF to_regprocedure('public.list_attestation_results()') IS NULL THEN RAISE EXCEPTION 'Results RPC missing'; END IF;
END
$$;
