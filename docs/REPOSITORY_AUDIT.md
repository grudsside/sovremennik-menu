# Аудит репозитория

Репозиторий:

```text
grudsside/sovremennik-menu
```

Видимость: public. Основная ветка: `main`.

## Стек

- статический HTML;
- CSS;
- vanilla JavaScript;
- GitHub Pages;
- Supabase JS/Auth/PostgreSQL/RLS/Storage;
- Supabase Edge Functions;
- Web Push;
- PWA.

Frontend не имеет обязательного `package.json` и build-step.

## Основные файлы

```text
index.html
assets/css/styles.css
assets/js/app.js
assets/js/push.js
assets/js/supabase-config.js
data/menu.json
manifest.webmanifest
service-worker.js
supabase/sql/**
supabase/functions/**
README.md
AUDIT_REPORT_V26.md
.nojekyll
```

## Сильные стороны

- backend-код хранится рядом с frontend;
- используется Supabase Auth;
- присутствует RLS;
- управление Auth users вынесено в Edge Function;
- `service_role` используется на сервере;
- push дедуплицируется через `notification_events`;
- устаревшие subscriptions деактивируются;
- есть SQL-патчи и audit reports;
- V26 отдельно проверял мобильные сценарии.

## Технический долг

### Монолитный `app.js`

Файл содержит более двух тысяч строк и override-блоки `v21–v26`. Последнее объявление функции побеждает предыдущее. Нельзя без тестов переносить `init()` или удалять «дубли».

### Legacy-названия

В Supabase-логике остаются:

```text
sendPayloadToSheets
legacySendPayloadToSheetsBeforeV26
GOOGLE_SCRIPT_URL
fetchJsonp
```

Apps Script отключён, но имена создают ложный контекст.

### Built-in admin

В начале `app.js` остаются login/password и локальный token fallback. Это риск. Удалять только отдельной безопасной миграцией после проверки Supabase Auth.

### Два источника контента

Полный JSON есть в `index.html` и `data/menu.json`. Нужно определить канонический источник и проверять синхронность.

### Migration state

SQL хранится как `STEP_*`, но репозиторий не показывает, что реально применено в production. Нужен migration ledger.

### Устаревший README

Главный README описывает ранние steps 1–3 и одну Edge Function, хотя проект уже V26/STEP_9 и содержит несколько Functions.

### Нет CI

Нужны проверки JS, JSON, путей, секретов, Supabase-файлов и двух menu sources.

## Противоречия для подтверждения

- STEP_4 показывал задачу исполнителю, STEP_9 также автору.
- STEP_9 считает `manager` admin-подобной ролью в RLS.
- `admin-employees` разрешает операции только `admin`.
- у расписания нет нормализованных участников.
- `coffee_revisions.revision_date` — primary key, то есть одна общая ревизия на день.
