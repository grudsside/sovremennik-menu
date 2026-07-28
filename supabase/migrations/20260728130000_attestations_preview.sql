-- Attestations preview: source-bound question bank, automatic test assembly and protected scoring.
begin;

create table if not exists public.attestation_questions (
  id uuid primary key default gen_random_uuid(),
  topic text not null check (topic in ('techcards','coffee','espresso','milk')),
  source_type text not null check (source_type in ('techcard','lesson')),
  source_key text not null,
  source_title text not null,
  source_version text not null,
  question_type text not null check (question_type in ('single','multiple','number')),
  prompt text not null,
  options jsonb not null default '[]'::jsonb,
  correct_answer jsonb not null,
  tolerance numeric not null default 0 check (tolerance >= 0),
  explanation text not null default '',
  fingerprint text not null unique,
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(btrim(prompt)) between 3 and 2000),
  check (length(btrim(source_key)) > 0),
  check (length(btrim(source_title)) > 0),
  check (jsonb_typeof(options) = 'array')
);

create table if not exists public.attestation_tests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  status text not null default 'published' check (status in ('draft','published','archived')),
  settings jsonb not null default '{}'::jsonb,
  topic_plan jsonb not null default '{}'::jsonb,
  question_count integer not null check (question_count > 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  check (length(btrim(title)) between 3 and 200)
);

create table if not exists public.attestation_test_questions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.attestation_tests(id) on delete cascade,
  position integer not null check (position > 0),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (test_id, position),
  check (jsonb_typeof(snapshot) = 'object')
);

create table if not exists public.attestation_assignments (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.attestation_tests(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (test_id, employee_id)
);

create table if not exists public.attestation_attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.attestation_assignments(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  attempt_no integer not null check (attempt_no > 0),
  question_order uuid[] not null,
  answers jsonb not null default '{}'::jsonb,
  correct_count integer,
  total_count integer,
  score_percent numeric(6,2),
  passed boolean,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  unique (assignment_id, attempt_no),
  check (jsonb_typeof(answers) = 'object')
);

create index if not exists attestation_questions_topic_active_idx
  on public.attestation_questions(topic, is_active, created_at desc);
create index if not exists attestation_assignments_employee_idx
  on public.attestation_assignments(employee_id, due_at, created_at desc);
create index if not exists attestation_attempts_assignment_idx
  on public.attestation_attempts(assignment_id, attempt_no desc);
create index if not exists attestation_attempts_submitted_idx
  on public.attestation_attempts(submitted_at desc)
  where submitted_at is not null;

alter table public.attestation_questions enable row level security;
alter table public.attestation_tests enable row level security;
alter table public.attestation_test_questions enable row level security;
alter table public.attestation_assignments enable row level security;
alter table public.attestation_attempts enable row level security;

revoke all on table public.attestation_questions from public, anon, authenticated;
revoke all on table public.attestation_tests from public, anon, authenticated;
revoke all on table public.attestation_test_questions from public, anon, authenticated;
revoke all on table public.attestation_assignments from public, anon, authenticated;
revoke all on table public.attestation_attempts from public, anon, authenticated;

grant select, insert, update, delete on table public.attestation_questions to authenticated;
grant select on table public.attestation_tests to authenticated;
grant select on table public.attestation_test_questions to authenticated;
grant select on table public.attestation_assignments to authenticated;
grant select on table public.attestation_attempts to authenticated;

drop policy if exists "attestation_questions_admin_all" on public.attestation_questions;
create policy "attestation_questions_admin_all"
on public.attestation_questions
for all
to authenticated
using (public.is_admin())
with check (public.is_admin() and created_by = auth.uid());

drop policy if exists "attestation_tests_admin_select" on public.attestation_tests;
create policy "attestation_tests_admin_select"
on public.attestation_tests
for select
to authenticated
using (public.is_admin());

drop policy if exists "attestation_test_questions_admin_select" on public.attestation_test_questions;
create policy "attestation_test_questions_admin_select"
on public.attestation_test_questions
for select
to authenticated
using (public.is_admin());

drop policy if exists "attestation_assignments_visible" on public.attestation_assignments;
create policy "attestation_assignments_visible"
on public.attestation_assignments
for select
to authenticated
using (
  public.is_active_user()
  and (public.is_admin_or_manager() or employee_id = auth.uid())
);

drop policy if exists "attestation_attempts_visible" on public.attestation_attempts;
create policy "attestation_attempts_visible"
on public.attestation_attempts
for select
to authenticated
using (
  public.is_active_user()
  and (public.is_admin_or_manager() or employee_id = auth.uid())
);

create or replace function public.attestation_normalize_text(p_value text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(replace(btrim(coalesce(p_value, '')), 'ё', 'е'), '\s+', ' ', 'g'));
$$;

create or replace function public.attestation_answer_is_correct(p_snapshot jsonb, p_answer jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  question_type text := coalesce(p_snapshot->>'type', 'single');
  expected jsonb := p_snapshot->'correctAnswer';
  expected_values text[];
  actual_values text[];
  expected_number numeric;
  actual_number numeric;
  allowed_tolerance numeric := greatest(coalesce((p_snapshot->>'tolerance')::numeric, 0), 0);
begin
  if question_type = 'multiple' then
    if jsonb_typeof(expected) <> 'array' or jsonb_typeof(p_answer) <> 'array' then return false; end if;
    select coalesce(array_agg(public.attestation_normalize_text(value) order by public.attestation_normalize_text(value)), array[]::text[])
      into expected_values
      from jsonb_array_elements_text(expected);
    select coalesce(array_agg(public.attestation_normalize_text(value) order by public.attestation_normalize_text(value)), array[]::text[])
      into actual_values
      from jsonb_array_elements_text(p_answer);
    return expected_values = actual_values;
  end if;

  if question_type = 'number' then
    begin
      expected_number := replace(trim(both '"' from expected::text), ',', '.')::numeric;
      actual_number := replace(trim(both '"' from coalesce(p_answer, 'null'::jsonb)::text), ',', '.')::numeric;
    exception when others then
      return false;
    end;
    return abs(expected_number - actual_number) <= allowed_tolerance;
  end if;

  return public.attestation_normalize_text(trim(both '"' from coalesce(expected, 'null'::jsonb)::text))
       = public.attestation_normalize_text(trim(both '"' from coalesce(p_answer, 'null'::jsonb)::text));
end;
$$;

create or replace function public.create_attestation_test(
  p_title text,
  p_description text,
  p_settings jsonb,
  p_topic_plan jsonb,
  p_questions jsonb,
  p_employee_ids uuid[],
  p_due_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  created_test_id uuid := gen_random_uuid();
  question_count_value integer;
  employee_count_value integer;
  pass_percent integer;
  max_attempts integer;
  question_row record;
begin
  if actor_id is null or not public.is_admin() then
    raise exception 'Administrator profile required' using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_title, ''))) < 3 then
    raise exception 'Test title is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_questions) <> 'array' then
    raise exception 'Questions must be a JSON array' using errcode = '22023';
  end if;
  question_count_value := jsonb_array_length(p_questions);
  if question_count_value < 1 or question_count_value > 200 then
    raise exception 'Question count must be from 1 to 200' using errcode = '22023';
  end if;

  employee_count_value := coalesce(array_length(p_employee_ids, 1), 0);
  if employee_count_value < 1 then
    raise exception 'At least one employee is required' using errcode = '22023';
  end if;

  pass_percent := coalesce((p_settings->>'passPercent')::integer, 85);
  max_attempts := coalesce((p_settings->>'maxAttempts')::integer, 2);
  if pass_percent < 1 or pass_percent > 100 then
    raise exception 'Pass percent must be from 1 to 100' using errcode = '22023';
  end if;
  if max_attempts < 1 or max_attempts > 10 then
    raise exception 'Max attempts must be from 1 to 10' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_employee_ids) as employee(employee_id)
    left join public.profiles profile on profile.id = employee.employee_id and profile.is_active = true
    where profile.id is null or profile.role not in ('barista','waiter')
  ) then
    raise exception 'Only active baristas and waiters can be assigned' using errcode = '22023';
  end if;

  insert into public.attestation_tests (
    id, title, description, settings, topic_plan, question_count, created_by
  ) values (
    created_test_id,
    left(btrim(p_title), 200),
    left(btrim(coalesce(p_description, '')), 2000),
    coalesce(p_settings, '{}'::jsonb),
    coalesce(p_topic_plan, '{}'::jsonb),
    question_count_value,
    actor_id
  );

  for question_row in
    select value as snapshot, ordinality as position
    from jsonb_array_elements(p_questions) with ordinality
  loop
    if jsonb_typeof(question_row.snapshot) <> 'object'
       or nullif(btrim(question_row.snapshot->>'prompt'), '') is null
       or nullif(btrim(question_row.snapshot->>'sourceKey'), '') is null
       or question_row.snapshot->'correctAnswer' is null then
      raise exception 'Every question needs prompt, source and correct answer' using errcode = '22023';
    end if;
    insert into public.attestation_test_questions (test_id, position, snapshot)
    values (created_test_id, question_row.position, question_row.snapshot);
  end loop;

  insert into public.attestation_assignments (test_id, employee_id, assigned_by, due_at)
  select created_test_id, employee.employee_id, actor_id, p_due_at
  from unnest(p_employee_ids) as employee(employee_id);

  return created_test_id;
end;
$$;

create or replace function public.list_admin_attestation_tests()
returns table (
  id uuid,
  title text,
  status text,
  question_count integer,
  assignment_count bigint,
  passed_count bigint,
  average_score numeric,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator profile required' using errcode = '42501';
  end if;
  return query
  select
    test.id,
    test.title,
    test.status,
    test.question_count,
    count(distinct assignment.id) as assignment_count,
    count(distinct assignment.id) filter (where assignment.completed_at is not null) as passed_count,
    round(avg(attempt.score_percent) filter (where attempt.submitted_at is not null), 2) as average_score,
    test.created_at
  from public.attestation_tests test
  left join public.attestation_assignments assignment on assignment.test_id = test.id
  left join public.attestation_attempts attempt on attempt.assignment_id = assignment.id
  group by test.id
  order by test.created_at desc;
end;
$$;

create or replace function public.list_my_attestations()
returns table (
  assignment_id uuid,
  test_id uuid,
  title text,
  description text,
  question_count integer,
  pass_percent integer,
  max_attempts integer,
  time_limit_minutes integer,
  due_at timestamptz,
  attempt_count bigint,
  best_score numeric,
  passed boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'Active employee profile required' using errcode = '42501';
  end if;
  return query
  select
    assignment.id,
    test.id,
    test.title,
    test.description,
    test.question_count,
    coalesce((test.settings->>'passPercent')::integer, 85),
    coalesce((test.settings->>'maxAttempts')::integer, 2),
    coalesce((test.settings->>'timeLimitMinutes')::integer, 0),
    assignment.due_at,
    count(attempt.id) filter (where attempt.submitted_at is not null),
    max(attempt.score_percent) filter (where attempt.submitted_at is not null),
    coalesce(bool_or(attempt.passed) filter (where attempt.submitted_at is not null), false)
  from public.attestation_assignments assignment
  join public.attestation_tests test on test.id = assignment.test_id and test.status = 'published'
  left join public.attestation_attempts attempt on attempt.assignment_id = assignment.id
  where assignment.employee_id = auth.uid()
  group by assignment.id, test.id
  order by
    case when assignment.completed_at is null then 0 else 1 end,
    assignment.due_at nulls last,
    assignment.created_at desc;
end;
$$;

create or replace function public.start_attestation_attempt(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  assignment_row public.attestation_assignments%rowtype;
  test_row public.attestation_tests%rowtype;
  attempt_row public.attestation_attempts%rowtype;
  max_attempts integer;
  submitted_count integer;
  question_order_value uuid[];
  questions_value jsonb;
  should_shuffle_questions boolean;
  should_shuffle_options boolean;
begin
  if actor_id is null or not public.is_active_user() then
    raise exception 'Active employee profile required' using errcode = '42501';
  end if;

  select * into assignment_row
  from public.attestation_assignments
  where id = p_assignment_id
  for update;

  if assignment_row.id is null or assignment_row.employee_id <> actor_id then
    raise exception 'Assignment not found' using errcode = 'P0002';
  end if;
  if assignment_row.completed_at is not null then
    raise exception 'Attestation is already passed' using errcode = '22023';
  end if;
  if assignment_row.due_at is not null and assignment_row.due_at < now() then
    raise exception 'Attestation deadline has expired' using errcode = '22023';
  end if;

  select * into test_row from public.attestation_tests where id = assignment_row.test_id and status = 'published';
  if test_row.id is null then raise exception 'Published test not found' using errcode = 'P0002'; end if;

  select * into attempt_row
  from public.attestation_attempts
  where assignment_id = assignment_row.id and submitted_at is null
  order by started_at desc
  limit 1;

  max_attempts := coalesce((test_row.settings->>'maxAttempts')::integer, 2);
  select count(*) into submitted_count
  from public.attestation_attempts
  where assignment_id = assignment_row.id and submitted_at is not null;

  if attempt_row.id is null then
    if submitted_count >= max_attempts then
      raise exception 'No attempts left' using errcode = '22023';
    end if;
    should_shuffle_questions := coalesce((test_row.settings->>'shuffleQuestions')::boolean, true);
    if should_shuffle_questions then
      select array_agg(id order by random()) into question_order_value
      from public.attestation_test_questions where test_id = test_row.id;
    else
      select array_agg(id order by position) into question_order_value
      from public.attestation_test_questions where test_id = test_row.id;
    end if;
    insert into public.attestation_attempts (assignment_id, employee_id, attempt_no, question_order)
    values (assignment_row.id, actor_id, submitted_count + 1, question_order_value)
    returning * into attempt_row;
  end if;

  should_shuffle_options := coalesce((test_row.settings->>'shuffleOptions')::boolean, true);
  select coalesce(jsonb_agg(
    (question.snapshot - 'correctAnswer' - 'explanation') || jsonb_build_object(
      'testQuestionId', question.id,
      'options', case
        when should_shuffle_options and jsonb_typeof(question.snapshot->'options') = 'array' then
          (select coalesce(jsonb_agg(option_value order by random()), '[]'::jsonb) from jsonb_array_elements(question.snapshot->'options') option_value)
        else coalesce(question.snapshot->'options', '[]'::jsonb)
      end
    ) order by ordered.ordinality
  ), '[]'::jsonb)
  into questions_value
  from unnest(attempt_row.question_order) with ordinality ordered(question_id, ordinality)
  join public.attestation_test_questions question on question.id = ordered.question_id;

  return jsonb_build_object(
    'attemptId', attempt_row.id,
    'assignmentId', assignment_row.id,
    'attemptNo', attempt_row.attempt_no,
    'title', test_row.title,
    'settings', test_row.settings,
    'dueAt', assignment_row.due_at,
    'startedAt', attempt_row.started_at,
    'questions', questions_value
  );
end;
$$;

create or replace function public.submit_attestation_attempt(p_attempt_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  attempt_row public.attestation_attempts%rowtype;
  assignment_row public.attestation_assignments%rowtype;
  test_row public.attestation_tests%rowtype;
  question_row record;
  answer_value jsonb;
  correct_value boolean;
  correct_count_value integer := 0;
  total_count_value integer := 0;
  score_value numeric(6,2);
  passed_value boolean;
  pass_percent integer;
  time_limit integer;
  show_answers boolean;
  review_value jsonb := '[]'::jsonb;
begin
  if actor_id is null or not public.is_active_user() then
    raise exception 'Active employee profile required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Answers must be a JSON object' using errcode = '22023';
  end if;

  select * into attempt_row from public.attestation_attempts where id = p_attempt_id for update;
  if attempt_row.id is null or attempt_row.employee_id <> actor_id then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;
  if attempt_row.submitted_at is not null then
    return jsonb_build_object(
      'scorePercent', attempt_row.score_percent,
      'correctCount', attempt_row.correct_count,
      'totalCount', attempt_row.total_count,
      'passed', attempt_row.passed,
      'alreadySubmitted', true
    );
  end if;

  select * into assignment_row from public.attestation_assignments where id = attempt_row.assignment_id;
  select * into test_row from public.attestation_tests where id = assignment_row.test_id;
  time_limit := coalesce((test_row.settings->>'timeLimitMinutes')::integer, 0);
  if time_limit > 0 and now() > attempt_row.started_at + make_interval(mins => time_limit) + interval '90 seconds' then
    raise exception 'Time limit has expired' using errcode = '22023';
  end if;

  show_answers := coalesce((test_row.settings->>'showAnswers')::boolean, false);
  for question_row in
    select question.id, question.snapshot, ordered.ordinality
    from unnest(attempt_row.question_order) with ordinality ordered(question_id, ordinality)
    join public.attestation_test_questions question on question.id = ordered.question_id
    order by ordered.ordinality
  loop
    total_count_value := total_count_value + 1;
    answer_value := p_answers -> question_row.id::text;
    correct_value := public.attestation_answer_is_correct(question_row.snapshot, answer_value);
    if correct_value then correct_count_value := correct_count_value + 1; end if;
    review_value := review_value || jsonb_build_array(
      jsonb_build_object(
        'testQuestionId', question_row.id,
        'correct', correct_value,
        'correctAnswer', case when show_answers then question_row.snapshot->'correctAnswer' else null end,
        'explanation', case when show_answers then question_row.snapshot->>'explanation' else null end
      )
    );
  end loop;

  score_value := case when total_count_value > 0 then round(correct_count_value::numeric / total_count_value::numeric * 100, 2) else 0 end;
  pass_percent := coalesce((test_row.settings->>'passPercent')::integer, 85);
  passed_value := score_value >= pass_percent;

  update public.attestation_attempts
  set answers = p_answers,
      correct_count = correct_count_value,
      total_count = total_count_value,
      score_percent = score_value,
      passed = passed_value,
      submitted_at = now()
  where id = attempt_row.id;

  if passed_value then
    update public.attestation_assignments
    set completed_at = coalesce(completed_at, now())
    where id = assignment_row.id;
  end if;

  return jsonb_build_object(
    'scorePercent', score_value,
    'correctCount', correct_count_value,
    'totalCount', total_count_value,
    'passed', passed_value,
    'review', review_value
  );
end;
$$;

create or replace function public.list_attestation_results()
returns table (
  attempt_id uuid,
  employee_id uuid,
  employee_name text,
  employee_role text,
  test_id uuid,
  test_title text,
  score_percent numeric,
  passed boolean,
  attempt_no integer,
  submitted_at timestamptz,
  due_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin_or_manager() then
    raise exception 'Administrator or manager profile required' using errcode = '42501';
  end if;
  return query
  select
    attempt.id,
    profile.id,
    profile.name,
    profile.role,
    test.id,
    test.title,
    attempt.score_percent,
    attempt.passed,
    attempt.attempt_no,
    attempt.submitted_at,
    assignment.due_at
  from public.attestation_attempts attempt
  join public.attestation_assignments assignment on assignment.id = attempt.assignment_id
  join public.attestation_tests test on test.id = assignment.test_id
  join public.profiles profile on profile.id = attempt.employee_id
  where attempt.submitted_at is not null
  order by attempt.submitted_at desc;
end;
$$;

revoke execute on function public.attestation_normalize_text(text) from public, anon;
revoke execute on function public.attestation_answer_is_correct(jsonb, jsonb) from public, anon;
revoke execute on function public.create_attestation_test(text, text, jsonb, jsonb, jsonb, uuid[], timestamptz) from public, anon;
revoke execute on function public.list_admin_attestation_tests() from public, anon;
revoke execute on function public.list_my_attestations() from public, anon;
revoke execute on function public.start_attestation_attempt(uuid) from public, anon;
revoke execute on function public.submit_attestation_attempt(uuid, jsonb) from public, anon;
revoke execute on function public.list_attestation_results() from public, anon;

grant execute on function public.create_attestation_test(text, text, jsonb, jsonb, jsonb, uuid[], timestamptz) to authenticated, service_role;
grant execute on function public.list_admin_attestation_tests() to authenticated, service_role;
grant execute on function public.list_my_attestations() to authenticated, service_role;
grant execute on function public.start_attestation_attempt(uuid) to authenticated, service_role;
grant execute on function public.submit_attestation_attempt(uuid, jsonb) to authenticated, service_role;
grant execute on function public.list_attestation_results() to authenticated, service_role;

commit;
