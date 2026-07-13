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

## Задача Codex

1. перечислить все SQL-файлы без пропусков;
2. сопоставить шаги 5–6 и остальные;
3. проверить production schema;
4. заполнить ledger;
5. не запускать неизвестный patch повторно вслепую;
6. проверить идемпотентность.
