\set ON_ERROR_STOP on

DO $$
DECLARE
  bucket record;
BEGIN
  IF to_regclass('public.shift_handoffs') IS NULL THEN RAISE EXCEPTION 'shift_handoffs table is missing'; END IF;
  IF to_regclass('public.shift_handoff_acknowledgements') IS NULL THEN RAISE EXCEPTION 'shift_handoff_acknowledgements table is missing'; END IF;
  IF to_regclass('public.shift_handoff_photos') IS NULL THEN RAISE EXCEPTION 'shift_handoff_photos table is missing'; END IF;
  IF to_regprocedure('public.create_shift_handoff(uuid,text[],text[],text[],text[],text)') IS NULL THEN
    RAISE EXCEPTION 'create_shift_handoff RPC is missing';
  END IF;
  IF to_regprocedure('public.acknowledge_shift_handoff(uuid)') IS NULL THEN
    RAISE EXCEPTION 'acknowledge_shift_handoff RPC is missing';
  END IF;
  IF to_regprocedure('public.is_shift_handoff_barista()') IS NULL THEN
    RAISE EXCEPTION 'barista role helper is missing';
  END IF;
  IF NOT has_function_privilege('authenticated','public.create_shift_handoff(uuid,text[],text[],text[],text[],text)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated role cannot call shift handoff RPC';
  END IF;
  IF has_table_privilege('authenticated','public.shift_handoffs','INSERT')
     OR has_table_privilege('authenticated','public.shift_handoffs','UPDATE')
     OR has_table_privilege('authenticated','public.shift_handoffs','DELETE') THEN
    RAISE EXCEPTION 'authenticated clients must not write shift handoffs directly';
  END IF;
  IF NOT has_table_privilege('authenticated','public.shift_handoffs','SELECT') THEN
    RAISE EXCEPTION 'authenticated role cannot read shift handoffs through RLS';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='shift_handoff_storage_select_active'
      AND qual LIKE '%is_shift_handoff_barista%'
  ) THEN RAISE EXCEPTION 'barista-only shift handoff photo read policy is missing'; END IF;

  SELECT public,file_size_limit,allowed_mime_types INTO bucket
  FROM storage.buckets WHERE id='shift-handoff-photos';
  IF bucket IS NULL OR bucket.public OR bucket.file_size_limit <> 3145728 THEN
    RAISE EXCEPTION 'shift handoff photo bucket must be private and limited to 3 MB';
  END IF;
END
$$;

DO $$
DECLARE
  author_id constant uuid := '11111111-1111-4111-8111-111111111111';
  receiver_id constant uuid := '22222222-2222-4222-8222-222222222222';
  waiter_id constant uuid := '66666666-6666-4666-8666-666666666666';
  target_handoff_id constant uuid := '33333333-3333-4333-8333-333333333333';
  denied_handoff_id constant uuid := '77777777-7777-4777-8777-777777777777';
  photo_id constant uuid := '44444444-4444-4444-8444-444444444444';
  created public.shift_handoffs%rowtype;
  accepted public.shift_handoff_acknowledgements%rowtype;
  author_rejected boolean := false;
  waiter_ack_rejected boolean := false;
  waiter_create_rejected boolean := false;
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (author_id,'handoff-author@example.test'),
    (receiver_id,'handoff-receiver@example.test'),
    (waiter_id,'handoff-waiter@example.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles(id,login,name,role,is_active) VALUES
    (author_id,'handoff-author','Анна','barista',true),
    (receiver_id,'handoff-receiver','Иван','barista',true),
    (waiter_id,'handoff-waiter','Олег','waiter',true)
  ON CONFLICT (id) DO UPDATE SET name=excluded.name,role=excluded.role,is_active=true;

  PERFORM set_config('request.jwt.claim.sub', author_id::text, true);
  SELECT * INTO created FROM public.create_shift_handoff(
    target_handoff_id,
    ARRAY['Не разобрана поставка'],
    ARRAY['Овсяное молоко'],
    ARRAY['Правый гриндер выдаёт ошибку'],
    ARRAY['Проверить поставку сиропов'],
    ''
  );
  IF created.created_by <> author_id OR created.created_by_name <> 'Анна' OR created.created_by_role <> 'barista' THEN
    RAISE EXCEPTION 'handoff author metadata is incorrect: %', row_to_json(created);
  END IF;

  INSERT INTO public.shift_handoff_photos(id,handoff_id,storage_path,mime_type,file_size,created_by)
  VALUES (
    photo_id,target_handoff_id,
    author_id::text || '/' || target_handoff_id::text || '/' || photo_id::text || '.jpg',
    'image/jpeg',1024,author_id
  );

  BEGIN
    PERFORM public.acknowledge_shift_handoff(target_handoff_id);
  EXCEPTION WHEN insufficient_privilege THEN
    author_rejected := true;
  END;
  IF NOT author_rejected THEN RAISE EXCEPTION 'handoff author must not acknowledge own handoff'; END IF;

  PERFORM set_config('request.jwt.claim.sub', waiter_id::text, true);
  BEGIN
    PERFORM public.acknowledge_shift_handoff(target_handoff_id);
  EXCEPTION WHEN insufficient_privilege THEN
    waiter_ack_rejected := true;
  END;
  IF NOT waiter_ack_rejected THEN RAISE EXCEPTION 'waiter must not acknowledge shift handoff'; END IF;

  BEGIN
    PERFORM public.create_shift_handoff(denied_handoff_id, ARRAY['Нет доступа'], '{}', '{}', '{}', '');
  EXCEPTION WHEN insufficient_privilege THEN
    waiter_create_rejected := true;
  END;
  IF NOT waiter_create_rejected THEN RAISE EXCEPTION 'waiter must not create shift handoff'; END IF;

  PERFORM set_config('request.jwt.claim.sub', receiver_id::text, true);
  SELECT * INTO accepted FROM public.acknowledge_shift_handoff(target_handoff_id);
  IF accepted.employee_id <> receiver_id OR accepted.employee_name <> 'Иван' THEN
    RAISE EXCEPTION 'handoff acknowledgement metadata is incorrect: %', row_to_json(accepted);
  END IF;
  PERFORM public.acknowledge_shift_handoff(target_handoff_id);
  IF (
    SELECT count(*)
    FROM public.shift_handoff_acknowledgements acknowledgement
    WHERE acknowledgement.handoff_id = target_handoff_id
      AND acknowledgement.employee_id = receiver_id
  ) <> 1 THEN
    RAISE EXCEPTION 'handoff acknowledgement must be idempotent';
  END IF;

  DELETE FROM public.shift_handoffs handoff WHERE handoff.id IN (target_handoff_id, denied_handoff_id);
  DELETE FROM public.profiles profile WHERE profile.id IN (author_id,receiver_id,waiter_id);
  DELETE FROM auth.users auth_user WHERE auth_user.id IN (author_id,receiver_id,waiter_id);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END
$$;

\echo 'Shift handoff barista-only database smoke test passed.'
