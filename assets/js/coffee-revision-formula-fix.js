/* Correct coffee revision control updates, business formulas and total grain stock. */
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

  function valuePresent(value){
    return value !== undefined && value !== null && String(value).trim() !== '';
  }

  function mapCoffeeReportRow(row){
    const dateKey = normalizeDateKey(row.revision_date);
    return {
      id:`coffee-${dateKey}`,
      dateKey,
      date:displayDateFromKey(dateKey),
      employeeName:row.employee_name || '',
      hopperWeight:row.hopper_weight ?? '',
      openedPacks:row.opened_packs ?? '',
      writeOffs:row.write_offs ?? '',
      iikoSales:row.iiko_sales ?? '',
      checked:row.checked || '',
      cleanHopperWeight:row.clean_hopper_weight ?? '',
      totalCoffeeUsage:row.total_coffee_usage ?? '',
      difference:row.difference ?? '',
      totalLossWeight:row.total_loss_weight ?? '',
      losses:row.losses_percent === null || row.losses_percent === undefined ? '' : `${row.losses_percent}%`,
      grainDelivery:row.grain_delivery ?? '',
      stockBalanceOverride:row.stock_balance_override ?? '',
      totalGrainBalance:row.total_grain_balance ?? '',
      createdAt:row.created_at || row.updated_at || new Date().toISOString(),
    };
  }

  function normalizeExtendedRecord(raw){
    const createdAt = raw?.createdAt || raw?.created_at || raw?.created || new Date().toISOString();
    const dateKey = normalizeDateKey(raw?.dateKey || raw?.revisionDate || raw?.revision_date || raw?.date || createdAt);
    return {
      id:raw?.id || `coffee-${dateKey || Math.random().toString(16).slice(2)}`,
      dateKey,
      date:raw?.date || displayDateFromKey(dateKey) || formatDateOnly(createdAt),
      employeeName:raw?.employeeName || raw?.employee_name || raw?.employee || '',
      hopperWeight:raw?.hopperWeight ?? raw?.hopper_weight ?? raw?.weight ?? '',
      openedPacks:raw?.openedPacks ?? raw?.opened_packs ?? raw?.packs ?? '',
      writeOffs:raw?.writeOffs ?? raw?.write_offs ?? '',
      iikoSales:raw?.iikoSales ?? raw?.iiko_sales ?? '',
      difference:raw?.difference ?? '',
      totalLossWeight:raw?.totalLossWeight ?? raw?.total_loss_weight ?? '',
      losses:raw?.losses ?? (raw?.losses_percent === null || raw?.losses_percent === undefined ? '' : `${raw.losses_percent}%`),
      checked:raw?.checked || '',
      cleanHopperWeight:raw?.cleanHopperWeight ?? raw?.clean_hopper_weight ?? '',
      totalCoffeeUsage:raw?.totalCoffeeUsage ?? raw?.total_coffee_usage ?? '',
      grainDelivery:raw?.grainDelivery ?? raw?.grain_delivery ?? '',
      stockBalanceOverride:raw?.stockBalanceOverride ?? raw?.stock_balance_override ?? '',
      totalGrainBalance:raw?.totalGrainBalance ?? raw?.total_grain_balance ?? '',
      createdAt,
    };
  }

  function mergeExtendedRecords(records){
    const map = new Map();
    const fields = [
      'employeeName','hopperWeight','openedPacks','writeOffs','iikoSales','difference',
      'totalLossWeight','losses','checked','cleanHopperWeight','totalCoffeeUsage',
      'grainDelivery','stockBalanceOverride','totalGrainBalance',
    ];

    for(const raw of records || []){
      const record = normalizeExtendedRecord(raw);
      const key = record.dateKey || normalizeDateKey(record.date) || normalizeDateKey(record.createdAt);
      if(!key) continue;
      if(!map.has(key)) map.set(key, { id:`coffee-${key}`, dateKey:key, date:displayDateFromKey(key), createdAt:record.createdAt });
      const current = map.get(key);
      for(const field of fields){
        if(valuePresent(record[field])) current[field] = record[field];
      }
      if(valuePresent(record.createdAt)) current.createdAt = record.createdAt;
    }

    return core.calculateRevisionSeries(
      Array.from(map.values()).sort((left, right) => String(left.dateKey).localeCompare(String(right.dateKey))),
      { tareKg:core.DEFAULT_TARE_KG },
    );
  }

  function installDataOverrides(){
    const originalFetchFromSheets = window.fetchFromSheets;
    if(typeof originalFetchFromSheets === 'function'){
      window.fetchFromSheets = async function(view){
        if(view !== 'coffeeRevision') return originalFetchFromSheets(view);
        const result = await supa.from('coffee_revision_report').select('*').order('revision_date', { ascending:true });
        if(result.error) throw result.error;
        return (result.data || []).map(mapCoffeeReportRow);
      };
    }
    window.mergeRevisionRecordsByDate = mergeExtendedRecords;
    window.enrichRevisionCalculations = records => core.calculateRevisionSeries(records, { tareKg:core.DEFAULT_TARE_KG });
  }

  function installInterfaceOverrides(){
    window.revisionValueClass = (label, value) => {
      const number = core.numberValue(value);
      if(number === null) return '';
      const normalizedLabel = String(label || '');
      if(normalizedLabel.startsWith('Разница')) return number >= 0 ? ' revision-positive' : ' revision-negative';
      if(normalizedLabel.startsWith('Потери')) return number === 0 ? ' revision-positive' : ' revision-negative';
      if(normalizedLabel.startsWith('Общий остаток')) return number >= 0 ? ' revision-positive' : ' revision-negative';
      return '';
    };

    window.renderRevisionRecordsTable = function(){
      const records = getRevisionRecords();
      if(state.revisionLoading) return '<div class="empty-control"><h3>Загружаю данные ревизий…</h3><p>Подключаюсь к Supabase.</p></div>';
      if(!records.length) return `<div class="empty-control"><h3>Пока нет отправленных ревизий</h3><p>После отправки формы «Ревизия кофе» запись появится здесь и в Supabase.</p>${state.revisionError ? `<p class="control-error">${esc(state.revisionError)}</p>` : ''}</div>`;
      const sorted = mergeExtendedRecords(records);
      const columns = sorted.slice(-14);
      const rows = [
        ['Значение на весах (кг.)', record => record.hopperWeight],
        ['Вскрыто пачек (шт.)', record => record.openedPacks],
        ['Поставка зерна (кг.)', record => record.grainDelivery],
        ['Списания (кг.)', record => record.writeOffs],
        ['Продажи в iiko (кг.)', record => record.iikoSales],
        ['Разница (кг.)', record => record.difference],
        ['Потери всего (кг.)', record => record.totalLossWeight],
        ['Потери от продаж', record => record.losses],
        ['Ответственный', record => record.employeeName],
        ['Проверено', record => record.checked],
        ['Чистый вес кофе в бункере', record => record.cleanHopperWeight],
        ['Общий расход кофе', record => record.totalCoffeeUsage],
        ['Общий остаток зерна (кг.)', record => record.totalGrainBalance],
        ['Дата и время заполнения', record => formatDateTime(record.createdAt)],
      ];
      return `<div class="control-table-wrap">${state.revisionError ? `<p class="control-error">${esc(state.revisionError)} Показана локальная резервная копия.</p>` : ''}<table class="control-table revision-pivot"><thead><tr><th>Дата ревизии</th>${columns.map(record => `<th>${esc(record.date || displayDateFromKey(record.dateKey) || formatDateOnly(record.createdAt))}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, getter]) => `<tr><th>${esc(label)}</th>${columns.map(record => { const value = getter(record); const display = value === undefined || value === null || String(value) === '' ? '—' : value; return `<td class="${revisionValueClass(label, display).trim()}">${esc(display)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
    };

    window.exportRevisionCsv = function(){
      const rows = [['Дата','Дата и время','Сотрудник','Вес бункера, кг','Вскрыто пачек, шт.','Поставка зерна, кг','Списания, кг','Продажи iiko, кг','Разница, кг','Потери всего, кг','Потери от продаж, %','Общий расход кофе, кг','Общий остаток зерна, кг','Проверено']];
      mergeExtendedRecords(getRevisionRecords()).forEach(record => rows.push([
        record.date || displayDateFromKey(record.dateKey) || formatDateOnly(record.createdAt),
        formatDateTime(record.createdAt),
        record.employeeName || '',
        record.hopperWeight || '',
        record.openedPacks || '',
        record.grainDelivery || '',
        record.writeOffs || '',
        record.iikoSales || '',
        record.difference || '',
        record.totalLossWeight || '',
        record.losses || '',
        record.totalCoffeeUsage || '',
        record.totalGrainBalance || '',
        record.checked || '',
      ]));
      downloadCsv('coffee_revisions.csv', rows);
    };
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
          <p><b>Общий остаток зерна:</b> остаток предыдущего дня + поставка − общий расход. Первый остаток задаётся вручную; новая ручная проверка становится следующей контрольной точкой.</p>
        </div>
      </details>`);
  }

  function refreshCalculatedData(){
    try {
      if(typeof state !== 'undefined' && Array.isArray(state.revisionRecords)){
        state.revisionRecords = mergeExtendedRecords(state.revisionRecords);
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

  installDataOverrides();
  installInterfaceOverrides();
  document.addEventListener('submit', interceptManualSubmit, true);
  new MutationObserver(scheduleEnsure).observe(document.documentElement, { childList:true, subtree:true });
  ensureFormulaNote();
  setTimeout(refreshCalculatedData, 0);
})();
