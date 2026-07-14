# Современник — версия сайта с Supabase

Эта версия сайта больше не использует Google Sheets и Apps Script. Данные хранятся в Supabase.

## Подключение

В файле `assets/js/supabase-config.js` уже указаны данные проекта:

- Project URL: `https://tjibbzfdughhjenumzxo.supabase.co`
- Edge Function: `https://tjibbzfdughhjenumzxo.supabase.co/functions/v1/admin-employees`

Важно: пользовательская ссылка вида `https://supabase.com/dashboard/project/...` — это ссылка на панель управления, а для сайта нужен API URL вида `https://PROJECT_REF.supabase.co`.

## Что нужно проверить перед загрузкой на GitHub

1. В Supabase SQL Editor выполнены SQL-файлы:
   - `supabase/sql/STEP_1_SCHEMA_AND_POLICIES.sql`
   - после создания Auth пользователя — `supabase/sql/STEP_2_SEED_ADMIN_AFTER_AUTH_USER.sql`
   - при необходимости — `supabase/sql/STEP_3_OPTIONAL_JULY_SCHEDULE.sql`
2. В Authentication создан пользователь:
   - email: `grigory@sovremennik.local`
   - password: задайте уникальный временный пароль вне Git и смените его после первого входа
3. Edge Function `admin-employees` развернута и видна в Supabase → Edge Functions.
4. Secret `SUPABASE_SERVICE_ROLE_KEY` добавлен в Edge Functions → Secrets.

## Как загрузить сайт на GitHub Pages

Распакуйте архив и загрузите содержимое папки в корень репозитория GitHub Pages.
В корне должны лежать:

- `index.html`
- `assets/`
- `data/`
- `supabase/`
- `README.md`
- `.nojekyll`

## Как входить

На сайте вводите не email, а обычный логин:

- логин: `grigory`
- пароль: используйте текущий пароль из Supabase Auth; временные пароли не хранятся в Git

Сайт сам превратит логин в служебный email `grigory@sovremennik.local`.

## Что теперь хранится в Supabase

- сотрудники и роли — таблица `profiles` + Supabase Auth;
- задачи — `tasks`;
- чек-листы — `checklist_submissions`;
- ревизия кофе — `coffee_revisions` и view `coffee_revision_report`;
- сообщения об ошибках — `error_reports`;
- расписание — `schedule_events`.

## Важное ограничение по паролям

Supabase не позволяет читать реальные пароли пользователей обратно из базы — это нормально и безопасно. В таблице сотрудников сайт показывает логин и роль, но пароль не должен использоваться как обычное поле базы.
