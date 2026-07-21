/* Correct coffee revision control updates and business formulas. */
(() => {
  'use strict';

  const core = window.SovremennikCoffeeRevisionFormula;
  if(!core?.calculateRevisionSeries){
    console.error('Coffee revision formula core is unavailable.');
    return;
  }

  const FORMULA_NOTE_ID = 'coffee-revision-formula-note';
  let observerTimer = null;

  function currentRole(){
    try {
      return typeof normalizeRole === 'function' && typeof currentUser === 'function'
        ? normalizeRole(currentUser()?.role)
        : '';
    } catch(error){
      return '';
    }
  }

  function canEnterControlValues(){
    return ['admin', 'manager'].includes(currentRole());
  }

  function numericValue(raw){
    const normalized = String(raw ?? '').trim().replace(',', '.');
    if(!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function installFormulaOverrides(){
    if(typeof window.enrichRevisionCalculations === 'function'){
      window.enrichRevisionCalculations = records => core.calculateRevisionSeries(records, {
        tareKg: core.DEFAULT_TARE_KG,
      });
    }

    if(typeof window.revisionValueClass === 'function'){
      window.revisionValueClass = (label, value) => {
        const number = core.numberValue(value);
        if(number === null) return '';
        const normalizedLabel = String(label || '');
        if(normalizedLabel.startsWith('Разница')) return number >= 0 ? ' revision-positive' : ' revision-negative';
        if(normalizedLabel.startsWith('Потери')) return number === 0 ? ' revision-positive' : ' revision-negative';
        return '';
      };
    }

    if(typeof window.renderRevisionRecordsTable === 'function'){
      window.renderRevisionRecordsTable = function(){
        const records = getRevisionRecords();
        if(state.revisionLoading) return '<div class="empty-control"><h3>Загружаю данные ревизий…</h3><p>Подключаюсь к Supabase.</p></div>';
        if(!records.length) return `<div class="empty-control"><h3>Пока нет отправленных ревизий</h3><p>После отправки формы «Ревизия кофе» запись появится здесь и в Supabase.</p>${state.revisionError ? `<p class="control-error">${esc(state.revisionError)}</p>` : ''}</div>`;
        const sorted = mergeRevisionRecordsByDate(records).sort((left, right) => String(left.dateKey || '').localeCompare(String(right.dateKey || '')));
        const columns = sorted.slice(-14);
        const rows = [
          ['Значение на весах (кг.)', record => record.hopperWeight],
          ['Вскрыто пачек (шт.)', record => record.openedPacks],
          ['Списания (кг.)', record => record.writeOffs],
          ['Продажи в iiko (кг.)', record => record.iikoSales],
          ['Разница (кг.)', record => record.difference],
          ['Потери всего (кг.)', record => record.totalLossWeight],
          ['Потери от продаж', record => record.losses],
          ['Ответственный', record => record.employeeName],
          ['Проверено', record => record.checked],
          ['Чистый вес кофе в бункере', record => record.cleanHopperWeight],
          ['Общий расход кофе', record => record.totalCoffeeUsage],
          ['Дата и время заполнения', record => formatDateTime(record.createdAt)],
        ];
        return `<div class="control-table-wrap">${state.revisionError ? `<p class="control-error">${esc(state.revisionError)} Показана локальная резервная копия.</p>` : ''}<table class="control-table revision-pivot"><thead><tr><th>Дата ревизии</th>${columns.map(record => `<th>${esc(record.date || displayDateFromKey(record.dateKey) || formatDateOnly(record.createdAt))}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, getter]) => `<tr><th>${esc(label)}</th>${columns.map(record => { const value = getter(record); const display = value === undefined || value === null || String(value) === '' ? '—' : value; return `<td class="${revisionValueClass(label, display).trim()}">${esc(display)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
      };
    }

    if(typeof window.exportRevisionCsv === 'function'){
      window.exportRevisionCsv = function(){
        const rows = [['Дата', 'Дата и время', 'Сотрудник', 'Вес бункера, кг', 'Вскрыто пачек, шт.', 'Списания, кг', 'Продажи iiko, кг', 'Разница, кг', 'Потери всего, кг', 'Потери от продаж, %', 'Проверено']];
        getRevisionRecords().forEach(record => rows.push([
          record.date || displayDateFromKey(record.dateKey) || formatDateOnly(record.createdAt),
          formatDateTime(record.createdAt),
          record.employeeName || '',
          record.hopperWeight || '',
          record.openedPacks || '',
          record.writeOffs || '',
          record.iikoSales || '',
          record.difference || '',
          record.totalLossWeight || '',
          record.losses || '',
          record.checked || '',
        ]));
        downloadCsv('coffee_revisions.csv', rows);
      };
    }
  }

  function statusMessage(form, text, error = false){
    const status = form?.querySelector('.revision-manual-status');
    if(!status) return;
    status.textContent = text || '';
    status.className = `submit-status revision-manual-status${error ? ' error' : ''}`;
  }

  async function submitManualControlValues(form){
    if(!canEnterControlValues()){
      statusMessage(form, 'Вносить списания и продажи может только администратор или руководитель.', true);
      return;
    }

    const revisionDate = String(form.elements.revisionDate.value || '').trim();
    const writeOffsRaw = String(form.elements.writeOffs.value || '').trim();
    const salesRaw = String(form.elements.iikoSales.value || '').trim();
    const checked = String(form.elements.checked.value || '').trim();
    const writeOffs = numericValue(writeOffsRaw);
    const sales = numericValue(salesRaw);

    if(!revisionDate){
      statusMessage(form, 'Выберите дату ревизии.', true);
      return;
    }
    if(writeOffsRaw === '' && salesRaw === '' && checked === ''){
      statusMessage(form, 'Заполните хотя бы списания, продажи или поле проверки.', true);
      return;
    }
    if(Number.isNaN(writeOffs) || Number.isNaN(sales) || (writeOffs !== null && writeOffs < 0) || (sales !== null && sales < 0)){
      statusMessage(form, 'Списания и продажи должны быть положительными числами.', true);
      return;
    }

    const values = {};
    if(writeOffsRaw !== '') values.write_offs = writeOffs;
    if(salesRaw !== '') values.iiko_sales = sales;
    if(checked !== '') values.checked = checked;

    const button = form.querySelector('button[type="submit"]');
    statusMessage(form, 'Сохраняю данные…');
    if(button) button.disabled = true;

    try {
      const result = await supa
        .from('coffee_revisions')
        .update(values)
        .eq('revision_date', normalizeDateKey(revisionDate))
        .select('revision_date,employee_id,employee_name')
        .maybeSingle();
      if(result.error) throw result.error;
      if(!result.data) throw new Error('Ревизия за выбранную дату не найдена. Сначала сотрудник должен отправить вес бункера и количество вскрытых пачек.');

      if(typeof loadRevisionRecords === 'function') await loadRevisionRecords();
      statusMessage(form, 'Данные сохранены, показатели таблицы пересчитаны.');
      alert('Данные ревизии сохранены и пересчитаны');
    } catch(error){
      console.error('Coffee revision manual control update failed', error);
      statusMessage(form, `Не удалось сохранить данные: ${error?.message || 'проверьте интернет и права доступа.'}`, true);
    } finally {
      if(button) button.disabled = false;
    }
  }

  function interceptManualSubmit(event){
    const form = event.target;
    if(!(form instanceof HTMLFormElement) || form.id !== 'revision-manual-form') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    submitManualControlValues(form);
  }

  function ensureFormulaNote(){
    const folder = document.querySelector('#control-revisions');
    if(!folder || document.getElementById(FORMULA_NOTE_ID)) return;
    const records = folder.querySelector('#revision-records');
    if(!records) return;
    records.insertAdjacentHTML('beforebegin', `
      <details class="revision-manual revision-formula-note" id="${FORMULA_NOTE_ID}">
        <summary>Как считаются показатели ревизии</summary>
        <div class="revision-correction-note">
          <p><b>Чистый вес:</b> значение на весах − 0,847 кг (тара бункера).</p>
          <p><b>Общий расход:</b> чистый остаток предыдущей ревизии + вскрытые пачки − текущий чистый остаток.</p>
          <p><b>Разница:</b> продажи iiko − списания − общий расход. Отрицательное значение означает неучтённый расход.</p>
          <p><b>Потери всего:</b> списания + отрицательная часть разницы. Положительный излишек в потери не включается.</p>
          <p><b>Потери от продаж:</b> потери всего ÷ продажи iiko × 100%.</p>
        </div>
      </details>`);
  }

  function refreshCalculatedData(){
    try {
      if(typeof state !== 'undefined' && Array.isArray(state.revisionRecords)){
        state.revisionRecords = core.calculateRevisionSeries(state.revisionRecords);
        if(typeof setLocalRevisionRecords === 'function') setLocalRevisionRecords(state.revisionRecords);
        if(typeof refreshControl === 'function') refreshControl();
      } else if(typeof loadRevisionRecords === 'function') {
        loadRevisionRecords();
      }
    } catch(error){
      console.warn('Coffee revision formula refresh failed', error);
    }
  }

  function scheduleEnsure(){
    clearTimeout(observerTimer);
    observerTimer = setTimeout(ensureFormulaNote, 30);
  }

  installFormulaOverrides();
  document.addEventListener('submit', interceptManualSubmit, true);
  new MutationObserver(scheduleEnsure).observe(document.documentElement, { childList:true, subtree:true });
  ensureFormulaNote();
  setTimeout(refreshCalculatedData, 0);
})();
