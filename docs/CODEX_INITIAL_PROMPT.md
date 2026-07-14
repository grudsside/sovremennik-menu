# Стартовый промт для Codex

Ты принимаешь разработку внутреннего веб-приложения «Современник» для сотрудников кофейни.

Правильный репозиторий:

```text
grudsside/sovremennik-menu
```

Актуальная архитектура использует **Supabase**. Google Apps Script и Google Sheets больше не используются и не должны возвращаться в проект.

## Цель

Продолжать развитие без потери контекста, не сломать production и постепенно сделать проект воспроизводимым и понятным.

## Перед любыми изменениями

1. Прочитай `AGENTS.md`.
2. Прочитай все документы в `docs/`.
3. Изучи полное дерево репозитория.
4. Изучи последние commits и audit reports.
5. Перечисли все `supabase/sql/` в порядке steps.
6. Перечисли все `supabase/functions/`.
7. Изучи `app.js`, `push.js`, config, Service Worker, manifest, index и menu JSON.
8. Пока не меняй production-код.

## Что известно

Текущая линия — V26.

Реализованы:

- admin/manager/barista/waiter;
- section permissions;
- задачи с VIP и exact deadline;
- чек-листы;
- ревизия кофе;
- расписание;
- ошибки;
- сотрудники;
- контроль/отчёты;
- редактирование методички/техкарт;
- фото;
- PWA;
- Web Push;
- Edge Functions.

V26 исправлял мобильные задачи, мобильные ошибки, RLS и точечных получателей push.

## Риски

1. `app.js` — монолит и overrides `v21–v26`.
2. Legacy Google/Sheets names остались.
3. Не возвращать удалённый built-in admin и local token fallback.
4. Menu JSON дублируется.
5. README отстаёт.
6. SQL file не равен applied migration.
7. Function file не равен deployed Function.
8. Manager имеет admin-подобный RLS, но не управляет users.
9. У расписания нет участников.
10. Рефакторинг нельзя смешивать с новой функцией.

## Первый ответ владельцу

Верни четыре раздела:

### 1. Как понял проект

Назначение, пользователи, функции, архитектура.

### 2. Что обнаружено

Frontend, таблицы, Storage, Functions, SQL, PWA/push, версия, расхождения.

### 3. Риски

Удалённый built-in admin не возвращать; проверить migrations, deployments, overrides, RLS, menu sources, cron, public repo/secrets.

### 4. Вопросы

Только существенные. Начни с production URL, applied SQL, deployed Functions, cron, manager, подтверждения отсутствия built-in fallback и следующего приоритета.

Ты можешь и должен задавать дополнительные вопросы, если ответ влияет на бизнес-логику, данные, роли, RLS, безопасность, миграцию, уведомления или публикацию.

Для мелких обратимых деталей выбери вариант и назови допущение.

## Первая техническая задача после ответов

PR `Codex handoff and production baseline`:

1. актуализировать README;
2. добавить/проверить AGENTS и docs;
3. заполнить migration ledger;
4. зафиксировать deployed Functions;
5. добавить минимальный CI;
6. добавить secret scanning;
7. проверить два menu sources;
8. не менять бизнес-логику;
9. не возвращать built-in admin;
10. дать проверку и откат.

## Правила

- русский и простой язык;
- не додумывать бизнес-правила;
- не возвращать Apps Script;
- не коммить secrets;
- не использовать service role в браузере;
- права через RLS/Functions;
- новый идемпотентный SQL patch;
- отдельная ветка;
- один PR — одна задача;
- не смешивать рефакторинг и функцию;
- проверять phone/PWA/roles;
- в конце: изменения, файлы, SQL, Functions, тесты, ручные действия, откат, риски.

Главная задача передачи — однозначно связать GitHub version, Supabase schema, deployed Functions, Secrets и cron.
