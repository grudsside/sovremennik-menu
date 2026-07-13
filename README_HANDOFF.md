# Передача проекта «Современник» в Codex

Дата подготовки: 13 июля 2026 года.

Правильный репозиторий:

```text
grudsside/sovremennik-menu
```

Проект использует **Supabase**. Google Apps Script и Google Sheets больше не являются частью актуальной архитектуры.

## Как использовать пакет

1. Откройте `grudsside/sovremennik-menu` в Codex.
2. Добавьте в корень репозитория `AGENTS.md`.
3. Добавьте папку `docs/`.
4. Вставьте в новый диалог Codex текст из `docs/CODEX_INITIAL_PROMPT.md`.
5. Первой задачей должен быть аудит точного production-состояния, а не новая функция.

## Главное правило

Код в GitHub — источник исходников. Фактическое production-состояние Supabase нужно подтвердить отдельно:

- какие SQL-патчи выполнены;
- какие Edge Functions развернуты;
- какие Secrets настроены;
- настроен ли `deadline-checker`;
- совпадает ли GitHub Pages с веткой `main`.
