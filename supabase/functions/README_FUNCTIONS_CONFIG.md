# Настройка Edge Functions

Функцию `deadline-checker` нужно деплоить без проверки JWT, потому что ее вызывает Cron по секретному заголовку.

Команда:

```powershell
supabase functions deploy deadline-checker --use-api --no-verify-jwt
```

`notify-event` и `push-send` деплоятся обычно, с проверкой JWT.
