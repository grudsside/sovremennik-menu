\set ON_ERROR_STOP on

DO $$
DECLARE
  admin_id constant uuid := '11111111-1111-4111-8111-111111111111';
  barista_id constant uuid := '22222222-2222-4222-8222-222222222222';
  saved public.checklist_template_overrides%rowtype;
  conflict_seen boolean := false;
  forbidden_seen boolean := false;
  audit_count integer;
  rule_count integer;
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (admin_id,'editor-admin@example.test'),
    (barista_id,'editor-barista@example.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles(id,login,name,role,is_active) VALUES
    (admin_id,'editor-admin','Editor Admin','admin',true),
    (barista_id,'editor-barista','Editor Barista','barista',true)
  ON CONFLICT (id) DO UPDATE SET role=excluded.role,is_active=true;

  PERFORM set_config('request.jwt.claim.sub', admin_id::text, true);
  PERFORM public.replace_checklist_photo_rules(
    'editor-preview-checklist',
    '[
      {"item_key":"editor-preview-checklist:0:0","item_text":"Старое название","required_count":1,"hint":"Фото"},
      {"item_key":"editor-preview-checklist:9:9","item_text":"Удалённый пункт","required_count":1,"hint":"Удалить"}
    ]'::jsonb
  );

  SELECT * INTO saved
  FROM public.save_checklist_template_override(
    'editor-preview-checklist',
    'Открытие смены',
    'Тест защищённого редактора',
    '[{
      "title":"Бар",
      "rows":[
        {"itemKey":"editor-preview-checklist:0:0","task":"Новое название","responsible":"Бариста"},
        {"itemKey":"editor-preview-checklist:custom:stable","task":"Новый пункт"}
      ]
    }]'::jsonb,
    0
  );

  IF saved.version <> 1 OR saved.title <> 'Открытие смены' THEN
    RAISE EXCEPTION 'Checklist template save returned invalid row: %', row_to_json(saved);
  END IF;
  IF saved.sections #>> '{0,rows,0,itemKey}' <> 'editor-preview-checklist:0:0'
     OR saved.sections #>> '{0,rows,1,itemKey}' <> 'editor-preview-checklist:custom:stable' THEN
    RAISE EXCEPTION 'Stable item keys were not preserved: %', saved.sections;
  END IF;

  SELECT count(*) INTO rule_count
  FROM public.checklist_photo_rules
  WHERE checklist_id = 'editor-preview-checklist'
    AND item_key = 'editor-preview-checklist:0:0'
    AND item_text = 'Новое название';
  IF rule_count <> 1 THEN RAISE EXCEPTION 'Photo rule label was not updated'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.checklist_photo_rules
    WHERE checklist_id = 'editor-preview-checklist'
      AND item_key = 'editor-preview-checklist:9:9'
  ) THEN RAISE EXCEPTION 'Orphan photo rule was not removed'; END IF;

  BEGIN
    PERFORM public.save_checklist_template_override(
      'editor-preview-checklist','Конфликт','',saved.sections,0
    );
  EXCEPTION WHEN serialization_failure THEN
    conflict_seen := true;
  END;
  IF NOT conflict_seen THEN RAISE EXCEPTION 'Optimistic locking did not reject stale version'; END IF;

  PERFORM set_config('request.jwt.claim.sub', barista_id::text, true);
  BEGIN
    PERFORM public.save_checklist_template_override(
      'editor-preview-checklist','Запрещено','',saved.sections,1
    );
  EXCEPTION WHEN insufficient_privilege THEN
    forbidden_seen := true;
  END;
  IF NOT forbidden_seen THEN RAISE EXCEPTION 'Non-admin template edit was not rejected'; END IF;

  PERFORM set_config('request.jwt.claim.sub', admin_id::text, true);
  IF NOT public.reset_checklist_template_override('editor-preview-checklist') THEN
    RAISE EXCEPTION 'Checklist template reset returned false';
  END IF;
  IF EXISTS (SELECT 1 FROM public.checklist_template_overrides WHERE checklist_id='editor-preview-checklist') THEN
    RAISE EXCEPTION 'Checklist template override remained after reset';
  END IF;

  SELECT count(*) INTO audit_count
  FROM public.checklist_template_edits
  WHERE checklist_id='editor-preview-checklist';
  IF audit_count <> 2 THEN RAISE EXCEPTION 'Expected save and reset audit rows, got %', audit_count; END IF;

  IF has_table_privilege('authenticated','public.checklist_template_overrides','INSERT')
     OR has_table_privilege('authenticated','public.checklist_template_overrides','UPDATE')
     OR has_table_privilege('authenticated','public.checklist_template_overrides','DELETE') THEN
    RAISE EXCEPTION 'Authenticated clients must not write template overrides directly';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.save_checklist_template_override(text,text,text,jsonb,integer)',
    'EXECUTE'
  ) THEN RAISE EXCEPTION 'Authenticated role cannot call protected save RPC'; END IF;
END
$$;

DELETE FROM public.checklist_photo_rules WHERE checklist_id='editor-preview-checklist';
DELETE FROM public.checklist_template_edits WHERE checklist_id='editor-preview-checklist';
DELETE FROM public.profiles WHERE login IN ('editor-admin','editor-barista');
DELETE FROM auth.users WHERE email IN ('editor-admin@example.test','editor-barista@example.test');

SELECT 'Checklist editor database smoke passed.' AS result;
