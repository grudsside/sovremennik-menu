# Одноразовая настройка живого Preview на Supabase Free

Для открытого тестирования используется отдельный бесплатный Supabase-проект:

- Project Ref: `enkftanmqlwvjydliwue`
- Project URL: `https://enkftanmqlwvjydliwue.supabase.co`

Production-проект `tjibbzfdughhjenumzxo` этим workflow не изменяется.

## Что делает автоматизация

После настройки секретов GitHub Actions:

1. проверяет, что Project Ref и URL указывают на отдельный preview-проект;
2. останавливается до любых изменений, если ref совпадает с production;
3. через Supabase Management API получает ключи только preview-проекта и маскирует их в журнале;
4. собирает базовую схему приложения и текущие безопасные SQL-патчи в отдельный migration bundle;
5. сначала выполняет `db push --dry-run`, затем применяет схему только к preview-проекту;
6. разворачивает `admin-employees` и `admin-maintenance` только в preview;
7. создаёт тестовые аккаунты `preview-admin`, `preview-manager`, `preview-barista`, `preview-waiter`;
8. публикует frontend в отдельный Storage bucket `open-test-preview`;
9. выполняет авторизованные smoke-тесты и восстанавливает изменённые тестовые данные;
10. сохраняет URL и отчёт как GitHub Actions artifact.

## Что не используется

- платный Supabase Branching;
- production-база и production Edge Functions;
- настоящие сотрудники и их данные;
- production-администратор `grigory`;
- GitHub Pages и ветка `main`;
- ключи, пароли или токены в файлах репозитория.

## 1. Создать Supabase Access Token

1. Открыть настройки аккаунта Supabase.
2. Перейти в **Access Tokens**.
3. Создать токен, например `sovremennik-github-preview`.
4. Скопировать значение сразу после создания.

Токен не отправлять в чат, PR, issue или файлы.

## 2. Подготовить два пароля

### Пароль базы preview

Использовать Database Password, который был задан при создании проекта `sovremennik-preview`.

Если пароль потерян, его нужно сбросить в настройках базы тестового проекта. Не использовать пароль production-базы.

### Пароль тестовых сотрудников

Создать отдельный случайный пароль длиной не менее 16 символов. Он будет использоваться только четырьмя тестовыми аккаунтами.

Не использовать пароль администратора приложения, GitHub или Supabase.

## 3. Добавить три Repository Secret в GitHub

Открыть:

`grudsside/sovremennik-menu → Settings → Secrets and variables → Actions → Secrets`

Добавить:

### `SUPABASE_ACCESS_TOKEN`

Значение: Supabase Access Token из шага 1.

### `PREVIEW_DB_PASSWORD`

Значение: Database Password отдельного проекта `sovremennik-preview`.

### `PREVIEW_TEST_PASSWORD`

Значение: отдельный сложный пароль тестовых сотрудников.

Все три значения добавлять именно в **Secrets**, не в **Variables**.

Публичный ключ и service-role/secret key проекта копировать вручную не нужно: workflow получает их через Management API, маскирует и использует только в рамках запуска.

## 4. Перезапустить workflow

Пока workflow находится в Draft PR, удобнее перезапустить уже созданный запуск:

1. Открыть вкладку **Actions**.
2. Выбрать **Supabase live preview**.
3. Открыть самый свежий запуск для PR #32.
4. Нажать **Re-run jobs**.
5. Выбрать **Re-run all jobs**.
6. Не включать debug logging.

После добавления секретов задание `Deploy dedicated Free Supabase preview` не должно быть `skipped`.

## 5. Проверить результат

Успешный запуск должен завершиться зелёной галочкой. В Summary появятся:

- URL отдельной тестовой версии;
- Project Ref `enkftanmqlwvjydliwue`;
- количество загруженных frontend-файлов;
- количество авторизованных проверок;
- подтверждение восстановления тестовых данных;
- подтверждение, что production не изменён.

Также появится artifact с именем примерно `live-preview-32`.

## Если возникла ошибка

Не запускать workflow многократно подряд. Сделать скриншот:

- названия красного шага;
- сообщения ошибки;
- верхней части страницы запуска.

Токен и пароли в чат не отправлять.

## Production gate

Даже после успешного preview PR остаётся Draft. Merge, GitHub Pages и production Supabase допускаются только после проверки тестового URL владельцем и отдельного явного подтверждения production-релиза.
