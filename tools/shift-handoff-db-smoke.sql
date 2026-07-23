\set ON_ERROR_STOP on

DO $$
DECLARE
  bucket record;
BEGIN
  IF to_regclass('public.shift_handoffs') IS NULL THEN RAISE EXCEPTION 'shift_handoffs table is missing'; END IF;
  IF to_regclass('public.shift_handoff_acknowledgements') IS NULL THEN RAISE EXCEPTION 'shift_handoff_acknowledgements table is missing'; END IF;
  IF to_regclass('public.shift_handoff_photos') IS NULL THEN RAISE EXCEPTION 'shift_handoff_photos table is missing'; END IF;
  IF to_regprocedure('public.create_shift_handoff(uuid,text[],text[],text[],text[],text)') IS NULL THEN RAISE EXCEPTION 'create_shift_handoff RPC is missing'; END IF;
  IF to_regprocedure('public.acknowledge_shift_handoff(uuid)') IS NULL THEN RAISE EXCEPTION 'acknowledge_shift_handoff RPC is missing'; END IF;
  IF to_regprocedure('public.is_shift_handoff_user()') IS NULL THEN RAISE EXCEPTION 'shift handoff role helper is missing'; END IF;
  IF NOT has_function_privilege('authenticated','public.create_shift_handoff(uuid,text[],text[],text[],text[],text)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated role cannot call shift handoff RPC';
  END IF;
  IF has_table_privilege('authenticated','public.shift_handoffs','INSERT')
     OR has_table_privilege('authenticated','public.shift_handoffs','UPDATE')
     OR has_table_privilege('authenticated','public.shift_handoffs','DELETE') THEN
    RAISE EXCEPTION 'authenticated clients must not write shift handoffs directly';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='shift_handoff_storage_select_active'
      AND qual LIKE '%is_shift_handoff_user%'
  ) THEN RAISE EXCEPTION 'admin/barista shift handoff photo read policy is missing'; END IF;

  SELECT public,file_size_limit,allowed_mime_types INTO bucket
  FROM storage.buckets WHERE id='shift-handoff-photos';
  IF bucket IS NULL OR bucket.public OR bucket.file_size_limit <> 3145728 THEN
    RAISE EXCEPTION 'shift handoff photo bucket must be private and limited to 3 MB';
  END IF;
END
$$;

DO $$
DECLARE
  barista_id constant uuid := '11111111-1111-4111-8111-111111111111';
  admin_id constant uuid := '22222222-2222-4222-8222-222222222222';
  waiter_id constant uuid := '66666666-6666-4666-8666-666666666666';
  first_id constant uuid := '33333333-3333-4333-8333-333333333333';
  second_id constant uuid := '77777777-7777-4777-8777-777777777777';
  denied_id constant uuid := '88888888-8888-4888-8888-888888888888';
  photo_id constant uuid := '44444444-4444-4444-8444-444444444444';
  created public.shift_handoffs%rowtype;
  replacement public.shift_handoffs%rowtype;
  accepted public.shift_handoff_acknowledgements%rowtype;
  author_rejected boolean := false;
  waiter_ack_rejected boolean := false;
  waiter_create_rejected boolean := false;
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (barista_id,'handoff-barista@example.test'),
    (admin_id,'handoff-admin@example.test'),
    (waiter_id,'handoff-waiter@example.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles(id,login,name,role,is_active) VALUES
    (barista_id,'handoff-barista','Анна','barista',true),
    (admin_id,'handoff-admin','Администратор','admin',true),
    (waiter_id,'handoff-waiter','Олег','waiter',true)
  ON CONFLICT (id) DO UPDATE SET name=excluded.name,role=excluded.role,is_active=true;

  PERFORM set_config('request.jwt.claim.sub', barista_id::text, true);
  IF NOT public.is_shift_handoff_user() THEN RAISE EXCEPTION 'barista must have shift handoff access'; END IF;
  SELECT * INTO created FROM public.create_shift_handoff(
    first_id,
    ARRAY['Не разобрана поставка'],
    ARRAY['Овсяное молоко'],
    '{}',
    ARRAY['Проверить поставку'],
    ''
  );
  IF created.created_by <> barista_id OR created.created_by_role <> 'barista' THEN
    RAISE EXCEPTION 'barista handoff metadata is incorrect: %', row_to_json(created);
  END IF;
  IF extract(year from created.visible_until) <> 9999 THEN
    RAISE EXCEPTION 'current handoff must stay visible until replacement: %', created.visible_until;
  END IF;

  INSERT INTO public.shift_handoff_photos(id,handoff_id,storage_path,mime_type,file_size,created_by)
  VALUES (photo_id,first_id,barista_id::text || '/' || first_id::text || '/' || photo_id::text || '.jpg','image/jpeg',1024,barista_id);

  BEGIN
    PERFORM public.acknowledge_shift_handoff(first_id);
  EXCEPTION WHEN insufficient_privilege THEN
    author_rejected := true;
  END;
  IF NOT author_rejected THEN RAISE EXCEPTION 'handoff author must not acknowledge own handoff'; END IF;

  PERFORM set_config('request.jwt.claim.sub', admin_id::text, true);
  IF NOT public.is_shift_handoff_user() THEN RAISE EXCEPTION 'administrator must have unrestricted shift handoff access'; END IF;
  SELECT * INTO accepted FROM public.acknowledge_shift_handoff(first_id);
  IF accepted.employee_id <> admin_id OR accepted.employee_name <> 'Администратор' THEN
    RAISE EXCEPTION 'administrator acknowledgement metadata is incorrect: %', row_to_json(accepted);
  END IF;

  SELECT * INTO replacement FROM public.create_shift_handoff(second_id, '{}', '{}', '{}', '{}', 'Замечаний нет');
  IF replacement.created_by <> admin_id OR replacement.created_by_role <> 'admin' THEN
    RAISE EXCEPTION 'administrator must be able to create shift handoff: %', row_to_json(replacement);
  END IF;
  IF extract(year from replacement.visible_until) <> 9999 THEN
    RAISE EXCEPTION 'replacement handoff must remain visible until the next closing checklist';
  END IF;
  IF (SELECT visible_until FROM public.shift_handoffs WHERE id=first_id) > now() THEN
    RAISE EXCEPTION 'previous handoff must disappear when the next closing checklist creates a replacement';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', waiter_id::text, true);
  IF public.is_shift_handoff_user() THEN RAISE EXCEPTION 'waiter must not have shift handoff access'; END IF;
  BEGIN
    PERFORM public.acknowledge_shift_handoff(second_id);
  EXCEPTION WHEN insufficient_privilege THEN
    waiter_ack_rejected := true;
  END;
  IF NOT waiter_ack_rejected THEN RAISE EXCEPTION 'waiter must not acknowledge shift handoff'; END IF;

  BEGIN
    PERFORM public.create_shift_handoff(denied_id, ARRAY['Нет доступа'], '{}', '{}', '{}', '');
  EXCEPTION WHEN insufficient_privilege THEN
    waiter_create_rejected := true;
  END;
  IF NOT waiter_create_rejected THEN RAISE EXCEPTION 'waiter must not create shift handoff'; END IF;

  DELETE FROM public.shift_handoffs WHERE id IN (first_id,second_id,denied_id);
  DELETE FROM public.profiles WHERE id IN (barista_id,admin_id,waiter_id);
  DELETE FROM auth.users WHERE id IN (barista_id,admin_id,waiter_id);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END
$$;

\echo 'Shift handoff admin access and replacement lifecycle database smoke test passed.'
