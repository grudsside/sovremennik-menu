# План проверки

## Минимальный CI

```text
node --check assets/js/app.js
node --check assets/js/push.js
node --check service-worker.js
JSON parse data/menu.json
JSON parse manifest.webmanifest
проверка внутренних путей
проверка запрещённых секретов
проверка обязательных Supabase файлов
```

Добавить проверку синхронности embedded JSON и `data/menu.json`.

## Роли

Проверить `admin`, `manager`, `barista`, `waiter`, anonymous и inactive profile.

Особенно:

- управление сотрудниками;
- права ролей;
- контроль;
- редактирование контента;
- ручная ревизия;
- создание/завершение задач.

## Мобильные устройства

- Android Chrome;
- iPhone Safari;
- iPhone PWA;
- 360 px;
- плохая сеть;
- double tap;
- background/return;
- expired session.

## Задачи

- UUID;
- exact deadline;
- timezone;
- без срока;
- VIP;
- исполнитель;
- автор;
- посторонний;
- повторное завершение;
- 24h/1h/overdue;
- точный push recipient.

## Ревизии

- одна дата;
- первый день;
- пустые values;
- ноль продаж;
- 0.001 kg;
- 0.01%;
- изменение старой даты;
- роли;
- тара 0.847;
- пачка 1 kg;
- знак difference/losses.

## Push

- denied permission;
- unsupported browser;
- iPhone без Home Screen;
- повторная подписка;
- два устройства;
- отключение;
- expired subscription;
- preferences;
- duplicate event;
- self-test;
- role/manual send;
- cron secret.

## Контент

- add/edit/soft-delete;
- фото JPG/PNG/WebP;
- limit 5 MB;
- второе устройство;
- non-admin RLS;
- fallback на базовый JSON.

## Регрессия

После любого изменения проверить все основные разделы, Auth, Control, Push и PWA.
