/* Современник checklist template editor — admin-only preview integration. */
(function(){
  'use strict';

  const core = window.SovremennikChecklistEditorCore;
  if(!core || typeof state === 'undefined') return;

  const VERSION = '2026-07-24-checklist-editor-1';
  const CACHE_KEY = 'sovremennikChecklistTemplateOverridesV1';
  let overridesPromise = null;
  let enhanceQueued = false;
  let eventsInstalled = false;

  Object.assign(state, {
    checklistTemplateOverrides:Array.isArray(state.checklistTemplateOverrides) ? state.checklistTemplateOverrides : null,
    checklistTemplateOverridesError:state.checklistTemplateOverridesError || ''
  });

  const loadMenuBeforeEditor = typeof loadMenu === 'function' ? loadMenu : null;
  const renderAppBeforeEditor = typeof renderApp === 'function' ? renderApp : null;
  const setTopBeforeEditor = typeof setTop === 'function' ? setTop : null;

  function html(value){
    if(typeof esc === 'function') return esc(value);
    return String(value ?? '').replace(/[&<>\"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));
  }
  function attr(value){ return html(value).replace(/'/g, '&#39;'); }
  function admin(){ return typeof isAdmin === 'function' && isAdmin(); }
  function authenticated(){ return typeof isAuthenticated === 'function' ? isAuthenticated() : (typeof currentUser === 'function' && Boolean(currentUser()?.id)); }
  function readCache(){
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); }
    catch(error){ return []; }
  }
  function writeCache(rows){
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(rows || [])); }
    catch(error){}
  }
  function upsertCache(row){
    const rows = readCache().filter(item => String(item.checklist_id) !== String(row.checklist_id));
    rows.push(row);
    writeCache(rows);
  }
  function removeCache(checklistId){ writeCache(readCache().filter(row => String(row.checklist_id) !== String(checklistId))); }
  function checklistDoc(id){ return (state.menu?.checklists || []).find(doc => String(doc.id) === String(id)) || null; }

  async function fetchOverrides(force = false){
    if(!authenticated() || typeof supa === 'undefined') return readCache();
    if(!force && Array.isArray(state.checklistTemplateOverrides)) return state.checklistTemplateOverrides;
    if(overridesPromise) return overridesPromise;
    overridesPromise = (async () => {
      const result = await supa
        .from('checklist_template_overrides')
        .select('checklist_id,title,description,sections,version,updated_at')
        .order('checklist_id', { ascending:true });
      if(result.error) throw result.error;
      state.checklistTemplateOverrides = result.data || [];
      state.checklistTemplateOverridesError = '';
      writeCache(state.checklistTemplateOverrides);
      return state.checklistTemplateOverrides;
    })().catch(error => {
      console.warn('Checklist template overrides are unavailable', error);
      state.checklistTemplateOverridesError = error.message || 'Не удалось загрузить изменения чек-листов.';
      state.checklistTemplateOverrides = readCache();
      return state.checklistTemplateOverrides;
    }).finally(() => { overridesPromise = null; });
    return overridesPromise;
  }
  async function applyOverridesToMenu(menu, force = false){
    const rows = await fetchOverrides(force);
    return core.applyOverrides(menu, rows);
  }

  function rowHtml(checklistId, row, sectionIndex, rowIndex){
    const itemKey = core.rowItemKey(checklistId, row, sectionIndex, rowIndex);
    return `<div class="checklist-editor-row" data-checklist-editor-row data-item-key="${attr(itemKey)}">
      <label class="checklist-editor-task">Пункт<textarea rows="2" data-editor-task placeholder="Что нужно выполнить">${html(row?.task || row?.text || '')}</textarea></label>
      <label>Ответственный<input type="text" data-editor-responsible value="${attr(row?.responsible || '')}" placeholder="Необязательно"></label>
      <label>Минимум<input type="text" data-editor-min value="${attr(row?.min || '')}" placeholder="Для минимальных остатков"></label>
      <div class="checklist-editor-row-actions">
        <button type="button" class="editor-icon-btn" data-editor-row-up aria-label="Переместить пункт вверх">↑</button>
        <button type="button" class="editor-icon-btn" data-editor-row-down aria-label="Переместить пункт вниз">↓</button>
        <button type="button" class="editor-icon-btn danger" data-editor-row-delete aria-label="Удалить пункт">×</button>
      </div>
    </div>`;
  }
  function sectionHtml(checklistId, section, sectionIndex){
    const rows = Array.isArray(section?.rows) && section.rows.length ? section.rows : [{ itemKey:core.createItemKey(checklistId), task:'' }];
    return `<article class="checklist-editor-section" data-checklist-editor-section>
      <div class="checklist-editor-section-head">
        <label>Название раздела<input type="text" data-editor-section-title value="${attr(section?.title || '')}" placeholder="Например, Бар"></label>
        <label>Тип раздела<select data-editor-section-type><option value="" ${section?.type === 'minlist' ? '' : 'selected'}>Обычный список</option><option value="minlist" ${section?.type === 'minlist' ? 'selected' : ''}>Минимальные остатки</option></select></label>
        <div class="checklist-editor-section-actions">
          <button type="button" class="editor-icon-btn" data-editor-section-up aria-label="Переместить раздел вверх">↑</button>
          <button type="button" class="editor-icon-btn" data-editor-section-down aria-label="Переместить раздел вниз">↓</button>
          <button type="button" class="editor-icon-btn danger" data-editor-section-delete aria-label="Удалить раздел">×</button>
        </div>
      </div>
      <div class="checklist-editor-rows" data-editor-rows>${rows.map((row, rowIndex) => rowHtml(checklistId, row, sectionIndex, rowIndex)).join('')}</div>
      <button type="button" class="small-action secondary checklist-editor-add-row" data-editor-add-row>+ Добавить пункт</button>
    </article>`;
  }
  function modalHtml(doc){
    const version = Number(doc?.__templateVersion || 0);
    const sections = Array.isArray(doc?.sections) && doc.sections.length ? doc.sections : [{ title:'Новый раздел', rows:[{ itemKey:core.createItemKey(doc.id), task:'' }] }];
    return `<div class="checklist-editor-modal" data-checklist-editor-modal aria-hidden="false">
      <div class="checklist-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="checklist-editor-title">
        <div class="checklist-editor-header">
          <div><p>Настройка шаблона</p><h3 id="checklist-editor-title">Редактирование чек-листа</h3></div>
          <button type="button" class="editor-close" data-editor-close aria-label="Закрыть">×</button>
        </div>
        <form data-checklist-editor-form data-checklist-id="${attr(doc.id)}" data-template-version="${version}">
          <div class="checklist-editor-main-fields">
            <label>Название чек-листа<input type="text" name="title" value="${attr(doc.title || '')}" maxlength="160" required></label>
            <label>Описание<textarea name="description" rows="3" maxlength="2000" placeholder="Краткое пояснение для сотрудников">${html(doc.description || '')}</textarea></label>
          </div>
          <div class="checklist-editor-sections" data-editor-sections>${sections.map((section, index) => sectionHtml(doc.id, section, index)).join('')}</div>
          <button type="button" class="small-action secondary checklist-editor-add-section" data-editor-add-section>+ Добавить раздел</button>
          <div class="checklist-editor-footer">
            <p class="submit-status" data-editor-status aria-live="polite"></p>
            <div class="checklist-editor-footer-actions">
              ${doc.__templateOverride ? '<button type="button" class="small-action ghost" data-editor-reset>Сбросить изменения</button>' : ''}
              <button type="button" class="small-action secondary" data-editor-close>Отмена</button>
              <button type="submit" class="small-action" data-editor-save>Сохранить</button>
            </div>
          </div>
        </form>
      </div>
    </div>`;
  }
  function closeEditor(){
    document.querySelector('[data-checklist-editor-modal]')?.remove();
    document.body.classList.remove('checklist-editor-open');
  }
  function openEditor(checklistId){
    if(!admin()) return;
    const doc = checklistDoc(checklistId);
    if(!doc) return alert('Чек-лист не найден. Обновите страницу и повторите попытку.');
    closeEditor();
    document.body.insertAdjacentHTML('beforeend', modalHtml(doc));
    document.body.classList.add('checklist-editor-open');
    document.querySelector('[data-checklist-editor-form] input[name="title"]')?.focus();
  }
  function status(message, kind = ''){
    const element = document.querySelector('[data-editor-status]');
    if(!element) return;
    element.textContent = message || '';
    element.className = `submit-status${kind ? ` ${kind}` : ''}`;
  }
  function moveElement(element, direction){
    if(!element) return;
    if(direction < 0 && element.previousElementSibling) element.parentElement.insertBefore(element, element.previousElementSibling);
    if(direction > 0 && element.nextElementSibling) element.parentElement.insertBefore(element.nextElementSibling, element);
  }
  function collectForm(form){
    const checklistId = form.dataset.checklistId || '';
    const sections = Array.from(form.querySelectorAll('[data-checklist-editor-section]')).map(section => {
      const rows = Array.from(section.querySelectorAll('[data-checklist-editor-row]')).map(row => ({
        itemKey:row.dataset.itemKey || core.createItemKey(checklistId),
        task:row.querySelector('[data-editor-task]')?.value || '',
        responsible:row.querySelector('[data-editor-responsible]')?.value || '',
        min:row.querySelector('[data-editor-min]')?.value || ''
      }));
      return {
        title:section.querySelector('[data-editor-section-title]')?.value || '',
        type:section.querySelector('[data-editor-section-type]')?.value || '',
        rows
      };
    });
    return core.validateTemplate({
      id:checklistId,
      title:form.elements.title.value,
      description:form.elements.description.value,
      sections
    });
  }
  async function saveEditor(form){
    if(!admin()) return;
    const checked = collectForm(form);
    if(!checked.ok){ status(checked.errors[0], 'error'); return; }
    const save = form.querySelector('[data-editor-save]');
    const expectedVersion = Number(form.dataset.templateVersion || 0);
    save.disabled = true;
    status('Сохраняю изменения…');
    try{
      const result = await supa.rpc('save_checklist_template_override', {
        p_checklist_id:checked.template.id,
        p_title:checked.template.title,
        p_description:checked.template.description,
        p_sections:checked.template.sections,
        p_expected_version:expectedVersion
      });
      if(result.error) throw result.error;
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if(row) upsertCache(row);
      state.checklistTemplateOverrides = null;
      state.menu = await loadMenu();
      closeEditor();
      renderApp();
      setTop('checklists');
      alert('Чек-лист обновлён. Изменения уже доступны сотрудникам.');
    } catch(error){
      console.error(error);
      const concurrent = String(error?.code || '') === '40001' || /другим администратором|updated/i.test(String(error?.message || ''));
      status(concurrent ? 'Чек-лист уже изменён в другой вкладке. Закройте редактор, обновите страницу и повторите правку.' : `Не удалось сохранить: ${error.message || 'проверьте подключение.'}`, 'error');
    } finally { save.disabled = false; }
  }
  async function resetEditor(form){
    if(!admin()) return;
    const checklistId = form.dataset.checklistId || '';
    if(!confirm('Сбросить все изменения этого чек-листа и вернуть исходный шаблон?')) return;
    status('Возвращаю исходный шаблон…');
    try{
      const result = await supa.rpc('reset_checklist_template_override', { p_checklist_id:checklistId });
      if(result.error) throw result.error;
      removeCache(checklistId);
      state.checklistTemplateOverrides = null;
      state.menu = await loadMenu();
      closeEditor();
      renderApp();
      setTop('checklists');
      alert('Исходный шаблон восстановлен.');
    } catch(error){
      console.error(error);
      status(`Не удалось сбросить изменения: ${error.message || 'проверьте подключение.'}`, 'error');
    }
  }

  function enhanceChecklistCards(){
    if(!admin()) return;
    document.querySelectorAll('.doc-card[data-checklist-id]').forEach(card => {
      const actions = card.querySelector('.doc-actions');
      if(!actions || actions.querySelector('[data-checklist-template-edit]')) return;
      actions.insertAdjacentHTML('beforeend', `<button type="button" class="small-action secondary checklist-template-edit" data-checklist-template-edit="${attr(card.dataset.checklistId)}">Редактировать</button>`);
      if(card.dataset.checklistId && checklistDoc(card.dataset.checklistId)?.__templateOverride){
        card.classList.add('checklist-template-overridden');
        const badge = card.querySelector('.source-badge');
        if(badge && !card.querySelector('.checklist-template-status')) badge.insertAdjacentHTML('afterend', '<span class="checklist-template-status">изменён</span>');
      }
    });
  }
  function installEvents(){
    if(eventsInstalled) return;
    eventsInstalled = true;
    document.addEventListener('click', event => {
      const edit = event.target.closest('[data-checklist-template-edit]');
      if(edit){ event.preventDefault(); openEditor(edit.dataset.checklistTemplateEdit); return; }
      if(event.target.closest('[data-editor-close]')){ event.preventDefault(); closeEditor(); return; }
      const modal = event.target.closest('[data-checklist-editor-modal]');
      if(modal && event.target === modal){ closeEditor(); return; }
      const section = event.target.closest('[data-checklist-editor-section]');
      const row = event.target.closest('[data-checklist-editor-row]');
      if(event.target.closest('[data-editor-section-up]')){ moveElement(section, -1); return; }
      if(event.target.closest('[data-editor-section-down]')){ moveElement(section, 1); return; }
      if(event.target.closest('[data-editor-row-up]')){ moveElement(row, -1); return; }
      if(event.target.closest('[data-editor-row-down]')){ moveElement(row, 1); return; }
      if(event.target.closest('[data-editor-section-delete]')){
        const all = section?.parentElement?.querySelectorAll('[data-checklist-editor-section]') || [];
        if(all.length <= 1) return status('В чек-листе должен остаться хотя бы один раздел.', 'error');
        section.remove(); return;
      }
      if(event.target.closest('[data-editor-row-delete]')){
        const all = row?.parentElement?.querySelectorAll('[data-checklist-editor-row]') || [];
        if(all.length <= 1) return status('В разделе должен остаться хотя бы один пункт.', 'error');
        row.remove(); return;
      }
      if(event.target.closest('[data-editor-add-row]')){
        const form = event.target.closest('[data-checklist-editor-form]');
        const checklistId = form?.dataset.checklistId || '';
        const rows = section?.querySelector('[data-editor-rows]');
        rows?.insertAdjacentHTML('beforeend', rowHtml(checklistId, { itemKey:core.createItemKey(checklistId), task:'' }, 0, rows.children.length));
        rows?.lastElementChild?.querySelector('[data-editor-task]')?.focus();
        return;
      }
      if(event.target.closest('[data-editor-add-section]')){
        const form = event.target.closest('[data-checklist-editor-form]');
        const checklistId = form?.dataset.checklistId || '';
        const sections = form?.querySelector('[data-editor-sections]');
        sections?.insertAdjacentHTML('beforeend', sectionHtml(checklistId, { title:'', rows:[{ itemKey:core.createItemKey(checklistId), task:'' }] }, sections.children.length));
        sections?.lastElementChild?.querySelector('[data-editor-section-title]')?.focus();
        return;
      }
      if(event.target.closest('[data-editor-reset]')){
        const form = event.target.closest('[data-checklist-editor-form]');
        resetEditor(form); return;
      }
    });
    document.addEventListener('submit', event => {
      const form = event.target.closest('[data-checklist-editor-form]');
      if(!form) return;
      event.preventDefault();
      saveEditor(form);
    });
    document.addEventListener('keydown', event => {
      if(event.key === 'Escape' && document.querySelector('[data-checklist-editor-modal]')) closeEditor();
    });
  }
  function queueEnhance(){
    if(enhanceQueued) return;
    enhanceQueued = true;
    requestAnimationFrame(() => { enhanceQueued = false; installEvents(); enhanceChecklistCards(); });
  }

  if(loadMenuBeforeEditor){
    window.loadMenu = loadMenu = async function(...args){
      const menu = await loadMenuBeforeEditor.apply(this, args);
      return applyOverridesToMenu(menu);
    };
  }
  if(renderAppBeforeEditor){
    window.renderApp = renderApp = function(...args){
      const result = renderAppBeforeEditor.apply(this, args);
      queueMicrotask(queueEnhance);
      return result;
    };
  }
  if(setTopBeforeEditor){
    window.setTop = setTop = function(target){
      const result = setTopBeforeEditor(target);
      if(target === 'checklists') queueMicrotask(queueEnhance);
      return result;
    };
  }

  window.SovremennikChecklistEditor = Object.freeze({
    VERSION,
    fetchOverrides,
    applyOverridesToMenu,
    openEditor,
    closeEditor,
    collectForm,
    enhanceChecklistCards,
    queueEnhance
  });

  installEvents();
  queueEnhance();
})();
