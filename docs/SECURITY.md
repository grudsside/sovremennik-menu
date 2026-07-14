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

Legacy built-in admin и локальный token fallback удалены после проверки двух активных Supabase admin-аккаунтов и ротации пароля основного администратора.

Текущие правила:

1. вход только через Supabase Auth;
2. локальный application auth не доверяется без реальной Supabase-сессии;
3. старые application-auth ключи очищаются клиентским cleanup;
4. hardcoded admin, fallback-пароли и локальные токены нельзя возвращать;
5. admin API должен принимать только Supabase JWT.

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
