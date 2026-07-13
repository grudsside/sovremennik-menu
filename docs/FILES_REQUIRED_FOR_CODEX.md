# Файлы и доступы для Codex

## В GitHub

```text
index.html
assets/css/styles.css
assets/js/app.js
assets/js/push.js
assets/js/supabase-config.js
data/menu.json
manifest.webmanifest
service-worker.js
assets/icons/**
assets/images/**
assets/documents/**
supabase/sql/**
supabase/functions/**
README.md
.nojekyll
```

## Добавить

```text
AGENTS.md
docs/**
```

## Проверить

- все SQL steps;
- все Edge Functions;
- `_shared/push.ts`;
- audit reports;
- PWA icons;
- Storage SQL;
- notification SQL;
- GitHub Pages settings.

## Внешний доступ владельца

- Supabase Dashboard;
- SQL Editor/schema;
- Auth users;
- Functions deployments;
- Secrets status;
- Storage;
- Cron;
- GitHub Pages.

Codex не должен получать secret values в промте.

## Не передавать

- service role;
- VAPID private;
- cron secret;
- passwords;
- JWT;
- real user dump;
- employee personal data.
