(() => {
  'use strict';

  const EDITOR_ID = 'coffee-revision-correction';
  const FORM_ID = 'coffee-revision-correction-form';
  const HISTORY_ID = 'coffee-revision-edit-history';
  const OBSERVER_DEBOUNCE_MS = 30;
  let observerTimer = null;

  function isRevisionAdmin(){
    try {
      return typeof normalizeRole === 'function'
        && typeof currentUser === 'function'
        && normalizeRole(currentUser()?.role) === 'admin';
    } catch(error){
      console.warn('Coffee revision editor role check failed', error);
      return false;
    }
  }

  function revisionRecords(){
    try {
      return typeof getRevisionRecords === 'function' ? (getRevisionRecords() || []) : [];
    } catch(error){
      console.warn('Coffee revision records are unavailable', error);
      return [];
    }
  }

  function revisionByDate(dateKey){
    return revisionRecords().find(record => String(record.dateKey || '') === String(dateKey || '')) || null;
  }

  function safeText(value){
    return typeof esc === 'function'
      ? esc(value)
      : String(value ?? '').replace(/[&<>\"]/g, character => ({
        '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;',
      }[character]));
  }

  function renderEditor(){
    return `
      <details class="revision-manual revision-correction" id="${EDITOR_ID}">
        <summary>Исправить существующую ревизию</summary>
        <div class="revision-correction-note">
          <strong>Только для администратора.</strong>
          Выберите дату, исправьте значения и укажите причину. Дата и первоначальный сотрудник сохраняются.
          Поставку можно внести на нужный день. Ручной общий остаток становится контрольной точкой для расчёта следующих дней.
        </div>
        <form class="revision-form" id="${FORM_ID}">
          <div class="form-grid revision-correction-grid">
            <label class="employee-field">Ревизия за дату
              <select name="revisionDate" required><option value="">Выберите ревизию</option></select>
            </label>
            <label class="employee-field">Ответственный
              <input name="employeeName" type="text" readonly placeholder="Заполнится автоматически">
            </label>
            <label class="employee-field">Вес бункера, кг
              <input name="hopperWeight" type="number" min="0" step="0.001" required>
            </label>
            <label class="employee-field">Вскрыто пачек, шт.
              <input name="openedPacks" type="number" min="0" step="1" required>
            </label>
            <label class="employee-field">Поставка зерна, кг
              <input name="grainDelivery" type="number" min="0" step="0.001" placeholder="Оставьте пустым, если поставки не было">
            </label>
            <label class="employee-field">Общий остаток на конец дня, кг
              <input name="stockBalanceOverride" type="number" min="0" step="0.001" placeholder="Пусто — считать автоматически">
              <small>Заполните для 21.07 или при контрольном пересчёте всего зерна.</small>
            </label>
            <label class="employee-field">Текущий рассчитанный остаток, кг
              <input name="calculatedStock" type="text" readonly placeholder="Появится после расчёта">
            </label>
            <label class="employee-field">Списания, кг
              <input name="writeOffs" type="number" min="0" step="0.001">
            </label>
            <label class="employee-field">Продажи в iiko, кг
              <input name="iikoSales" type="number" min="0" step="0.001">
            </label>
            <label class="employee-field">Проверено
              <input name="checked" type="text" maxlength="160" placeholder="Например, Григорий">
            </label>
          </div>
          <label class="employee-field revision-correction-reason">Причина исправления
            <textarea name="reason" rows="3" maxlength="500" required placeholder="Например: внесён общий остаток зерна на 21.07 или добавлена поставка"></textarea>
          </label>
          <button class="submit-revision revision-correction-submit" type="submit">Сохранить исправление</button>
          <p class="submit-status revision-correction-status" aria-live="polite"></p>
        </form>
        <div class="revision-edit-history" id="${HISTORY_ID}">
          <h4>История исправлений</h4>
          <p class="revision-history-empty">История загрузится после открытия формы.</p>
        </div>
      </details>`;
  }

  function sortedRevisionRecords(){
    return revisionRecords()
      .filter(record => record?.dateKey)
      .slice()
      .sort((left, right) => String(right.dateKey).localeCompare(String(left.dateKey)));
  }

  function refreshRevisionOptions(editor){
    const select = editor?.querySelector(`form#${FORM_ID} select[name="revisionDate"]`);
    if(!select) return;
    const selected = select.value;
    const options = sortedRevisionRecords().map(record => {
      const dateLabel = record.date || (typeof displayDateFromKey === 'function' ? displayDateFromKey(record.dateKey) : record.dateKey);
      const employeeLabel = record.employeeName ? ` — ${record.employeeName}` : '';
      return `<option value="${safeText(record.dateKey)}">${safeText(dateLabel)}${safeText(employeeLabel)}</option>`;
    }).join('');
    select.innerHTML = `<option value="">Выберите ревизию</option>${options}`;
    if(selected && Array.from(select.options).some(option => option.value === selected)) select.value = selected;
  }

  function setInputValue(form, name, value){
    const input = form?.elements?.[name];
    if(input) input.value = value === undefined || value === null ? '' : String(value);
  }

  function fillCorrectionForm(form, dateKey){
    const record = revisionByDate(dateKey);
    setInputValue(form, 'employeeName', record?.employeeName || '');
    setInputValue(form, 'hopperWeight', record?.hopperWeight ?? '');
    setInputValue(form, 'openedPacks', record?.openedPacks ?? '');
    setInputValue(form, 'grainDelivery', record?.grainDelivery ?? '');
    setInputValue(form, 'stockBalanceOverride', record?.stockBalanceOverride ?? '');
    setInputValue(form, 'calculatedStock', record?.totalGrainBalance ?? '');
    setInputValue(form, 'writeOffs', record?.writeOffs ?? '');
    setInputValue(form, 'iikoSales', record?.iikoSales ?? '');
    setInputValue(form, 'checked', record?.checked ?? '');
  }

  function nullableNumber(value){
    const normalized = String(value ?? '').trim().replace(',', '.');
    if(!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function setStatus(form, text, isError = false){
    const status = form?.querySelector('.revision-correction-status');
    if(!status) return;
    status.textContent = text || '';
    status.className = `submit-status revision-correction-status${isError ? ' error' : ''}`;
  }

  function nonnegativeOrNull(value){
    return value === null || (Number.isFinite(value) && value >= 0);
  }

  async function submitCorrection(event){
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const revisionDate = String(form.elements.revisionDate.value || '').trim();
    const reason = String(form.elements.reason.value || '').trim();
    const hopperWeight = nullableNumber(form.elements.hopperWeight.value);
    const openedPacks = nullableNumber(form.elements.openedPacks.value);
    const grainDelivery = nullableNumber(form.elements.grainDelivery.value);
    const stockBalanceOverride = nullableNumber(form.elements.stockBalanceOverride.value);
    const writeOffs = nullableNumber(form.elements.writeOffs.value);
    const iikoSales = nullableNumber(form.elements.iikoSales.value);
    const checked = String(form.elements.checked.value || '').trim() || null;

    if(!isRevisionAdmin()) return setStatus(form, 'Исправлять ревизии может только администратор.', true);
    if(!revisionDate) return setStatus(form, 'Выберите ревизию.', true);
    if(!reason){
      setStatus(form, 'Укажите причину исправления.', true);
      form.elements.reason.focus();
      return;
    }
    if(!Number.isFinite(hopperWeight) || hopperWeight < 0){
      setStatus(form, 'Укажите корректный вес бункера.', true);
      form.elements.hopperWeight.focus();
      return;
    }
    if(!Number.isInteger(openedPacks) || openedPacks < 0){
      setStatus(form, 'Количество вскрытых пачек должно быть целым числом.', true);
      form.elements.openedPacks.focus();
      return;
    }
    if(!nonnegativeOrNull(writeOffs) || !nonnegativeOrNull(iikoSales)){
      return setStatus(form, 'Списания и продажи должны быть положительными числами или оставаться пустыми.', true);
    }
    if(!nonnegativeOrNull(grainDelivery) || !nonnegativeOrNull(stockBalanceOverride)){
      return setStatus(form, 'Поставка и общий остаток должны быть положительными числами или оставаться пустыми.', true);
    }

    setStatus(form, 'Сохраняю исправление и пересчитываю остатки…');
    if(submitButton) submitButton.disabled = true;

    try {
      const result = await supa.rpc('correct_coffee_revision', {
        p_revision_date:revisionDate,
        p_hopper_weight:hopperWeight,
        p_opened_packs:openedPacks,
        p_write_offs:writeOffs,
        p_iiko_sales:iikoSales,
        p_checked:checked,
        p_grain_delivery:grainDelivery,
        p_stock_balance_override:stockBalanceOverride,
        p_reason:reason,
      });
      if(result.error) throw result.error;

      if(typeof loadRevisionRecords === 'function') await loadRevisionRecords();
      setStatus(form, 'Исправление сохранено. Общий остаток на следующие дни пересчитан.');
      form.elements.reason.value = '';
      fillCorrectionForm(form, revisionDate);
      await loadRevisionEditHistory(form.closest(`#${EDITOR_ID}`), true);
      alert('Ревизия исправлена и остатки пересчитаны');
    } catch(error){
      console.error('Coffee revision correction failed', error);
      setStatus(form, `Не удалось сохранить исправление: ${error?.message || 'проверьте интернет и права доступа.'}`, true);
    } finally {
      if(submitButton) submitButton.disabled = false;
    }
  }

  const AUDIT_FIELDS = [
    ['hopper_weight','Вес бункера'],
    ['opened_packs','Вскрыто пачек'],
    ['grain_delivery','Поставка зерна'],
    ['stock_balance_override','Ручной общий остаток'],
    ['write_offs','Списания'],
    ['iiko_sales','Продажи iiko'],
    ['checked','Проверено'],
  ];

  function displayAuditValue(value){
    return value === null || value === undefined || value === '' ? 'пусто' : String(value);
  }

  function changedFields(entry){
    const before = entry.before_data || {};
    const after = entry.after_data || {};
    const changes = AUDIT_FIELDS
      .filter(([key]) => String(before[key] ?? '') !== String(after[key] ?? ''))
      .map(([key, label]) => `${label}: ${displayAuditValue(before[key])} → ${displayAuditValue(after[key])}`);
    return changes.length ? changes.join(' · ') : 'Значения сохранены без видимых изменений';
  }

  function renderHistory(entries){
    if(!entries.length) return '<p class="revision-history-empty">Исправлений пока нет.</p>';
    return `<div class="revision-history-list">${entries.map(entry => {
      const dateLabel = typeof displayDateFromKey === 'function' ? displayDateFromKey(entry.revision_date) : entry.revision_date;
      const createdLabel = typeof formatDateTime === 'function' ? formatDateTime(entry.created_at) : entry.created_at;
      return `<article class="revision-history-item">
        <div class="revision-history-head"><strong>${safeText(dateLabel)}</strong><span>${safeText(createdLabel)}</span></div>
        <p><b>${safeText(entry.editor_name || 'Администратор')}</b>: ${safeText(entry.reason || '')}</p>
        <p class="revision-history-changes">${safeText(changedFields(entry))}</p>
      </article>`;
    }).join('')}</div>`;
  }

  async function loadRevisionEditHistory(editor, force = false){
    const history = editor?.querySelector(`#${HISTORY_ID}`);
    if(!history || (!force && history.dataset.loading === 'true')) return;
    history.dataset.loading = 'true';
    history.innerHTML = '<h4>История исправлений</h4><p class="revision-history-empty">Загружаю историю…</p>';
    try {
      const result = await supa.from('coffee_revision_edits')
        .select('id,revision_date,editor_name,reason,before_data,after_data,created_at')
        .order('created_at', { ascending:false })
        .limit(30);
      if(result.error) throw result.error;
      history.innerHTML = `<h4>История исправлений</h4>${renderHistory(result.data || [])}`;
      history.dataset.loaded = 'true';
    } catch(error){
      console.error('Coffee revision edit history failed', error);
      history.innerHTML = '<h4>История исправлений</h4><p class="revision-history-empty error">Историю не удалось загрузить.</p>';
    } finally {
      history.dataset.loading = 'false';
    }
  }

  function bindEditor(editor){
    if(!editor || editor.dataset.bound === 'true') return;
    editor.dataset.bound = 'true';
    const form = editor.querySelector(`form#${FORM_ID}`);
    const select = form?.elements?.revisionDate;
    select?.addEventListener('change', () => fillCorrectionForm(form, select.value));
    form?.addEventListener('submit', submitCorrection);
    editor.addEventListener('toggle', () => { if(editor.open) loadRevisionEditHistory(editor); });
  }

  function ensureRevisionEditor(){
    const folder = document.querySelector('#control-revisions');
    const existing = document.querySelector(`#${EDITOR_ID}`);
    if(!folder || !isRevisionAdmin()){
      existing?.remove();
      return;
    }
    let editor = existing;
    if(!editor){
      const target = folder.querySelector('#revision-records');
      if(!target) return;
      target.insertAdjacentHTML('beforebegin', renderEditor());
      editor = document.querySelector(`#${EDITOR_ID}`);
    }
    bindEditor(editor);
    refreshRevisionOptions(editor);
  }

  function scheduleEnsure(){
    clearTimeout(observerTimer);
    observerTimer = setTimeout(ensureRevisionEditor, OBSERVER_DEBOUNCE_MS);
  }

  const panels = document.querySelector('#panels');
  if(panels) new MutationObserver(scheduleEnsure).observe(panels, { childList:true, subtree:true });
  document.addEventListener('click', event => {
    if(event.target.closest('[data-control-target="revisions"], .refresh-revisions')) scheduleEnsure();
  });
  window.addEventListener('sovremennik:revision-records-updated', scheduleEnsure);
  setTimeout(ensureRevisionEditor, 0);
  setTimeout(ensureRevisionEditor, 500);
})();
