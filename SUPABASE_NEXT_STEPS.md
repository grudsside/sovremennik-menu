# Следующие шаги в Supabase

## 1. Проверить таблицы

Supabase → Table Editor. Должны быть таблицы:

- profiles
- tasks
- checklist_submissions
- coffee_revisions
- error_reports
- schedule_events

## 2. Проверить пользователя

Supabase → Authentication → Users. Должен быть пользователь:

- grigory@sovremennik.local

## 3. Проверить профиль

Supabase → Table Editor → profiles. Должна быть строка:

- login: grigory
- name: Григорий
- role: admin
- is_active: true

## 4. Проверить Edge Function

Supabase → Edge Functions. Должна быть функция:

- admin-employees

## 5. Если вход не работает

Проверьте:

1. Пользователь `grigory@sovremennik.local` создан в Authentication.
2. Выполнен SQL-файл `STEP_2_SEED_ADMIN_AFTER_AUTH_USER.sql`.
3. В `profiles` есть строка с login `grigory` и role `admin`.
4. Сайт загружен с новым файлом `assets/js/supabase-config.js`.
