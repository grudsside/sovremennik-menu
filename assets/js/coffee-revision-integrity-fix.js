/* Prevent duplicate coffee revisions, use local dates and fix revision summary aggregation. */
(() => {
  'use strict';

  const summary = window.SovremennikCoffeeRevisionSummary;
  if(!summary?.calculatePeriodSummary){
    console.error('Coffee revision summary core is unavailable.');
    return;
  }

  let observerTimer = null;

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
        <section class="summary-card"><div class="card-head"><h3>Ревизии кофе</h3><span class="source-badge">отчет</span></div><div class="summary-metrics">${summaryMetricCardV21('Ревизий за 7 дней', `${revisions7.revisionCount}`)}${summaryMetricCardV21('Ревизий за 30 дней', `${revisions30.revisionCount}`)}${summaryMetricCardV21('Продажи iiko за 7 дн.', metricValue(revisions7.totalSales, ' кг'))}${summaryMetricCardV21('Потери за 7 дн.', metricValue(revisions7.totalLossWeight, ' кг'))}${summaryMetricCardV21('Потери от продаж 7 дн.', metricValue(revisions7.lossPercent, '%'))}${summaryMetricCardV21('Продажи iiko за 30 дн.', metricValue(revisions30.totalSales, ' кг'))}${summaryMetricCardV21('Потери за 30 дн.', metricValue(revisions30.totalLossWeight, ' кг'))}${summaryMetricCardV21('Потери от продаж 30 дн.', metricValue(revisions30.lossPercent, '%'))}</div><p class="description">Процент считается по итогам периода: сумма всех потерь делится на сумму продаж. Будущие даты в сводку не попадают.</p></section>
        <section class="summary-card"><div class="card-head"><h3>Сообщения об ошибках</h3><span class="source-badge">обратная связь</span></div><div class="summary-metrics">${summaryMetricCardV21('За 30 дней', `${errors30.length}`, 'сообщений')}${summaryMetricCardV21('Всего', `${errorRows.length}`, 'сообщений')}</div><h4>Кто чаще сообщает об ошибках</h4>${renderTopEmployeesV21(topErrorEmployees)}</section>
      </div>`;
    };
  }

  function refreshInstalledSummary(){
    installSummaryOverride();
    if(typeof refreshControl === 'function' && document.querySelector('#control-summary-wrap')) refreshControl();
  }

  function scheduleEnsure(){
    clearTimeout(observerTimer);
    observerTimer = setTimeout(() => {
      ensureLocalRevisionDefaults();
      installSummaryOverride();
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
