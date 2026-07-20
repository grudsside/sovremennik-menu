# Одноразовая настройка живого Supabase Preview

Эта настройка нужна один раз. После неё Pull Request сможет автоматически создавать отдельное тестовое окружение с собственной базой, Auth, Edge Functions и URL приложения.

## Что не используется

- production-база не изменяется;
- production Edge Functions не обновляются;
- данные сотрудников из production не копируются;
- GitHub Pages и ветка `main` не изменяются;
- секретные значения не записываются в файлы репозитория и комментарии PR.

## 1. Создать Supabase Access Token

1. Открыть настройки аккаунта Supabase.
2. Перейти в раздел **Access Tokens**.
3. Создать новый токен, например с названием `sovremennik-github-preview`.
4. Скопировать значение сразу после создания.

Токен даёт GitHub Actions право создать изолированную Supabase Branch и развернуть в ней функции. Не публикуйте его в чате, PR, issue или файле.

## 2. Добавить секреты в GitHub

Открыть репозиторий:

`Settings → Secrets and variables → Actions → New repository secret`

Добавить два Repository Secret:

### `SUPABASE_ACCESS_TOKEN`

Значение: Supabase Access Token из предыдущего шага.

### `PREVIEW_TEST_PASSWORD`

Значение: отдельный сложный пароль только для четырёх тестовых аккаунтов preview.

Требования:

- не использовать текущий production-пароль;
- не использовать пароль администратора приложения;
- рекомендуемая длина — не менее 16 символов;
- пароль хранится только в GitHub Actions Secrets.

## 3. Запустить workflow

После добавления обоих секретов:

1. Открыть вкладку **Actions** в репозитории.
2. Выбрать **Supabase live preview**.
3. Нажать **Run workflow**.
4. Выбрать ветку `feat/open-test-admin-controls-20260720`.
5. Поле имени Supabase-ветки оставить пустым.
6. Нажать **Run workflow**.

Workflow автоматически:

1. создаст или переиспользует data-less ветку `preview-pr-32`;
2. проверит, что Project Ref не совпадает с production;
3. применит миграцию технического режима;
4. развернёт `admin-employees` и `admin-maintenance`;
5. создаст тестовые аккаунты `preview-admin`, `preview-manager`, `preview-barista`, `preview-waiter`;
6. опубликует приложение в отдельном публичном Storage bucket тестовой ветки;
7. выполнит авторизованные smoke-тесты;
8. восстановит изменённые тестовые роль и состояние раздела;
9. сохранит URL и отчёт как GitHub Actions artifact.

## Защита от production-деплоя

Workflow завершится ошибкой до миграции и функций, если полученный preview Project Ref совпадёт с production Project Ref `tjibbzfdughhjenumzxo`.

Production-релиз остаётся отдельным действием и не выполняется этим workflow.
