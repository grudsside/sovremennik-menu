# Supabase migration ledger

Заполнить на основании production.

| Порядок | SQL-файл | Статус | Дата | Project ref | Кто | Проверка | Примечание |
|---:|---|---|---|---|---|---|---|
| 1 | `STEP_1_SCHEMA_AND_POLICIES.sql` | неизвестно |  | `tjibbzfdughhjenumzxo` |  |  |  |
| 2 | `STEP_2_SEED_ADMIN_AFTER_AUTH_USER.sql` | неизвестно |  |  |  |  |  |
| 3 | `STEP_3_OPTIONAL_JULY_SCHEDULE.sql` | неизвестно |  |  |  |  | optional |
| 4 | `STEP_4_PATCH_ROLES_PERMISSIONS_TASKS.sql` | неизвестно |  |  |  |  | manager/permissions/due_at |
| 7 | `STEP_7_FIX_RLS_CONTENT_SYNC.sql` | неизвестно |  |  |  |  | content/storage |
| 8 | `STEP_8_CONTENT_EDITING_METHOD_TECH.sql` | неизвестно |  |  |  |  | content editing |
| 9 | `STEP_9_MOBILE_TASKS_ERRORS_NOTIFICATIONS.sql` | неизвестно |  |  |  |  | V26 |
| 12 | `STEP_12_NOTIFICATION_HISTORY.sql` | применён | 2026-07-18 | `tjibbzfdughhjenumzxo` | Codex по команде владельца | backup, backfill, RLS, privileges, index, Realtime | история уведомлений сотрудников |

## Релиз STEP 12 — история уведомлений

- Дата публикации frontend: 2026-07-18 14:39:19 МСК.
- Production: <https://grudsside.github.io/sovremennik-menu/>.
- Frontend commit: `45e2800a2978c928e5de3336ae5d473af1a06cd6` (`Add employee notification history (#13)`).
- SQL: `STEP_12_NOTIFICATION_HISTORY.sql` применён после резервной копии `notification_events`; старые строки получили `read_at`, новые строки сохраняют статус прочтения отдельно.
- Functions: `notify-event` v10 ACTIVE, `push-send` v8 ACTIVE, `deadline-checker` v8 ACTIVE.
- Secrets/cron: новые секреты не добавлялись; значения существующих секретов не фиксировались; конфигурация `deadline-checker` сохранена.
- Проверки: GitHub Actions и GitHub Pages завершились успешно; опубликованные HTML, JS, CSS, manifest, service worker и иконки отвечают HTTP 200 и совпадают с release source; Supabase Auth health отвечает 200; анонимный доступ к истории и вызовы защищённых Functions без JWT отвечают 401.
- PWA: опубликованные service worker и manifest совпадают с release source; service worker использует `skipWaiting()` и `clients.claim()` и не перехватывает `fetch`, поэтому отдельного app-shell кэша для очистки нет.
- Принятый остаточный риск: владелец разрешил релиз без полного ручного подтверждения `preference_disabled`, `no_subscription`, живой Realtime-доставки в открытой панели и живого изменения счётчика. Автоматизация вынесена в GitHub issue #14.
- Откат frontend: revert commit `45e2800a2978c928e5de3336ae5d473af1a06cd6` с последующей проверкой GitHub Pages. Backend STEP 12 и `read_at` не откатывать без отдельной необходимости; SQL rollback не удаляет историю и колонку `read_at`.
- Временный DPAPI-файл после релиза отсутствует.

## Задача Codex

1. перечислить все SQL-файлы без пропусков;
2. сопоставить шаги 5–6 и остальные;
3. проверить production schema;
4. заполнить ledger;
5. не запускать неизвестный patch повторно вслепую;
6. проверить идемпотентность.
