# PUSH_SETUP_V19.md

# Установка Push-уведомлений для сайта «Современник»

В этой версии добавлены расширенные уведомления:

- новая задача;
- VIP-задача;
- дедлайн задачи за 24 часа;
- дедлайн задачи за 1 час;
- просроченная задача;
- завершенная задача;
- отправленный чек-лист;
- отправленная ревизия кофе;
- сообщение об ошибке;
- новое событие в расписании;
- настройки типов уведомлений для каждого сотрудника.

## 0. Что важно понимать

Сайт остается на GitHub Pages. Данные остаются в Supabase. Уведомления отправляются через Supabase Edge Functions.

На iPhone уведомления работают только если сотрудник добавил сайт на экран «Домой», открыл сайт с иконки и уже там нажал «Включить уведомления».

## 1. Выполнить SQL

Открой Supabase → SQL Editor → New query.

Открой файл:

```text
supabase/sql/STEP_5_PUSH_NOTIFICATIONS.sql
```

Скопируй весь текст из файла, вставь в SQL Editor и нажми Run.

После выполнения в Table Editor должны появиться таблицы:

```text
push_subscriptions
notification_preferences
notification_events
```

## 2. Сгенерировать VAPID-ключи

Открой PowerShell в папке с распакованным архивом v19.

Выполни:

```powershell
npm install web-push
node tools/generate-vapid-keys.mjs
```

Появится файл:

```text
vapid.env
```

Внутри будет:

```text
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:...
NOTIFICATION_CRON_SECRET=...
```

Файл `vapid.env` нельзя загружать в GitHub. Он содержит приватный ключ.

## 3. Добавить секреты в Supabase

В PowerShell, в той же папке, выполни:

```powershell
supabase secrets set --env-file vapid.env
```

Проверь:

```powershell
supabase secrets list
```

В списке должны быть:

```text
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
NOTIFICATION_CRON_SECRET
SUPABASE_SERVICE_ROLE_KEY
```

Если `SUPABASE_SERVICE_ROLE_KEY` уже был добавлен раньше — повторно добавлять его не нужно.

## 4. Вставить публичный VAPID-ключ в сайт

Открой файл:

```text
assets/js/supabase-config.js
```

Найди строку:

```js
vapidPublicKey: 'PASTE_VAPID_PUBLIC_KEY_HERE',
```

Замени `PASTE_VAPID_PUBLIC_KEY_HERE` на значение `VAPID_PUBLIC_KEY` из файла `vapid.env`.

Пример:

```js
vapidPublicKey: 'BAbcdefg...',
```

Важно: в сайт вставляется только `VAPID_PUBLIC_KEY`. Приватный ключ в сайт не вставлять.

## 5. Скопировать функции в локальный Supabase-проект

Если у тебя уже есть локальная папка, где ты делал `supabase init`, открой ее. Например:

```text
C:\Users\Grigorij\sovremennik-supabase
```

Из архива v19 скопируй папки:

```text
supabase/functions/_shared
supabase/functions/notify-event
supabase/functions/push-send
supabase/functions/deadline-checker
```

В свою локальную папку:

```text
C:\Users\Grigorij\sovremennik-supabase\supabase\functions\
```

В итоге должны быть пути:

```text
C:\Users\Grigorij\sovremennik-supabase\supabase\functions\_shared\push.ts
C:\Users\Grigorij\sovremennik-supabase\supabase\functions\notify-event\index.ts
C:\Users\Grigorij\sovremennik-supabase\supabase\functions\push-send\index.ts
C:\Users\Grigorij\sovremennik-supabase\supabase\functions\deadline-checker\index.ts
```

## 6. Развернуть функции

Открой PowerShell в локальной папке Supabase-проекта:

```powershell
cd C:\Users\Grigorij\sovremennik-supabase
```

Проверь связь с проектом:

```powershell
supabase status
```

Если проект не привязан, выполни:

```powershell
supabase link --project-ref tjibbzfdughhjenumzxo
```

Деплой функций:

```powershell
supabase functions deploy notify-event --use-api
supabase functions deploy push-send --use-api
supabase functions deploy deadline-checker --use-api --no-verify-jwt
```

Если `--no-verify-jwt` не поддерживается твоей версией CLI, открой Supabase Dashboard → Edge Functions → deadline-checker → Settings и выключи проверку JWT для этой функции.

## 7. Настроить Cron для дедлайнов

Cron нужен, чтобы Supabase сам проверял дедлайны и отправлял уведомления за 24 часа, за 1 час и по просрочке.

Открой Supabase → Integrations → Cron.

Создай Job:

```text
Name: deadline-checker
Schedule: */15 * * * *
Method: POST
URL: https://tjibbzfdughhjenumzxo.supabase.co/functions/v1/deadline-checker
Header: x-cron-secret
Value: значение NOTIFICATION_CRON_SECRET из vapid.env
```

Расписание `*/15 * * * *` значит: запускать каждые 15 минут.

## 8. Загрузить сайт на GitHub

Загрузи содержимое архива v19 в корень репозитория GitHub Pages.

Важно: загружать не папку целиком, а файлы внутри нее:

```text
index.html
manifest.webmanifest
service-worker.js
assets
supabase
...
```

После загрузки подожди 2–5 минут и сделай жесткое обновление сайта:

```text
Ctrl + Shift + R
```

## 9. Включить уведомления на телефоне

### Android

1. Открыть сайт в Chrome.
2. Войти в аккаунт.
3. На главной странице нажать «Включить уведомления».
4. Разрешить уведомления.
5. Нажать «Тест».

### iPhone

1. Открыть сайт в Safari.
2. Нажать «Поделиться».
3. Выбрать «На экран Домой».
4. Нажать «Добавить».
5. Открыть сайт с новой иконки на экране iPhone.
6. Войти в аккаунт.
7. Нажать «Включить уведомления».
8. Разрешить уведомления.
9. Нажать «Тест».

## 10. Проверка

1. Войти под Supabase Auth-администратором. Пароли не хранятся в Git.
2. Включить уведомления.
3. Нажать «Тест».
4. Создать задачу на себя.
5. Должно прийти уведомление «Новая задача».
6. Создать VIP-задачу.
7. Должно прийти уведомление «VIP-задача».
8. Отправить чек-лист с аккаунта сотрудника.
9. Администратор и руководитель должны получить уведомление.

## Частые ошибки

### На сайте написано «Не вставлен VAPID_PUBLIC_KEY»

Ты не заменил `PASTE_VAPID_PUBLIC_KEY_HERE` в `assets/js/supabase-config.js`.

### На iPhone нет кнопки разрешения уведомлений

Сайт открыт в Safari как обычная страница. Нужно добавить сайт на экран «Домой» и открыть с иконки.

### Тест не приходит

Проверь:

- SQL-файл выполнен;
- `VAPID_PUBLIC_KEY` вставлен в сайт;
- `VAPID_PRIVATE_KEY` добавлен в Supabase Secrets;
- функции `push-send`, `notify-event`, `deadline-checker` развернуты;
- сайт открыт по HTTPS;
- уведомления разрешены в настройках телефона.

### Дедлайны не приходят

Проверь Cron Job и секрет `x-cron-secret`.
