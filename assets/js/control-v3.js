/* Современник — Control v3 isolated renderer and lifecycle. */
(function(global){
  'use strict';

  if(global.SovremennikControlV3) return;

  const Core = global.SovremennikControlV3Core;
  if(!Core || typeof state === 'undefined' || typeof renderApp !== 'function'){
    console.error('Control v3 cannot start: core application state is unavailable.');
    return;
  }

  const VERSION = '2026-07-30-control-v3-1';
  const legacy = Object.freeze({
    renderApp:typeof renderApp === 'function' ? renderApp : null,
    setControlTab:typeof setControlTab === 'function' ? setControlTab : null,
    refreshControl:typeof refreshControl === 'function' ? refreshControl : null
  });
  const signatures = new Map();
  let eventLayerInstalled = false;
  let renderingApp = false;

  const html = value => typeof esc === 'function'
    ? esc(value)
    : String(value ?? '').replace(/[&<>\"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[character]));

  function currentRole(){
    try{
      return typeof normalizeRole === 'function'
        ? normalizeRole(currentUser()?.role)
        : String(currentUser()?.role || '').trim().toLowerCase();
    }catch(error){
      return '';
    }
  }

  function maySeeAttestations(){
    return ['admin','manager'].includes(currentRole());
  }

  function tabs(){
    const result = [
      ['summary','Сводка'],
      ['checklists','Чек-листы'],
      ['revisions','Ревизии'],
      ['errors','Ошибки']
    ];
    if(maySeeAttestations()) result.push(['attestations','Аттестации']);
    return result;
  }

  function activeTab(){
    const normalized = Core.normalizeTab(state.activeControl);
    if(normalized === 'attestations' && !maySeeAttestations()) return 'checklists';
    return normalized;
  }

  function toolbar(text, actions){
    return `<div class="control-v3-toolbar"><p>${html(text)}</p><div class="doc-actions">${actions}</div></div>`;
  }

  function summaryBody(){
    const summary = typeof renderControlSummaryV21 === 'function' ? renderControlSummaryV21() : '';
    const report = typeof renderManualReportBuilderV23 === 'function' ? renderManualReportBuilderV23() : '';
    return `${toolbar(
      'Сводка собирается из чек-листов, ревизий и сообщений об ошибках. Обновление не перерисовывает остальные вкладки.',
      '<button type="button" class="small-action secondary" data-control-v3-refresh="summary">Обновить сводку</button>'
    )}<div id="control-summary-wrap">${summary}${report}</div>`;
  }

  function checklistsBody(){
    const content = typeof renderControlRecordsTable === 'function'
      ? renderControlRecordsTable()
      : '<div class="empty-control"><h3>Раздел недоступен</h3></div>';
    return `${toolbar(
      'Отправленные чек-листы загружаются из Supabase. Вкладка работает независимо от ревизий, ошибок и аттестаций.',
      '<button type="button" class="refresh-control" data-control-v3-refresh="checklists">Обновить данные</button><button type="button" class="download-control-csv" data-control-v3-export="checklists">Скачать CSV</button>'
    )}<div id="control-records">${content}</div>`;
  }

  function revisionsBody(){
    const form = typeof renderRevisionManualForm === 'function' ? renderRevisionManualForm() : '';
    const content = typeof renderRevisionRecordsTable === 'function'
      ? renderRevisionRecordsTable()
      : '<div class="empty-control"><h3>Раздел недоступен</h3></div>';
    return `${toolbar(
      'Ежедневные ревизии кофе. Ручные корректировки и выгрузка сохранены.',
      '<button type="button" class="refresh-revisions" data-control-v3-refresh="revisions">Обновить данные</button><button type="button" class="download-revisions-csv" data-control-v3-export="revisions">Скачать CSV</button>'
    )}${form}<div id="revision-records">${content}</div>`;
  }

  function errorsBody(){
    const content = typeof renderErrorReportsTable === 'function'
      ? renderErrorReportsTable()
      : '<div class="empty-control"><h3>Раздел недоступен</h3></div>';
    return `${toolbar(
      'Сообщения сотрудников об ошибках и неисправностях.',
      '<button type="button" class="refresh-errors" data-control-v3-refresh="errors">Обновить данные</button>'
    )}<div id="error-records">${content}</div>`;
  }

  function standardBody(tab){
    if(tab === 'summary') return summaryBody();
    if(tab === 'revisions') return revisionsBody();
    if(tab === 'errors') return errorsBody();
    return checklistsBody();
  }

  function folderHtml(tab, current){
    const active = tab === current;
    return `<div class="control-folder control-v3-folder ${active ? 'active' : ''}" id="control-${tab}" data-control-v3-folder="${tab}" ${active ? '' : 'hidden'}>${active ? standardBody(tab) : ''}</div>`;
  }

  function renderControlV3(){
    const current = activeTab();
    state.activeControl = current;
    const nav = tabs().map(([id, label]) => `<button class="subtab ${id === current ? 'active' : ''}" data-control-target="${id}" type="button" aria-selected="${id === current ? 'true' : 'false'}">${html(label)}</button>`).join('');
    const standardFolders = Core.STANDARD_TABS.map(tab => folderHtml(tab, current)).join('');
    return `<section class="top-panel control-v3 ${state.activeTop === 'control' ? 'active' : ''}" id="top-control" data-control-version="${VERSION}">
      <div class="section-heading"><p>Журнал</p><h2>Контроль</h2></div>
      <div class="subtabs control-subtabs" role="tablist" aria-label="Разделы контроля">${nav}</div>
      <div class="control-v3-stage" data-control-v3-stage>${standardFolders}</div>
    </section>`;
  }

  function folder(tab){
    return document.querySelector(`#top-control #control-${CSS.escape(tab)}`);
  }

  function captureFields(root){
    const rows = [];
    root?.querySelectorAll?.('input,select,textarea').forEach((field, index) => {
      if(!field.name && !field.id) return;
      rows.push({
        key:`${field.tagName}:${field.name || field.id}:${index}`,
        name:field.name || '',
        id:field.id || '',
        type:field.type || '',
        value:field.value,
        checked:Boolean(field.checked)
      });
    });
    return rows;
  }

  function restoreFields(root, rows){
    if(!Array.isArray(rows)) return;
    const fields = Array.from(root?.querySelectorAll?.('input,select,textarea') || []);
    rows.forEach((saved, index) => {
      const field = fields.find(candidate =>
        (saved.id && candidate.id === saved.id)
        || (saved.name && candidate.name === saved.name && fields.indexOf(candidate) === index)
      ) || fields[index];
      if(!field) return;
      if(['checkbox','radio'].includes(saved.type)) field.checked = saved.checked;
      else if(!field.value || field.name === 'employee' || field.name === 'body') field.value = saved.value;
    });
  }

  function queueEnhancements(){
    try{ global.SovremennikChecklistPhotoReports?.queueEnhance?.(); }catch(error){ console.warn(error); }
    try{ global.SovremennikChecklistReviewTools?.queueEnhance?.(); }catch(error){ console.warn(error); }
  }

  function rememberSignature(tab){
    if(Core.STANDARD_TABS.includes(tab)) signatures.set(tab, Core.tabSignature(state, tab));
  }

  function syncAfterFullRender(){
    const root = document.querySelector('#top-control');
    if(!root) return;
    root.dataset.controlVersion = VERSION;
    const current = activeTab();
    Core.STANDARD_TABS.forEach(tab => {
      const target = folder(tab);
      if(!target) return;
      const active = tab === current;
      target.classList.toggle('active', active);
      target.hidden = !active;
      if(active && !target.innerHTML.trim()) target.innerHTML = standardBody(tab);
      if(!active && target.innerHTML.trim()) target.replaceChildren();
    });
    root.querySelectorAll('[data-control-target]').forEach(button => {
      const selected = button.dataset.controlTarget === current;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    rememberSignature(current);
    queueEnhancements();
  }

  function refreshActive(force = false){
    const root = document.querySelector('#top-control');
    if(!root || state.activeTop !== 'control') return false;
    const current = activeTab();
    if(!Core.STANDARD_TABS.includes(current)){
      queueEnhancements();
      return false;
    }
    const target = folder(current);
    if(!target) return false;
    const nextSignature = Core.tabSignature(state, current);
    if(!force && signatures.get(current) === nextSignature){
      queueEnhancements();
      return false;
    }
    const open = Core.captureOpen(target);
    const fields = captureFields(target);
    target.innerHTML = standardBody(current);
    Core.restoreOpen(target, open);
    restoreFields(target, fields);
    signatures.set(current, nextSignature);
    queueEnhancements();
    return true;
  }

  function normalizeFolderVisibility(target){
    const root = document.querySelector('#top-control');
    if(!root) return;
    root.querySelectorAll('.control-folder').forEach(item => {
      const selected = item.id === `control-${target}`;
      item.classList.toggle('active', selected);
      item.hidden = !selected;
    });
    root.querySelectorAll('[data-control-target]').forEach(button => {
      const selected = button.dataset.controlTarget === target;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  function setControlTabV3(target){
    const next = Core.normalizeTab(target);
    if(next === 'attestations' && !maySeeAttestations()) return;
    const previous = activeTab();

    if(legacy.setControlTab){
      try{ legacy.setControlTab.call(this, next); }
      catch(error){ console.warn('Legacy Control data hook failed.', error); }
    }else{
      state.activeControl = next;
    }
    state.activeControl = next;

    if(Core.STANDARD_TABS.includes(previous) && previous !== next){
      const oldFolder = folder(previous);
      if(oldFolder) oldFolder.replaceChildren();
      signatures.delete(previous);
    }

    if(Core.STANDARD_TABS.includes(next)){
      const targetFolder = folder(next);
      if(targetFolder && !targetFolder.innerHTML.trim()) targetFolder.innerHTML = standardBody(next);
      rememberSignature(next);
    }

    normalizeFolderVisibility(next);
    queueEnhancements();
  }

  function runRefresh(tab){
    if(tab === 'summary'){
      const jobs = [];
      if(typeof loadControlRecords === 'function') jobs.push(Promise.resolve(loadControlRecords()));
      if(typeof loadRevisionRecords === 'function') jobs.push(Promise.resolve(loadRevisionRecords()));
      if(typeof loadErrorReports === 'function') jobs.push(Promise.resolve(loadErrorReports()));
      return Promise.allSettled(jobs);
    }
    if(tab === 'checklists' && typeof loadControlRecords === 'function') return Promise.resolve(loadControlRecords());
    if(tab === 'revisions' && typeof loadRevisionRecords === 'function') return Promise.resolve(loadRevisionRecords());
    if(tab === 'errors' && typeof loadErrorReports === 'function') return Promise.resolve(loadErrorReports());
    return Promise.resolve();
  }

  function installEventLayer(){
    if(eventLayerInstalled) return;
    eventLayerInstalled = true;

    document.addEventListener('click', event => {
      const root = event.target?.closest?.('#top-control');
      if(!root) return;

      const tab = event.target.closest('[data-control-target]');
      if(tab){
        event.preventDefault();
        event.stopImmediatePropagation();
        setControlTabV3(tab.dataset.controlTarget);
        return;
      }

      const refresh = event.target.closest('[data-control-v3-refresh]');
      if(refresh){
        event.preventDefault();
        event.stopImmediatePropagation();
        const tabName = Core.normalizeTab(refresh.dataset.controlV3Refresh);
        refresh.disabled = true;
        Promise.resolve(runRefresh(tabName)).finally(() => { if(refresh.isConnected) refresh.disabled = false; });
        return;
      }

      const exportButton = event.target.closest('[data-control-v3-export]');
      if(exportButton){
        event.preventDefault();
        event.stopImmediatePropagation();
        if(exportButton.dataset.controlV3Export === 'checklists' && typeof exportControlCsv === 'function') exportControlCsv();
        if(exportButton.dataset.controlV3Export === 'revisions' && typeof exportRevisionCsv === 'function') exportRevisionCsv();
        return;
      }

      const summaryRefresh = event.target.closest('[data-control-summary-refresh]');
      if(summaryRefresh){
        event.preventDefault();
        event.stopImmediatePropagation();
        void runRefresh('summary');
        return;
      }

      const reset = event.target.closest('[data-report-reset]');
      if(reset){
        event.preventDefault();
        event.stopImmediatePropagation();
        state.manualReportFilter = { source:'all', dateFrom:'', dateTo:'', employee:'' };
        refreshActive(true);
        return;
      }

      const reportExport = event.target.closest('[data-report-export]');
      if(reportExport){
        event.preventDefault();
        event.stopImmediatePropagation();
        if(typeof exportManualReportV23 === 'function') exportManualReportV23();
      }
    }, true);

    document.addEventListener('submit', event => {
      const form = event.target;
      if(!form?.closest?.('#top-control')) return;

      if(form.id === 'revision-manual-form' && typeof submitRevisionManual === 'function'){
        event.preventDefault();
        event.stopImmediatePropagation();
        submitRevisionManual({ preventDefault(){}, currentTarget:form });
        return;
      }

      if(form.id === 'report-builder-form'){
        event.preventDefault();
        event.stopImmediatePropagation();
        state.manualReportFilter = {
          source:form.elements.source.value || 'all',
          dateFrom:form.elements.dateFrom.value || '',
          dateTo:form.elements.dateTo.value || '',
          employee:(form.elements.employee.value || '').trim()
        };
        const table = form.closest('#control-summary')?.querySelector('#manual-report-table');
        if(table && typeof renderManualReportTableV23 === 'function') table.innerHTML = renderManualReportTableV23();
      }
    }, true);
  }

  const renderAppBeforeV3 = legacy.renderApp;
  global.renderControl = renderControl = renderControlV3;
  global.refreshControl = refreshControl = refreshActive;
  global.setControlTab = setControlTab = setControlTabV3;

  if(renderAppBeforeV3){
    global.renderApp = renderApp = function(){
      if(renderingApp) return renderAppBeforeV3.apply(this, arguments);
      renderingApp = true;
      try{
        const result = renderAppBeforeV3.apply(this, arguments);
        syncAfterFullRender();
        return result;
      }finally{
        renderingApp = false;
      }
    };
  }

  installEventLayer();

  global.SovremennikControlV3 = Object.freeze({
    VERSION,
    renderControl:renderControlV3,
    refresh:refreshActive,
    setTab:setControlTabV3,
    sync:syncAfterFullRender,
    signatures,
    legacy
  });

  if(state.menu && (typeof isAuthenticated !== 'function' || isAuthenticated())){
    renderApp();
  }
})(window);
