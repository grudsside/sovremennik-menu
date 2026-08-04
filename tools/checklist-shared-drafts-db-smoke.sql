\set ON_ERROR_STOP on

DO $$
DECLARE
  admin_id constant uuid := '81111111-1111-4111-8111-111111111111';
  barista_one constant uuid := '82222222-2222-4222-8222-222222222222';
  barista_two constant uuid := '83333333-3333-4333-8333-333333333333';
  waiter_id constant uuid := '84444444-4444-4444-8444-444444444444';
  first_payload jsonb;
  second_payload jsonb;
  final_payload jsonb;
  draft_id_value uuid;
  submission_id_value uuid;
  forbidden_seen boolean := false;
  locked_seen boolean := false;
  final_row public.checklist_submissions%rowtype;
  photo_creator uuid;
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (admin_id,'shared-admin@example.test'),
    (barista_one,'shared-barista-one@example.test'),
    (barista_two,'shared-barista-two@example.test'),
    (waiter_id,'shared-waiter@example.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles(id,login,name,role,is_active) VALUES
    (admin_id,'shared-admin','Shared Admin','admin',true),
    (barista_one,'shared-barista-one','Анна','barista',true),
    (barista_two,'shared-barista-two','Иван','barista',true),
    (waiter_id,'shared-waiter','Олег','waiter',true)
  ON CONFLICT (id) DO UPDATE SET role=excluded.role,is_active=true,name=excluded.name;

  PERFORM set_config('request.jwt.claim.sub', admin_id::text, true);
  PERFORM public.replace_checklist_photo_rules(
    'shared-opening-preview',
    '[{"item_key":"one","item_text":"Первый пункт","required_count":1,"hint":"Фото"}]'::jsonb
  );

  PERFORM set_config('request.jwt.claim.sub', barista_one::text, true);
  first_payload := public.open_checklist_shared_draft(
    'shared-opening-preview',
    'Открытие смены',
    'barista',
    current_date,
    '[
      {"itemKey":"one","text":"Первый пункт","sectionTitle":"Бар","requiredPhotoCount":1},
      {"itemKey":"two","text":"Второй пункт","sectionTitle":"Бар","requiredPhotoCount":0}
    ]'::jsonb
  );
  draft_id_value := (first_payload->>'id')::uuid;
  submission_id_value := (first_payload->>'submissionId')::uuid;
  IF draft_id_value IS NULL OR submission_id_value IS NULL THEN
    RAISE EXCEPTION 'Shared draft did not return stable ids: %', first_payload;
  END IF;

  first_payload := public.patch_checklist_shared_draft(
    draft_id_value,
    'Анна',
    '[{"itemKey":"one","checkedByUser":true}]'::jsonb
  );
  IF (first_payload #>> '{items,0,checkedByUser}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'First device change was not stored: %', first_payload;
  END IF;

  first_payload := public.attach_checklist_shared_draft_photo(
    draft_id_value,
    '85555555-5555-4555-8555-555555555555'::uuid,
    'one',
    barista_one::text || '/shared/' || draft_id_value::text || '/one/photo/full.jpg',
    barista_one::text || '/shared/' || draft_id_value::text || '/one/photo/thumb.jpg',
    'image/jpeg',
    1200,
    320
  );
  IF jsonb_array_length(first_payload->'photos') <> 1 THEN
    RAISE EXCEPTION 'Shared photo was not attached: %', first_payload;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', waiter_id::text, true);
  BEGIN
    PERFORM public.open_checklist_shared_draft(
      'shared-opening-preview','Запрещено','barista',current_date,'[]'::jsonb
    );
  EXCEPTION WHEN insufficient_privilege THEN
    forbidden_seen := true;
  END;
  IF NOT forbidden_seen THEN RAISE EXCEPTION 'Waiter received access to a barista shared draft'; END IF;

  PERFORM set_config('request.jwt.claim.sub', barista_two::text, true);
  second_payload := public.open_checklist_shared_draft(
    'shared-opening-preview',
    'Открытие смены',
    'barista',
    current_date,
    '[
      {"itemKey":"one","text":"Первый пункт","sectionTitle":"Бар","requiredPhotoCount":1},
      {"itemKey":"two","text":"Второй пункт","sectionTitle":"Бар","requiredPhotoCount":0}
    ]'::jsonb
  );
  IF (second_payload->>'id')::uuid <> draft_id_value
     OR (second_payload->>'submissionId')::uuid <> submission_id_value THEN
    RAISE EXCEPTION 'Second device did not receive the same shared draft: %', second_payload;
  END IF;
  IF (second_payload #>> '{items,0,checkedByUser}')::boolean IS DISTINCT FROM true
     OR jsonb_array_length(second_payload->'photos') <> 1 THEN
    RAISE EXCEPTION 'Second device did not receive prior changes and photo: %', second_payload;
  END IF;

  second_payload := public.patch_checklist_shared_draft(
    draft_id_value,
    'Иван',
    '[{"itemKey":"two","checkedByUser":true}]'::jsonb
  );
  final_payload := public.finalize_checklist_shared_draft(draft_id_value, 'Иван');
  IF final_payload->>'status' <> 'submitted' THEN
    RAISE EXCEPTION 'Shared finalization failed: %', final_payload;
  END IF;

  SELECT * INTO final_row FROM public.checklist_submissions WHERE id = submission_id_value;
  IF final_row.id IS NULL OR final_row.employee_id <> barista_two
     OR final_row.completed_count <> 2 OR final_row.total_count <> 2
     OR final_row.photo_count <> 1 OR final_row.percent <> 100 THEN
    RAISE EXCEPTION 'Final submission is inconsistent: %', row_to_json(final_row);
  END IF;

  SELECT created_by INTO photo_creator
  FROM public.checklist_submission_photos
  WHERE submission_id = submission_id_value AND item_key = 'one';
  IF photo_creator IS DISTINCT FROM barista_one THEN
    RAISE EXCEPTION 'Cross-user photo author was not preserved: %', photo_creator;
  END IF;

  BEGIN
    PERFORM public.patch_checklist_shared_draft(
      draft_id_value,
      null,
      '[{"itemKey":"two","checkedByUser":false}]'::jsonb
    );
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    locked_seen := true;
  END;
  IF NOT locked_seen THEN RAISE EXCEPTION 'Submitted shared draft remained editable'; END IF;

  IF has_table_privilege('authenticated','public.checklist_shared_drafts','INSERT')
     OR has_table_privilege('authenticated','public.checklist_shared_draft_items','UPDATE')
     OR has_table_privilege('authenticated','public.checklist_shared_draft_photos','DELETE') THEN
    RAISE EXCEPTION 'Authenticated browser received direct shared-table write access';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.finalize_checklist_shared_draft(uuid,text)',
    'EXECUTE'
  ) THEN RAISE EXCEPTION 'Authenticated role cannot call protected shared finalization'; END IF;
END
$$;

DELETE FROM public.checklist_submission_photos
WHERE submission_id IN (
  SELECT submission_id FROM public.checklist_shared_drafts WHERE checklist_id='shared-opening-preview'
);
DELETE FROM public.checklist_submissions
WHERE checklist_id='shared-opening-preview';
DELETE FROM public.checklist_shared_drafts
WHERE checklist_id='shared-opening-preview';
DELETE FROM public.checklist_photo_rules
WHERE checklist_id='shared-opening-preview';
DELETE FROM public.profiles
WHERE login IN ('shared-admin','shared-barista-one','shared-barista-two','shared-waiter');
DELETE FROM auth.users
WHERE email LIKE 'shared-%@example.test';

SELECT 'Shared checklist multi-device database smoke passed.' AS result;
