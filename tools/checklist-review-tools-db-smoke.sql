\set ON_ERROR_STOP on

DO $$
DECLARE
  admin_id constant uuid := '71111111-1111-4111-8111-111111111111';
  manager_id constant uuid := '72222222-2222-4222-8222-222222222222';
  employee_id constant uuid := '73333333-3333-4333-8333-333333333333';
  submission_id constant uuid := '74444444-4444-4444-8444-444444444444';
  comment_row public.checklist_submission_comments%rowtype;
  forbidden_seen boolean := false;
  task_count integer;
  deleted_value uuid;
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (admin_id,'review-admin@example.test'),
    (manager_id,'review-manager@example.test'),
    (employee_id,'review-employee@example.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles(id,login,name,role,is_active) VALUES
    (admin_id,'review-admin','Review Admin','admin',true),
    (manager_id,'review-manager','Review Manager','manager',true),
    (employee_id,'review-employee','Review Employee','barista',true)
  ON CONFLICT (id) DO UPDATE SET role=excluded.role,is_active=true,name=excluded.name;

  PERFORM set_config('request.jwt.claim.sub', employee_id::text, true);
  INSERT INTO public.checklist_submissions(
    id,checklist_id,checklist_title,employee_id,employee_name,items,
    completed_count,total_count,percent
  ) VALUES (
    submission_id,'opening-checklist','Открытие смены',employee_id,'Review Employee',
    '[{"text":"Проверить бар","checked":true}]'::jsonb,1,1,100
  );

  PERFORM set_config('request.jwt.claim.sub', manager_id::text, true);
  SELECT * INTO comment_row
  FROM public.create_checklist_submission_comment(
    submission_id,
    employee_id,
    'Исправьте размещение инвентаря и подтвердите результат.'
  );

  IF comment_row.submission_id <> submission_id OR comment_row.assignee_id <> employee_id THEN
    RAISE EXCEPTION 'Comment RPC returned invalid row: %', row_to_json(comment_row);
  END IF;

  SELECT count(*) INTO task_count
  FROM public.tasks
  WHERE id = comment_row.task_id
    AND assignee_id = employee_id
    AND status = 'open'
    AND is_vip = true;
  IF task_count <> 1 THEN RAISE EXCEPTION 'Comment task was not created'; END IF;

  PERFORM set_config('request.jwt.claim.sub', employee_id::text, true);
  BEGIN
    PERFORM public.create_checklist_submission_comment(submission_id, employee_id, 'Запрещено');
  EXCEPTION WHEN insufficient_privilege THEN
    forbidden_seen := true;
  END;
  IF NOT forbidden_seen THEN RAISE EXCEPTION 'Employee was allowed to comment'; END IF;

  PERFORM set_config('request.jwt.claim.sub', admin_id::text, true);
  deleted_value := public.delete_checklist_submission(submission_id, 'Database smoke');
  IF deleted_value <> submission_id THEN RAISE EXCEPTION 'Delete RPC returned invalid id'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.checklist_submissions
    WHERE id = submission_id AND deleted_at IS NOT NULL AND deleted_by = admin_id
  ) THEN RAISE EXCEPTION 'Submission was not soft-deleted'; END IF;
  IF EXISTS (SELECT 1 FROM public.tasks WHERE id = comment_row.task_id) THEN
    RAISE EXCEPTION 'Open task linked to deleted checklist remained';
  END IF;

  IF has_table_privilege('authenticated','public.checklist_submission_comments','INSERT')
     OR has_table_privilege('authenticated','public.checklist_submission_comments','UPDATE')
     OR has_table_privilege('authenticated','public.checklist_submission_comments','DELETE') THEN
    RAISE EXCEPTION 'Authenticated clients must not write comments directly';
  END IF;
END
$$;

DELETE FROM public.checklist_submission_comments WHERE submission_id='74444444-4444-4444-8444-444444444444';
DELETE FROM public.checklist_submissions WHERE id='74444444-4444-4444-8444-444444444444';
DELETE FROM public.profiles WHERE login IN ('review-admin','review-manager','review-employee');
DELETE FROM auth.users WHERE email IN ('review-admin@example.test','review-manager@example.test','review-employee@example.test');

SELECT 'Checklist review tools database smoke passed.' AS result;
