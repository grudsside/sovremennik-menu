/* Современник — Control v3 regression hotfix: revisions, waiter reports and one-shot submissions. */
(function(global){
  'use strict';

  if(global.SovremennikControlV3RegressionFix) return;

  const VERSION = '2026-07-30-control-v3-regression-fix-1';
  const RECEIPTS_KEY = 'sovremennikChecklistSubmissionReceiptsV1';
  const RECEIPT_TTL = 30 * 60 * 1000;
  const REVISION_TIMEOUT = 12_000;
  const OFFLINE_DB = 'sovremennik-offline-v1';
  const OFFLINE_DRAFT_STORE = 'checklistDrafts';
  const OFFLINE_QUEUE_STORE = 'submissionQueue';

  const originalRevisionRenderer = typeof global.renderRevisionRecordsTable === 'function'
    ? global.renderRevisionRecordsTable
    : null;
  const originalRevisionLoader = typeof global.loadRevisionRecords === 'function'
    ? global.loadRevisionRecords
    : null;
  const originalSubmitChecklist = typeof global.submitChecklist === 'function'
    ? global.submitChecklist
    : null;

  let revisionLoadPromise = null;

  const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const html = value => typeof global.esc === 'function'
    ? global.esc(value)
    : String(value ?? '').replace(/[&<>\"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[character]));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function hash(value){
    let result = 2166136261;
    for(const character of String(value || '')){
      result ^= character.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }

  function currentUserSafe(){
    try { return typeof global.currentUser === 'function' ? global.currentUser() : null; }
    catch(error){ return null; }
  }

  function refreshControlV3(force = true){
    try { return global.SovremennikControlV3?.refresh?.(force); }
    catch(error){ console.error('Control v3 forced refresh failed.', error); return false; }
  }

  function revisionRows(){
    try {
      const rows = typeof global.getRevisionRecords === 'function'
        ? global.getRevisionRecords()
        : global.state?.revisionRecords;
      return Array.isArray(rows) ? rows : [];
    } catch(error){
      console.warn('Revision rows are unavailable.', error);
      return [];
    }
  }

  function revisionDisplay(value){
    return value === undefined || value === null || String(value).trim() === '' ? '—' : value;
  }

  function fallbackRevisionTable(records){
    let sorted = records.slice();
    try {
      if(typeof global.mergeRevisionRecordsByDate === 'function') sorted = global.mergeRevisionRecordsByDate(sorted);
    } catch(error){ console.warn('Revision merge fallback is used.', error); }
    sorted.sort((left, right) => String(left?.dateKey || '').localeCompare(String(right?.dateKey || '')));
    const columns = sorted.slice(-14);
    const rows = [
      ['Значение на весах (кг.)', row => row?.hopperWeight],
      ['Вскрыто пачек (шт.)', row => row?.openedPacks],
      ['Списания (кг.)', row => row?.writeOffs],
      ['Продажи в iiko', row => row?.iikoSales],
      ['Разница', row => row?.difference],
      ['Потери', row => row?.losses],
      ['Ответственный', row => row?.employeeName],
      ['Проверено', row => row?.checked],
      ['Чистый вес кофе в бункере', row => row?.cleanHopperWeight],
      ['Общий расход кофе', row => row?.totalCoffeeUsage],
      ['Дата и время заполнения', row => typeof global.formatDateTime === 'function' ? global.formatDateTime(row?.createdAt) : row?.createdAt]
    ];
    return `<div class="control-table-wrap"><table class="control-table revision-pivot"><thead><tr><th>Дата ревизии</th>${columns.map(row => `<th>${html(row?.date || (typeof global.displayDateFromKey === 'function' ? global.displayDateFromKey(row?.dateKey) : row?.dateKey) || '—')}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, getter]) => `<tr><th>${html(label)}</th>${columns.map(row => {
      const value = revisionDisplay(getter(row));
      let className = '';
      try { className = typeof global.revisionValueClass === 'function' ? global.revisionValueClass(label, value).trim() : ''; }
      catch(error){}
      return `<td class="${html(className)}">${html(value)}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function safeRevisionRenderer(){
    const records = revisionRows();
    const loading = Boolean(global.state?.revisionLoading);
    const errorText = text(global.state?.revisionError);
    const updating = loading && records.length
      ? '<p class="control-v3-inline-status">Обновляю ревизии… Уже загруженные данные остаются доступны.</p>'
      : '';

    if(records.length && originalRevisionRenderer){
      const previousLoading = global.state.revisionLoading;
      try {
        global.state.revisionLoading = false;
        const rendered = originalRevisionRenderer();
        if(rendered) return `${updating}${rendered}`;
      } catch(error){
        console.error('Legacy revision renderer failed; fallback table is used.', error);
        global.state.revisionError = error.message || 'Не удалось отобразить ревизии.';
      } finally {
        global.state.revisionLoading = previousLoading;
      }
    }

    if(records.length) return `${updating}${errorText ? `<p class="control-error">${html(errorText)}</p>` : ''}${fallbackRevisionTable(records)}`;
    if(loading) return '<div class="empty-control"><h3>Загружаю данные ревизий…</h3><p>Подключаюсь к Supabase. Если сервер не ответит, будет показана локальная копия.</p></div>';
    return `<div class="empty-control"><h3>Пока нет доступных ревизий</h3><p>Нажмите «Обновить данные». Если соединение недоступно, приложение покажет последнюю локальную копию.</p>${errorText ? `<p class="control-error">${html(errorText)}</p>` : ''}</div>`;
  }

  function installRevisionFix(){
    global.renderRevisionRecordsTable = safeRevisionRenderer;
    try { renderRevisionRecordsTable = safeRevisionRenderer; } catch(error){}

    if(!originalRevisionLoader) return;
    const safeLoader = function(...args){
      if(revisionLoadPromise) return revisionLoadPromise;
      let timeoutId = 0;
      revisionLoadPromise = Promise.resolve().then(async () => {
        timeoutId = global.setTimeout(() => {
          if(!revisionLoadPromise || !global.state?.revisionLoading) return;
          global.state.revisionLoading = false;
          global.state.revisionError = 'Supabase отвечает слишком долго. Показана последняя сохранённая копия.';
          refreshControlV3(true);
        }, REVISION_TIMEOUT);
        try {
          return await originalRevisionLoader.apply(this, args);
        } catch(error){
          console.error('Revision loading failed.', error);
          global.state.revisionLoading = false;
          global.state.revisionError = error?.message || 'Не удалось загрузить ревизии из Supabase.';
          return revisionRows();
        } finally {
          global.clearTimeout(timeoutId);
          global.state.revisionLoading = false;
          revisionLoadPromise = null;
          refreshControlV3(true);
        }
      });
      return revisionLoadPromise;
    };
    safeLoader.__controlV3RegressionWrapped = true;
    global.loadRevisionRecords = safeLoader;
    try { loadRevisionRecords = safeLoader; } catch(error){}
  }

  function recordId(record){ return String(record?.id || record?.submission_id || ''); }

  function applyDepartment(department){
    const target = department === 'waiter' ? 'waiter' : 'barista';
    const root = document.querySelector('#control-records');
    if(!root) return;
    const api = global.SovremennikChecklistReviewTools;
    const records = Array.isArray(global.state?.controlRecords) ? global.state.controlRecords : [];
    const byId = new Map(records.map(record => [recordId(record), record]));

    root.querySelectorAll('[data-checklist-department]').forEach(button => {
      button.classList.toggle('active', button.dataset.checklistDepartment === target);
      button.setAttribute('aria-pressed', button.dataset.checklistDepartment === target ? 'true' : 'false');
    });

    root.querySelectorAll('.checklist-submission-details[data-checklist-submission]').forEach(details => {
      const record = byId.get(String(details.dataset.checklistSubmission || ''));
      let rowDepartment = details.dataset.reviewDepartment || '';
      try { if(record && api?.departmentForRecord) rowDepartment = api.departmentForRecord(record); }
      catch(error){}
      details.dataset.reviewDepartment = rowDepartment;
      details.hidden = rowDepartment !== target;
    });

    let firstVisibleGroup = null;
    root.querySelectorAll('.control-day-group').forEach(group => {
      const visible = Array.from(group.querySelectorAll('.checklist-submission-details')).some(details => !details.hidden);
      group.hidden = !visible;
      if(visible && !firstVisibleGroup) firstVisibleGroup = group;
    });
    if(firstVisibleGroup) firstVisibleGroup.open = true;
  }

  function setDepartment(department){
    const target = department === 'waiter' ? 'waiter' : 'barista';
    try { global.SovremennikChecklistReviewTools?.setDepartmentForTesting?.(target); }
    catch(error){ console.warn(error); }
    applyDepartment(target);
    global.requestAnimationFrame(() => applyDepartment(target));
    global.setTimeout(() => applyDepartment(target), 80);
  }

  function openDatabase(name){
    return new Promise((resolve, reject) => {
      if(!global.indexedDB){ resolve(null); return; }
      const request = global.indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(`Не удалось открыть ${name}.`));
    });
  }

  async function allStoreRows(databaseName, storeName){
    const db = await openDatabase(databaseName).catch(() => null);
    if(!db || !db.objectStoreNames.contains(storeName)){ db?.close?.(); return []; }
    return await new Promise(resolve => {
      const transaction = db.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
      transaction.oncomplete = () => db.close();
      transaction.onabort = () => { db.close(); resolve([]); };
    });
  }

  async function deleteMatchingRows(databaseName, storeName, predicate){
    const db = await openDatabase(databaseName).catch(() => null);
    if(!db || !db.objectStoreNames.contains(storeName)){ db?.close?.(); return; }
    await new Promise(resolve => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => (request.result || []).filter(predicate).forEach(row => store.delete(row.key));
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = transaction.onabort = () => { db.close(); resolve(); };
    });
  }

  function cardFor(checklistId){
    return document.querySelector(`.doc-card[data-checklist-id="${CSS.escape(String(checklistId || ''))}"]`);
  }

  function cardSnapshot(card, checklistId){
    const employeeName = text(card?.querySelector('.employee-name')?.value).toLowerCase();
    const tasks = Array.from(card?.querySelectorAll('.task-checkbox') || []).map((input, index) => [
      text(input.dataset.photoItemKey || `${checklistId}:${index}`).toLowerCase(),
      Boolean(input.checked)
    ]);
    const photoCounts = Array.from(card?.querySelectorAll('[data-checklist-photo-field]') || []).map(field => [
      text(field.dataset.itemKey).toLowerCase(),
      Math.max(
        field.querySelectorAll('[data-photo-previews] img').length,
        Number(field.querySelector('[data-photo-input]')?.files?.length || 0)
      )
    ]);
    return {
      userId:String(currentUserSafe()?.id || ''),
      checklistId:String(checklistId || card?.dataset.checklistId || ''),
      employeeName,
      tasks,
      photoCounts
    };
  }

  function queueFingerprint(item){
    const photosByItem = new Map();
    (item?.photos || []).forEach(photo => {
      const key = text(photo?.itemKey || photo?.item_key).toLowerCase();
      photosByItem.set(key, (photosByItem.get(key) || 0) + 1);
    });
    const tasks = (item?.tasks || []).map((task, index) => {
      const key = text(task?.itemKey || task?.item_key || task?.text || index).toLowerCase();
      return [key, Boolean(task?.checkedByUser ?? task?.checked), Number(task?.photoCount ?? photosByItem.get(key) ?? 0)];
    });
    return hash(JSON.stringify({
      userId:String(item?.userId || ''),
      checklistId:String(item?.checklistId || ''),
      employeeName:text(item?.employeeName).toLowerCase(),
      tasks
    }));
  }

  function snapshotFingerprint(snapshot){
    const photos = new Map(snapshot.photoCounts || []);
    const tasks = (snapshot.tasks || []).map(([key, checked]) => [key, checked, Number(photos.get(key) || 0)]);
    return hash(JSON.stringify({
      userId:snapshot.userId,
      checklistId:snapshot.checklistId,
      employeeName:snapshot.employeeName,
      tasks
    }));
  }

  function readReceipts(){
    try { return JSON.parse(global.localStorage?.getItem(RECEIPTS_KEY) || '{}') || {}; }
    catch(error){ return {}; }
  }

  function writeReceipts(receipts){
    try { global.localStorage?.setItem(RECEIPTS_KEY, JSON.stringify(receipts)); }
    catch(error){}
  }

  function receiptKey(snapshot, fingerprint){ return `${snapshot.userId}|${snapshot.checklistId}|${fingerprint}`; }

  function recentReceipt(key){
    const receipts = readReceipts();
    const now = Date.now();
    Object.keys(receipts).forEach(item => { if(now - Number(receipts[item]?.savedAt || 0) > RECEIPT_TTL) delete receipts[item]; });
    writeReceipts(receipts);
    return receipts[key] && now - Number(receipts[key].savedAt || 0) <= RECEIPT_TTL ? receipts[key] : null;
  }

  function saveReceipt(key, submissionId = ''){
    const receipts = readReceipts();
    receipts[key] = { savedAt:Date.now(), submissionId:String(submissionId || '') };
    writeReceipts(receipts);
  }

  async function pendingEquivalent(fingerprint){
    const rows = await allStoreRows(OFFLINE_DB, OFFLINE_QUEUE_STORE);
    return rows.find(row => row?.status !== 'synced' && queueFingerprint(row) === fingerprint) || null;
  }

  function setCardStatus(card, message, kind = ''){
    const status = card?.querySelector('.submit-status');
    if(!status) return;
    status.textContent = message || '';
    status.className = `submit-status${kind ? ` ${kind}` : ''}`;
  }

  function cardIsCleared(card){
    if(!card) return false;
    const noName = !text(card.querySelector('.employee-name')?.value);
    const noChecks = !Array.from(card.querySelectorAll('.task-checkbox')).some(input => input.checked);
    const noPhotos = !card.querySelector('[data-photo-previews] img');
    return noName && noChecks && noPhotos;
  }

  function clearCardUi(card){
    if(!card) return;
    card.dataset.offlineSuppressDraft = '1';
    card.querySelectorAll('[data-photo-remove]').forEach(button => {
      try { button.click(); } catch(error){}
    });
    card.querySelectorAll('.task-checkbox').forEach(input => { input.checked = false; });
    const nameInput = card.querySelector('.employee-name');
    if(nameInput) nameInput.value = '';
    delete card.dataset.photoSubmissionId;
    global.setTimeout(() => { if(card.isConnected) card.dataset.offlineSuppressDraft = '0'; }, 1800);
  }

  async function purgeDrafts(card, checklistId){
    const userId = String(currentUserSafe()?.id || '');
    if(card) card.dataset.offlineSuppressDraft = '1';
    await Promise.allSettled([
      deleteMatchingRows(OFFLINE_DB, OFFLINE_DRAFT_STORE, row => String(row?.userId || '') === userId && String(row?.checklistId || '') === String(checklistId)),
      Promise.resolve(global.SovremennikChecklistPhotoDraftFix?.clearChecklist?.(String(checklistId)))
    ]);
    if(card) global.setTimeout(() => { if(card.isConnected) card.dataset.offlineSuppressDraft = '0'; }, 1800);
  }

  async function rejectDuplicate(card, checklistId, message){
    clearCardUi(card);
    await purgeDrafts(card, checklistId);
    setCardStatus(card, message, 'error');
  }

  function installSubmissionGuard(){
    if(!originalSubmitChecklist) return;
    const guarded = async function(checklistId){
      const card = cardFor(checklistId);
      if(!card) return originalSubmitChecklist.apply(this, arguments);
      if(card.dataset.sovSubmissionRunning === '1') return;
      card.dataset.sovSubmissionRunning = '1';
      const button = card.querySelector('.submit-checklist');
      if(button) button.disabled = true;
      const snapshot = cardSnapshot(card, checklistId);
      const fingerprint = snapshotFingerprint(snapshot);
      const key = receiptKey(snapshot, fingerprint);
      try {
        if(recentReceipt(key)){
          await rejectDuplicate(card, checklistId, 'Этот чек-лист уже был отправлен. Повторный черновик удалён.');
          return;
        }
        const pending = await pendingEquivalent(fingerprint);
        if(pending){
          saveReceipt(key, pending.id);
          await rejectDuplicate(card, checklistId, 'Этот чек-лист уже ожидает отправки. Повторная копия удалена.');
          return;
        }

        const result = await originalSubmitChecklist.apply(this, arguments);
        await wait(180);
        const statusText = text(card.querySelector('.submit-status')?.textContent).toLowerCase();
        const accepted = cardIsCleared(card) || statusText.includes('ожидает отправки') || statusText.includes('чек-лист отправлен');
        if(accepted){
          saveReceipt(key, card.dataset.photoSubmissionId || '');
          await purgeDrafts(card, checklistId);
        }
        return result;
      } finally {
        card.dataset.sovSubmissionRunning = '0';
        if(button) button.disabled = false;
      }
    };
    guarded.__controlV3SubmissionGuard = true;
    guarded.__original = originalSubmitChecklist;
    global.submitChecklist = guarded;
    try { submitChecklist = guarded; } catch(error){}
  }

  function installCaptureLayer(){
    global.addEventListener('click', event => {
      const department = event.target?.closest?.('#top-control [data-checklist-department]');
      if(department){
        event.preventDefault();
        event.stopImmediatePropagation();
        setDepartment(department.dataset.checklistDepartment);
        return;
      }

      const summary = event.target?.closest?.('#top-control .checklist-submission-details > summary');
      if(summary){
        const details = summary.parentElement;
        if(details instanceof HTMLDetailsElement){
          event.preventDefault();
          event.stopImmediatePropagation();
          details.open = !details.open;
          if(details.open){
            try { global.SovremennikChecklistPhotoReports?.queueEnhance?.(); } catch(error){}
            try { global.SovremennikChecklistReviewTools?.queueEnhance?.(); } catch(error){}
          }
        }
        return;
      }

      const revisionTab = event.target?.closest?.('#top-control [data-control-target="revisions"]');
      if(revisionTab) global.setTimeout(() => global.loadRevisionRecords?.(), 0);

      const submit = event.target?.closest?.('.doc-card[data-checklist-id] .submit-checklist');
      const card = submit?.closest?.('.doc-card[data-checklist-id]');
      if(card?.dataset.sovSubmissionRunning === '1'){
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }

  installRevisionFix();
  installSubmissionGuard();
  installCaptureLayer();

  global.SovremennikControlV3RegressionFix = Object.freeze({
    VERSION,
    renderRevisionRecords:safeRevisionRenderer,
    setDepartment,
    applyDepartment,
    purgeDrafts,
    snapshotFingerprint
  });
})(window);
