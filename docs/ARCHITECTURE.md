# Архитектура

```text
Сотрудник
   |
   v
GitHub Pages
HTML + CSS + JS + JSON + PWA
   |
   | Supabase JS / HTTPS / JWT
   v
Supabase
├─ Auth
├─ PostgreSQL
├─ RLS
├─ Storage: menu-photos
└─ Edge Functions
   ├─ admin-employees
   ├─ notify-event
   ├─ push-send
   └─ deadline-checker
```

## Frontend

### `index.html`

Каркас, PWA meta, встроенный JSON, подключение config/app/push.

### `assets/js/supabase-config.js`

Публичные client values:

- Project URL;
- publishable/anon key;
- Function URLs;
- VAPID public key;
- login domain.

Безопасность обеспечивают Auth и RLS, а не скрытие этих значений.

### `assets/js/app.js`

Авторизация, роли, UI, задачи, чек-листы, ревизии, расписание, сотрудники, контроль, отчёты, редактирование контента, API и localStorage.

### `assets/js/push.js`

Service Worker registration, Push API, подписки, preferences, test push и iPhone PWA.

### `service-worker.js`

Показывает push и открывает нужный URL. Offline-cache приложения пока нет.

## Контент

База: `data/menu.json` и embedded JSON в `index.html`.

Общие изменения:

- `menu_item_overrides`;
- `tech_card_overrides`;
- Storage `menu-photos`.

## Auth

Логин преобразуется в:

```text
<login>@sovremennik.local
```

Затем используется Supabase Auth. Роль читается из `profiles`.

## Доступ

1. frontend скрывает разделы;
2. RLS/Edge Functions защищают данные и операции.

Frontend-проверка не является защитой.

## Эволюция без смены стека

```text
assets/js/
├─ app.js
├─ auth.js
├─ api.js
├─ permissions.js
├─ tasks.js
├─ revisions.js
├─ content-editor.js
├─ reports.js
└─ push.js
```

Рефакторить по одному домену и отдельно от изменения бизнес-логики.
