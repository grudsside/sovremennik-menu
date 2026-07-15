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

## VAPID key rotation

Ротация VAPID-пары завершена, рабочие устройства переподписаны, временный клиентский helper удалён.

Текущие правила:

- публичный и приватный VAPID-ключи всегда меняются одной парой;
- приватный ключ хранится только в Supabase Secrets;
- обычное включение, обновление, тестирование и отключение push выполняет `assets/js/push.js`;
- временный migration helper нельзя возвращать как постоянную часть клиента;
- при следующей ротации переподписка устройств оформляется отдельным проверяемым PR и удаляется после подтверждения миграции.

## Legacy built-in admin

Legacy built-in admin и локальный token fallback удалены после проверки двух активных Supabase admin-аккаунтов и ротации пароля основного администратора.

Текущие правила:

1. вход только через Supabase Auth;
2. локальный application auth не доверяется без реальной Supabase-сессии;
3. старые application-auth ключи очищаются клиентским cleanup;
4. hardcoded admin, fallback-пароли и локальные токены нельзя возвращать;
5. admin API должен принимать только Supabase JWT.

## Active profile enforcement

Действительный Supabase JWT сам по себе не даёт права выполнять серверные операции приложения.

Для `push-send` и `notify-event` обязательны одновременно:

- действительный пользователь Supabase Auth;
- существующая строка `profiles` с тем же `id`;
- `is_active === true`;
- одна из поддерживаемых ролей: `admin`, `manager`, `barista`, `waiter`.

Деактивация профиля должна блокировать новые вызовы этих Edge Functions сразу, даже если ранее выданный JWT ещё не истёк. Ошибки поиска профиля и внутренние ошибки не должны раскрывать клиенту данные Supabase, SQL, токены или значения окружения.

## Public repository и CI

Репозиторий public. GitHub Secret Scanning и Push Protection должны оставаться включёнными.

Workflow `.github/workflows/ci.yml` запускается для pull request в `main` и после push в `main`. Он проверяет:

- синтаксис tracked JavaScript и MJS;
- корректность JSON и webmanifest;
- отсутствие legacy built-in admin-кода;
- отсутствие временного VAPID migration helper;
- отсутствие tracked environment-файлов, JWT-подобных значений, приватных ключей и Supabase secret keys;
- обязательные защитные маркеры `deadline-checker`;
- Deno format, unit tests и type-check для `deadline-checker`;
- Deno format, active-profile tests и type-check для `push-send` и `notify-event`.

Не ослаблять проверки и не добавлять исключения ради прохождения CI без отдельного обоснованного security review.

## Manager semantics

STEP_9 включает `manager` в `is_admin()` для RLS. При этом `admin-employees` разрешён только `admin`.

Это может быть правильным, но должно быть явно подтверждено и задокументировано.

## Client UUID

Клиентский UUID решает mobile INSERT, но ownership должен проверяться сервером/RLS.

## CORS

Functions используют `Access-Control-Allow-Origin: *`. Для публичного frontend это возможно только при строгой проверке JWT и ролей.

## Deadline cron authentication

`deadline-checker` разворачивается с `--no-verify-jwt` только потому, что cron обязан передавать отдельный заголовок `x-cron-secret`.

Обязательные правила:

- `NOTIFICATION_CRON_SECRET` должен быть настроен в Supabase Secrets;
- при отсутствующем или пустом секрете функция должна завершаться с ошибкой до чтения задач и отправки push;
- отсутствующий или неверный `x-cron-secret` должен отклоняться;
- принимается только точное совпадение без trim или нормализации;
- значение секрета нельзя печатать, логировать или сохранять в документах, issue и отчётах.

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
