# Публикация и откат

## Компоненты релиза

1. GitHub Pages frontend;
2. SQL patch;
3. Edge Functions;
4. cron/scheduled job.

Релиз не завершён, пока применены не все требуемые части.

## Перед релизом

Зафиксировать:

```text
frontend commit SHA
Supabase project ref
SQL files
Functions
Secrets names
cron changes
roles/tests
rollback
```

Создать backup затрагиваемых данных.

## SQL

Новый файл:

```text
supabase/sql/STEP_<N>_<DESCRIPTION>.sql
```

Требования:

- идемпотентность;
- комментарии;
- проверочный SELECT;
- отсутствие удаления данных без отдельного решения;
- описание отката.

Не переписывать уже applied patch.

## Functions

```powershell
supabase functions deploy admin-employees --use-api
supabase functions deploy notify-event --use-api
supabase functions deploy push-send --use-api
supabase functions deploy deadline-checker --use-api --no-verify-jwt
```

`--no-verify-jwt` допустим для `deadline-checker` только при обязательном `NOTIFICATION_CRON_SECRET` и проверке точного значения заголовка `x-cron-secret`. Функция должна fail closed, если секрет отсутствует или пустой.

## Cron

Проверить:

- URL deadline-checker;
- период;
- `x-cron-secret`;
- timezone;
- dedupe;
- отсутствие повторной рассылки.

После deploy `deadline-checker`, не выводя значение секрета, проверить:

- `OPTIONS` работает для CORS;
- `GET` возвращает 405;
- `POST` без заголовка возвращает 401;
- `POST` с неверным заголовком возвращает 401;
- при отсутствующем `NOTIFICATION_CRON_SECRET` функция возвращает 503 до чтения задач;
- `POST` с корректным заголовком запускает существующую проверку дедлайнов.

Никогда не записывать значение cron-секрета в логи, документы, issue или отчёты.

## Frontend

После merge проверить GitHub Pages, сделать hard refresh, проверить PWA update и установленное приложение iPhone.

## Smoke test

- вход всех ролей;
- разделы;
- задача с телефона;
- завершение;
- ошибка с телефона;
- чек-лист;
- ревизия;
- расписание;
- сотрудник;
- права;
- контент/фото;
- push;
- дедлайн;
- контроль/выгрузка.

## Откат

- frontend: revert commit/PR;
- Function: deploy предыдущую папку;
- SQL: отдельный reverse patch или backup;
- push: остановить cron/вызов notify, не удаляя subscriptions.

## Release ledger

```text
Дата:
Commit:
SQL:
Functions:
Secrets/cron:
Кто применил:
Проверка:
Откат:
```
