# Control v4 — аудит и план замены

Дата: 30.07.2026

## Наблюдаемая ошибка на iPhone

На записи `IMG_6719.MP4` элементы получают визуальное состояние нажатия, но действие не завершается:

- фильтр «Официанты» не становится активным;
- группы дней и карточки отчётов не раскрываются;
- прокрутка страницы продолжает работать.

Это указывает не на размер touch-target, а на конфликт жизненного цикла событий и DOM: касание начинается, однако результирующий `click` либо перехватывается, либо применяется к узлу, который был заменён до завершения жеста.

## Карта текущих конфликтов

### Рендер раздела «Контроль»

Одновременно участвуют:

1. базовые `renderControl`, `setControlTab`, `refreshControl` из `app.js`;
2. `checklist-photo-reports.js`, который заменяет `renderControlRecordsTable`, `loadControlRecords`, `refreshControl`, `setControlTab`, `renderApp`;
3. `checklist-review-tools.js`, который повторно оборачивает `loadControlRecords`, `refreshControl`, `renderApp` и дополнительно изменяет DOM через `MutationObserver`;
4. `attestations-preview.js`, который ещё раз оборачивает `renderApp`, `setControlTab`, `refreshControl` и внедряет собственную вкладку;
5. `control-v3.js`, который снова заменяет `renderControl`, `refreshControl`, `setControlTab`, `renderApp` и использует capture-обработчик со `stopImmediatePropagation`;
6. `control-v3-regression-fix.js`, который дополнительно перехватывает фильтры и раскрытие отчётов;
7. несколько модулей улучшения фото, которые слушают `click`, `toggle`, `pointer*` и мутации документа.

Итог: фактический владелец интерфейса зависит от порядка загрузки и момента авторизации.

### Отправка чек-листа

Функция последовательно переопределяется:

1. `app.js: submitChecklist`;
2. `checklist-photo-reports.js: submitPhotoChecklist`;
3. `offline-sync.js: submitOfflineAware`;
4. `checklist-photo-draft-fix.js: wrapped`;
5. `control-v3-regression-fix.js: oneShotSubmit`.

Каждый слой хранит собственное состояние и по-разному решает, была ли отправка завершена.

### Черновики и очередь

Используются одновременно:

- in-memory `Map` в `checklist-photo-reports.js`;
- IndexedDB `sovremennik-offline-v1/checklistDrafts`;
- IndexedDB `sovremennik-offline-v1/submissionQueue`;
- IndexedDB `sovremennik-checklist-photo-drafts-v1/photoDrafts`;
- временные receipts в `localStorage` из regression hotfix.

После успешной отправки один слой может очиститься, а другой — восстановить прежние фотографии или галочки.

## Решение Control v4

### Один владелец

`Control v4` становится единственным владельцем:

- раздела «Контроль»;
- загрузки чек-листов, фотографий, комментариев и ревизий;
- фильтра подразделения;
- раскрытия групп и отчётов;
- просмотра фотографий;
- комментариев и удаления;
- фото-правил;
- черновиков, очереди и отправки чек-листов.

Старые модули не будут загружаться в preview:

- `checklist-photo-reports.js`;
- `offline-sync.js`;
- `checklist-review-observer-guard.js`;
- `checklist-review-tools.js`;
- `checklist-photo-draft-fix.js`;
- `control-v3-core.js`;
- `control-v3.js`;
- `control-v3-regression-fix.js`.

Файлы временно остаются в репозитории для безопасного отката, но не участвуют в работе приложения.

### Единое локальное хранилище

База: `sovremennik-control-v4`

Stores:

- `drafts`: один черновик на пользователя и чек-лист;
- `queue`: одна запись на `submissionId`.

Черновик содержит:

- `submissionId`;
- `userId`;
- `checklistId`;
- `employeeName`;
- пункты;
- фотографии Blob;
- статус;
- даты создания и изменения.

Статусы: `draft`, `submitting`, `pending`, `failed`.

После первого нажатия создаётся запись очереди с тем же `submissionId`, черновик удаляется, форма очищается. Повторное нажатие не может создать второй идентификатор.

### Идемпотентность

- `submissionId` создаётся один раз и сохраняется в черновике;
- очередь использует `submissionId` как ключ;
- `checklist_submissions.id` получает тот же UUID;
- повторная вставка считается безопасным подтверждением существующей записи;
- пути фото детерминированы по `submissionId`, `itemKey`, `photoIndex`;
- перед вставкой metadata выполняется проверка существующей фотографии.

### Мобильная модель событий

- никаких `<details>/<summary>` в журнале Control;
- вкладки, фильтры, дни и отчёты — обычные `<button type="button">`;
- один bubbling `click`-обработчик на корневом контейнере;
- нет capture-обработчиков и `stopImmediatePropagation`;
- нажатия меняют `hidden`/`aria-expanded` без перерисовки всего раздела;
- DOM активного элемента не заменяется во время жеста.

### Тестирование

Обязательные проверки:

- Chromium desktop;
- Chromium mobile viewport;
- WebKit iPhone viewport;
- реальный tap по вкладкам, фильтру, дню и отчёту;
- два быстрых нажатия отправки;
- отправка offline → reload → reconnect;
- восстановление черновика с фото;
- отсутствие восстановления после постановки в очередь;
- ревизии success/error/timeout;
- комментарий, удаление, просмотр фото;
- роли admin, manager, barista, waiter.

## Порядок внедрения

1. Реализовать pure core и единое IndexedDB-хранилище.
2. Реализовать отправку и синхронизацию.
3. Реализовать декоратор рабочих чек-листов и фото-поля.
4. Реализовать Control v4.
5. Отключить старые модули в loader и PWA app shell.
6. Добавить Chromium + WebKit тесты.
7. Создать отдельный draft PR и live preview.
8. После ручного подтверждения удалить устаревшие модули отдельным cleanup PR.
