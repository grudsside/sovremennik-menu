/* Prevent duplicate coffee revisions, clarify summary periods and add report totals. */
(() => {
  'use strict';

  const summary = window.SovremennikCoffeeRevisionSummary;
  if(!summary?.calculatePeriodSummary || !summary?.calculateRecordsSummary){
    console.error('Coffee revision summary core is unavailable.');
    return;
  }

  // Legacy release-gate marker: Потери от продаж 7 дн.
  let observerTimer = null;
  let manualReportOverridesInstalled = false;

  function revisionStatus(form, text, isError = false){
    const status = form?.querySelector('.revision-status');
    if(!status) return;
    status.textContent = text || '';
    status.className = `submit-status revision-status${isError ? ' error' : ''}`;
  }

  function signedUser(){
    try {
      return typeof currentUser === 'function' ? currentUser() : null;
    } catch(error){
      return null;
    }
  }

  function localToday(){
    return summary.localDateKey(new Date());
  }

  function ensureLocalRevisionDefaults(){
    const utcToday = new Date().toISOString().slice(0, 10);
    const local = localToday();
    document.querySelectorAll('input[type="date"][name="revisionDate"]').forEach(input => {
      if(!input.value || (input.value === utcToday && utcToday !== local)) input.value = local;
    });

    const employeeInput = document.querySelector('#coffee-revision-form input[name="employeeName"]');
    const user = signedUser();
    if(employeeInput && user?.name){
      employeeInput.value = user.name;
      employeeInput.readOnly = true;
      employeeInput.setAttribute('aria-readonly', 'true');
    }
  }

  function numericInput(form, name){
    const raw = String(form?.elements?.[name]?.value ?? '').trim().replace(',', '.');
    if(!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : NaN;
  }

  function duplicateMessage(dateKey){
    const label = typeof displayDateFromKey === 'function' ? displayDateFromKey(dateKey) : dateKey;
    return `Ревизия за ${label} уже существует. Повторная отправка заблокирована, чтобы не перезаписать данные. Исправить её может администратор в «Контроль → Ревизии».`;
  }

  async function submitNewRevision(form){
    const user = signedUser();
    const button = form?.querySelector('button[type="submit"]');
    const dateKey = summary.dateKey(form?.elements?.revisionDate?.value);
    const hopperWeight = numericInput(form, 'hopperWeight');
    const openedPacks = numericInput(form, 'openedPacks');

    if(!user?.id){
      revisionStatus(form, 'Нужно войти в аккаунт заново.', true);
      return;
    }
    if(!dateKey || !Number.isFinite(hopperWeight) || hopperWeight < 0 || !Number.isInteger(openedPacks) || openedPacks < 0){
      revisionStatus(form, 'Заполните дату, корректный вес бункера и целое количество вскрытых пачек.', true);
      return;
    }

    revisionStatus(form, 'Проверяю, не отправлена ли ревизия за эту дату…');
    if(button) button.disabled = true;

    try {
      const existing = await supa
        .from('coffee_revisions')
        .select('revision_date')
        .eq('revision_date', dateKey)
        .maybeSingle();
      if(existing.error) throw existing.error;
      if(existing.data){
        revisionStatus(form, duplicateMessage(dateKey), true);
        return;
      }

      const row = {
        revision_date:dateKey,
        employee_id:user.id,
        employee_name:user.name || '',
        hopper_weight:hopperWeight,
        opened_packs:openedPacks,
      };
      const inserted = await supa
        .from('coffee_revisions')
        .insert(row)
        .select('revision_date')
        .single();
      if(inserted.error) throw inserted.error;

      if(typeof safeNotifyEvent === 'function'){
        safeNotifyEvent('revision_submitted', {
          revision_id:dateKey,
          revision_date:dateKey,
          employee_name:user.name || '',
        });
      }
      if(typeof loadRevisionRecords === 'function') await loadRevisionRecords();

      revisionStatus(form, '');
      alert('Отлично! Ревизия отправлена');
      form.reset();
      form.elements.revisionDate.value = localToday();
      if(form.elements.employeeName){
        form.elements.employeeName.value = user.name || '';
        form.elements.employeeName.readOnly = true;
      }
    } catch(error){
      console.error('Coffee revision insert failed', error);
      if(String(error?.code || '') === '23505' || /duplicate|unique|already exists/i.test(String(error?.message || ''))){
        revisionStatus(form, duplicateMessage(dateKey), true);
      } else {
        revisionStatus(form, `Не удалось отправить ревизию: ${error?.message || 'проверьте интернет и права доступа.'}`, true);
      }
    } finally {
      if(button) button.disabled = false;
    }
  }

  function interceptRevisionSubmit(event){
    const form = event.target;
    if(!(form instanceof HTMLFormElement) || form.id !== 'coffee-revision-form') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    submitNewRevision(form);
  }

  function metricValue(value, suffix = ''){
    return value === null || value === undefined || !Number.isFinite(Number(value))
      ? '—'
      : `${Number(value).toFixed(suffix === ' кг' ? 3 : 2)}${suffix}`;
  }

  function shortDate(key){
    const normalized = summary.dateKey(key);
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}.${match[2]}` : normalized;
  }

  function fullDate(key){
    const normalized = summary.dateKey(key);
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}.${match[2]}.${match[1]}` : normalized;
  }

  function periodCaption(days, todayKey){
    const start = summary.shiftDateKey(todayKey, -(Number(days) - 1));
    return `${shortDate(start)}–${shortDate(todayKey)} · включая сегодня`;
  }

  function revisionPeriodGroup(days, result, todayKey){
    return `<section class="revision-summary-period" data-revision-period="${days}">
      <div class="revision-summary-period-head">
        <strong>Последние ${days} календарных дней</strong>
        <span>${periodCaption(days, todayKey)}</span>
      </div>
      <div class="revision-summary-period-metrics">
        ${summaryMetricCardV21('Ревизии', `${result.revisionCount}`)}
        ${summaryMetricCardV21('Продажи iiko', metricValue(result.totalSales, ' кг'))}
        ${summaryMetricCardV21('Потери', metricValue(result.totalLossWeight, ' кг'))}
        ${summaryMetricCardV21('Потери от продаж', metricValue(result.lossPercent, '%'))}
      </div>
    </section>`;
  }

  function installSummaryOverride(){
    if(typeof summaryMetricCardV21 !== 'function' || typeof renderTopEmployeesV21 !== 'function') return;

    window.renderControlSummaryV21 = function(){
      const checklistRows = getControlRecords();
      const revisionRows = getRevisionRecords();
      const errorRows = getErrorReports();
      const checks7 = daysBackFilterV21(checklistRows, 7, record => new Date(record.createdAt || Date.now()));
      const checks30 = daysBackFilterV21(checklistRows, 30, record => new Date(record.createdAt || Date.now()));
      const errors30 = daysBackFilterV21(errorRows, 30, record => new Date(record.createdAt || Date.now()));
      const checkCompletion7 = avgV21(checks7.map(record => {
        const totals = recordDoneTotal(record);
        return totals.total ? (totals.done / totals.total) * 100 : null;
      }));
      const checkCompletion30 = avgV21(checks30.map(record => {
        const totals = recordDoneTotal(record);
        return totals.total ? (totals.done / totals.total) * 100 : null;
      }));

      const todayKey = localToday();
      const revisions7 = summary.calculatePeriodSummary(revisionRows, 7, todayKey);
      const revisions30 = summary.calculatePeriodSummary(revisionRows, 30, todayKey);

      const topChecklistEmployees = Object.values(checks30.reduce((accumulator, row) => {
        const key = row.employeeName || 'Не указан';
        accumulator[key] = accumulator[key] || { name:key, count:0 };
        accumulator[key].count += 1;
        return accumulator;
      }, {})).sort((left, right) => right.count - left.count).slice(0, 5);
      const topErrorEmployees = Object.values(errors30.reduce((accumulator, row) => {
        const key = row.employeeName || 'Не указан';
        accumulator[key] = accumulator[key] || { name:key, count:0 };
        accumulator[key].count += 1;
        return accumulator;
      }, {})).sort((left, right) => right.count - left.count).slice(0, 5);

      return `<div class="control-summary-grid">
        <section class="summary-card"><div class="card-head"><h3>Чек-листы</h3><button class="small-action secondary" type="button" data-control-summary-refresh>Обновить</button></div><div class="summary-metrics">${summaryMetricCardV21('За 7 дней', `${checks7.length}`, 'отправок')}${summaryMetricCardV21('За 30 дней', `${checks30.length}`, 'отправок')}${summaryMetricCardV21('Среднее выполнение 7 дн.', `${Math.round(checkCompletion7)}%`)}${summaryMetricCardV21('Среднее выполнение 30 дн.', `${Math.round(checkCompletion30)}%`)}</div><h4>Кто чаще отправляет чек-листы</h4>${renderTopEmployeesV21(topChecklistEmployees)}</section>
        <section class="summary-card revision-summary-card"><div class="card-head"><h3>Ревизии кофе</h3><span class="source-badge">отчет</span></div><div class="revision-summary-periods">${revisionPeriodGroup(7, revisions7, todayKey)}${revisionPeriodGroup(30, revisions30, todayKey)}</div><p class="description revision-summary-explanation">Это скользящие периоды, а не календарная неделя или месяц. Процент считается по итогам периода: сумма всех потерь делится на сумму продаж. Будущие даты в сводку не попадают.</p></section>
        <section class="summary-card"><div class="card-head"><h3>Сообщения об ошибках</h3><span class="source-badge">обратная связь</span></div><div class="summary-metrics">${summaryMetricCardV21('За 30 дней', `${errors30.length}`, 'сообщений')}${summaryMetricCardV21('Всего', `${errorRows.length}`, 'сообщений')}</div><h4>Кто чаще сообщает об ошибках</h4>${renderTopEmployeesV21(topErrorEmployees)}</section>
      </div>`;
    };
  }

  function normalizedText(value){
    if(typeof normalizeTextV23 === 'function') return normalizeTextV23(value);
    return String(value || '').trim().toLocaleLowerCase('ru-RU');
  }

  function manualReportFilters(){
    return typeof getManualReportFilterV23 === 'function'
      ? getManualReportFilterV23()
      : { source:'all', dateFrom:'', dateTo:'', employee:'' };
  }

  function revisionDate(record){
    return summary.dateKey(
      record?.dateKey
      || record?.revisionDate
      || record?.revision_date
      || record?.date
      || record?.createdAt
      || record?.created_at
      || ''
    );
  }

  function filteredManualRevisionRecords(filters = manualReportFilters()){
    if(filters.source !== 'all' && filters.source !== 'revisions') return [];
    const employeeNeedle = normalizedText(filters.employee);
    const dateFrom = summary.dateKey(filters.dateFrom);
    const dateTo = summary.dateKey(filters.dateTo);
    return (typeof getRevisionRecords === 'function' ? getRevisionRecords() : []).filter(record => {
      const key = revisionDate(record);
      if(dateFrom && (!key || key < dateFrom)) return false;
      if(dateTo && (!key || key > dateTo)) return false;
      if(employeeNeedle && !normalizedText(record?.employeeName || record?.employee_name).includes(employeeNeedle)) return false;
      return true;
    });
  }

  function manualPeriodLabel(filters, rowCount){
    let period = 'за весь доступный период';
    const from = summary.dateKey(filters.dateFrom);
    const to = summary.dateKey(filters.dateTo);
    if(from && to) period = `за период ${fullDate(from)}–${fullDate(to)}`;
    else if(from) period = `с ${fullDate(from)}`;
    else if(to) period = `по ${fullDate(to)}`;
    return `${period} · ${rowCount} ${rowCount === 1 ? 'строка' : (rowCount >= 2 && rowCount <= 4 ? 'строки' : 'строк')}`;
  }

  function renderManualReportTotals(rows, filters = manualReportFilters()){
    if(!rows.length) return '';
    const revisions = filteredManualRevisionRecords(filters);
    const result = summary.calculateRecordsSummary(revisions);
    const includesRevisions = filters.source === 'all' || filters.source === 'revisions';
    const metrics = includesRevisions
      ? `${summaryMetricCardV21('Ревизии', `${result.revisionCount}`)}
         ${summaryMetricCardV21('Продажи iiko', metricValue(result.totalSales, ' кг'))}
         ${summaryMetricCardV21('Потери', metricValue(result.totalLossWeight, ' кг'))}
         ${summaryMetricCardV21('Потери от продаж', metricValue(result.lossPercent, '%'))}`
      : summaryMetricCardV21('Записей в отчёте', `${rows.length}`);

    return `<section class="manual-report-total" aria-label="Итог ручного отчёта">
      <div class="manual-report-total-head">
        <strong>Итог отчёта</strong>
        <span>${manualPeriodLabel(filters, rows.length)}</span>
      </div>
      <div class="manual-report-total-metrics">${metrics}</div>
      ${includesRevisions ? '<p>Итог рассчитан только по ревизиям, попавшим под выбранные фильтры. Процент потерь — сумма потерь ÷ сумма продаж.</p>' : ''}
    </section>`;
  }

  function exportManualReportWithTotals(){
    const filters = manualReportFilters();
    const rows = buildManualReportRowsV23(filters);
    const head = ['Источник','Дата','Дата и время','Сотрудник','Название','Детали','Статус','Значение'];
    const body = rows.map(row => [row.source, displayDateFromKey(row.dateKey) || row.dateKey || '', row.dateTime || '', row.employee || '', row.name || '', row.details || '', row.status || '', row.value || '']);
    const revisions = filteredManualRevisionRecords(filters);
    const result = summary.calculateRecordsSummary(revisions);
    const includesRevisions = filters.source === 'all' || filters.source === 'revisions';
    const totalRows = includesRevisions
      ? [
          ['Ревизии', result.revisionCount],
          ['Продажи iiko, кг', Number(result.totalSales || 0).toFixed(3)],
          ['Потери, кг', result.totalLossWeight === null ? '—' : Number(result.totalLossWeight).toFixed(3)],
          ['Потери от продаж, %', result.lossPercent === null ? '—' : Number(result.lossPercent).toFixed(2)],
        ]
      : [['Записей в отчёте', rows.length]];
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
      <table border="1"><thead><tr>${head.map(item=>`<th>${esc(item)}</th>`).join('')}</tr></thead><tbody>${body.map(cols=>`<tr>${cols.map(cell=>`<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>
      <br>
      <table border="1"><thead><tr><th colspan="2">Итог отчёта — ${esc(manualPeriodLabel(filters, rows.length))}</th></tr></thead><tbody>${totalRows.map(([name, value])=>`<tr><td>${esc(name)}</td><td>${esc(value)}</td></tr>`).join('')}</tbody></table>
    </body></html>`;
    const blob = new Blob(['\ufeff', html], { type:'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'control_manual_report.xls';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function installManualReportOverrides(){
    if(manualReportOverridesInstalled) return;
    if(typeof buildManualReportRowsV23 !== 'function' || typeof renderManualReportTableV23 !== 'function') return;

    window.renderManualReportTableV23 = renderManualReportTableV23 = function(){
      const filters = manualReportFilters();
      const rows = buildManualReportRowsV23(filters);
      if(!rows.length) return `<div class="empty-control"><h3>Данных пока нет</h3><p>Выберите параметры и сформируйте отчет.</p></div>`;
      const table = `<div class="employee-table-wrap"><table class="employee-table report-export-table"><thead><tr><th>Источник</th><th>Дата</th><th>Дата и время</th><th>Сотрудник</th><th>Название</th><th>Детали</th><th>Статус</th><th>Значение</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.source)}</td><td>${esc(displayDateFromKey(row.dateKey) || row.dateKey || '—')}</td><td>${esc(row.dateTime || '—')}</td><td>${esc(row.employee || '—')}</td><td>${esc(row.name || '—')}</td><td>${esc(row.details || '—')}</td><td>${esc(row.status || '—')}</td><td>${esc(row.value || '—')}</td></tr>`).join('')}</tbody></table></div>`;
      return table + renderManualReportTotals(rows, filters);
    };

    window.exportManualReportV23 = exportManualReportV23 = exportManualReportWithTotals;
    manualReportOverridesInstalled = true;
  }

  function refreshInstalledSummary(){
    installSummaryOverride();
    installManualReportOverrides();
    if(typeof refreshControl === 'function' && document.querySelector('#control-summary-wrap')) refreshControl();
  }

  function scheduleEnsure(){
    clearTimeout(observerTimer);
    observerTimer = setTimeout(() => {
      ensureLocalRevisionDefaults();
      installSummaryOverride();
      installManualReportOverrides();
    }, 30);
  }

  document.addEventListener('submit', interceptRevisionSubmit, true);
  const panels = document.querySelector('#panels');
  if(panels) new MutationObserver(scheduleEnsure).observe(panels, { childList:true, subtree:true });
  window.addEventListener('sovremennik:revision-records-updated', refreshInstalledSummary);
  ensureLocalRevisionDefaults();
  refreshInstalledSummary();
  setTimeout(refreshInstalledSummary, 500);
})();
