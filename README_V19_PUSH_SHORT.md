# V19 Push Notifications

Главная инструкция: `PUSH_SETUP_V19.md`.

Коротко:
1. Выполнить `supabase/sql/STEP_5_PUSH_NOTIFICATIONS.sql`.
2. Сгенерировать VAPID-ключи: `npm install web-push`, затем `node tools/generate-vapid-keys.mjs`.
3. Добавить секреты: `supabase secrets set --env-file vapid.env`.
4. Вставить VAPID_PUBLIC_KEY в `assets/js/supabase-config.js`.
5. Развернуть функции: `notify-event`, `push-send`, `deadline-checker`.
6. Настроить Cron на `deadline-checker`.
7. Загрузить сайт на GitHub Pages.
