# V26: мобильные задачи, ошибки и точечные уведомления

## Обязательные действия

### 1. Supabase SQL

Выполните в Supabase SQL Editor файл:

`supabase/sql/STEP_9_MOBILE_TASKS_ERRORS_NOTIFICATIONS.sql`

### 2. Edge Functions

Скопируйте обновленные папки из архива в локальный Supabase-проект:

- `supabase/functions/notify-event`
- `supabase/functions/deadline-checker`

Затем выполните:

```powershell
supabase functions deploy notify-event --use-api
supabase functions deploy deadline-checker --use-api --no-verify-jwt
```

Если `--no-verify-jwt` не сработает, выполните вторую команду без него и проверьте настройки функции в Supabase.

### 3. GitHub Pages

Загрузите содержимое архива в корень репозитория GitHub Pages.

После деплоя откройте сайт и нажмите:

`Ctrl + Shift + R`

## Проверка

1. С телефона войдите в сервис.
2. Создайте задачу на конкретного сотрудника.
3. Проверьте, что задача сохраняется.
4. Проверьте, что push приходит только назначенному сотруднику.
5. С телефона отправьте сообщение об ошибке.
6. Проверьте, что сообщение появилось в `Контроль → Ошибки`.
