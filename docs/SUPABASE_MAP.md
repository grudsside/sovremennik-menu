# Карта Supabase

Project ref:

```text
tjibbzfdughhjenumzxo
```

Project URL:

```text
https://tjibbzfdughhjenumzxo.supabase.co
```

## Основные таблицы

### `profiles`

```text
id, login, name, role, is_active, created_at, updated_at
```

Роли: `admin`, `manager`, `barista`, `waiter`.

### `role_permissions`

```text
role, sections[], updated_by, updated_at
```

### `tasks`

```text
id, title, description, creator_id, assignee_id, is_vip,
due_date, due_at, status, completed_at, created_at, updated_at
```

Статусы: `open`, `done`, `cancelled`.

### `checklist_submissions`

```text
id, checklist_id, checklist_title, employee_id, employee_name,
items jsonb, completed_count, total_count, percent, created_at
```

### `coffee_revisions`

```text
revision_date, employee_id, employee_name, hopper_weight,
opened_packs, write_offs, iiko_sales, checked, created_at, updated_at
```

`revision_date` — primary key.

### `coffee_revision_report`

Расчётная view:

```text
clean_hopper_weight
previous_clean_hopper_weight
total_coffee_usage
difference
losses_percent
```

Константа тары: `0.847 кг`.

```text
clean = hopper_weight - 0.847
usage = previous_clean + opened_packs - current_clean
difference = iiko_sales - write_offs - usage
losses_percent = difference / iiko_sales * 100
```

### `error_reports`

```text
id, employee_id, employee_name, message, status, created_at, updated_at
```

Статусы: `new`, `in_progress`, `done`.

### `schedule_events`

```text
id, event_date, event_type, title, description, employee_name,
source, created_by, created_at, updated_at
```

Участники не нормализованы.

## Редактирование контента

### `menu_item_overrides`

```text
item_key, image_url, storage_path, payload jsonb,
is_deleted, updated_by, updated_at
```

### `tech_card_overrides`

```text
card_key, title, category, output, technology,
ingredients jsonb, is_deleted, updated_by, updated_at
```

### Storage

Bucket:

```text
menu-photos
```

Публичное чтение, запись/изменение/удаление через admin RLS.

## Push

По коду используются:

```text
push_subscriptions
notification_preferences
notification_events
```

`notification_events` хранит адресованную сотруднику историю независимо от
настроек доставки Web Push. `read_at is null` означает непрочитанное событие;
клиент может менять только `read_at` в собственной строке. Таблица включается
в `supabase_realtime` патчем STEP 12.

Точные definitions сверить с SQL и production.

## Edge Functions

### `admin-employees`

Создание Auth user/profile, деактивация и удаление. Только `admin`.

### `notify-event`

Выбирает получателей событий.

### `push-send`

Self-test и ручная отправка. Массовая — `admin`/`manager`.

### `deadline-checker`

24h/1h/overdue для исполнителя. Может защищаться `x-cron-secret`.

### `_shared/push.ts`

JWT, admin client, VAPID, preferences, dedupe и Web Push.

## Secrets

Не хранить значения в GitHub:

```text
SUPABASE_SERVICE_ROLE_KEY
VAPID_PRIVATE_KEY
NOTIFICATION_CRON_SECRET
JWT
пароли
```

Используемые имена окружения:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
NOTIFICATION_CRON_SECRET
```
