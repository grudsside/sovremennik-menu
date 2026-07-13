# Безопасность

## Публичные client values

Допустимы в frontend:

- Supabase Project URL;
- anon/publishable key;
- VAPID public key;
- URL Edge Functions.

Они не заменяют RLS.

## Секреты

Не коммить:

```text
SUPABASE_SERVICE_ROLE_KEY
VAPID_PRIVATE_KEY
NOTIFICATION_CRON_SECRET
JWT
пароли
дампы Auth
```

## Legacy built-in admin

В `app.js` остаются встроенные credentials и локальный token fallback.

Безопасная миграция:

1. подтвердить рабочий Supabase Auth admin;
2. создать второго резервного admin;
3. проверить вход на нескольких устройствах;
4. удалить fallback;
5. сменить старый пароль;
6. очистить legacy localStorage;
7. убедиться, что admin API принимает только Supabase JWT.

Не удалять fallback в PR документации или одновременно с другой функцией.

## Public repository

Репозиторий public. Добавить автоматическую secret scan.

## Manager semantics

STEP_9 включает `manager` в `is_admin()` для RLS. При этом `admin-employees` разрешён только `admin`.

Это может быть правильным, но должно быть явно подтверждено и задокументировано.

## Client UUID

Клиентский UUID решает mobile INSERT, но ownership должен проверяться сервером/RLS.

## CORS

Functions используют `Access-Control-Allow-Origin: *`. Для публичного frontend это возможно только при строгой проверке JWT и ролей.

## Обязательные проверки

- JWT;
- active profile;
- role;
- input validation;
- отсутствие утечки service role;
- безопасные ошибки;
- идемпотентность;
- отсутствие случайной массовой рассылки.

## Пароли

Supabase Auth не возвращает существующий пароль. Интерфейс должен поддерживать создание временного пароля, сброс, смену и деактивацию, но не показ текущего пароля.
