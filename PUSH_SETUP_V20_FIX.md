# Исправление Push v20

Эта версия исправляет две проблемы:

1. Дублирование блока «Push на телефон» на главной странице.
2. Ошибка `Не вставлен VAPID_PUBLIC_KEY в assets/js/supabase-config.js`.

## Что сделать

1. Распакуйте архив v20.
2. Откройте файл `vapid.env`, который был создан ранее командой генерации VAPID-ключей.
3. Скопируйте значение из строки `VAPID_PUBLIC_KEY=...`.
4. В распакованной папке v20 запустите PowerShell.
5. Выполните:

```powershell
powershell -ExecutionPolicy Bypass -File .\SET_VAPID_AND_PREPARE_UPLOAD.ps1
```

6. Когда скрипт попросит ключ, вставьте только значение `VAPID_PUBLIC_KEY`, без `VAPID_PUBLIC_KEY=`.
7. Скрипт создаст папку `GITHUB_UPLOAD_READY`.
8. На GitHub загрузите содержимое папки `GITHUB_UPLOAD_READY`.

Нельзя загружать на GitHub:

- `vapid.env`
- `node_modules`
- `VAPID_PRIVATE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NOTIFICATION_CRON_SECRET`

После загрузки на GitHub подождите 2–5 минут и обновите сайт через `Ctrl + Shift + R`.
