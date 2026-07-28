/* Современник: редактирование и мягкое удаление вопросов аттестаций. */
(function(global){
  'use strict';

  const Core = global.SovAttestationsCore;
  const ManagementCore = global.SovAttestationsQuestionManagementCore;
  if(!Core || !ManagementCore){ console.error('Attestation question management core is not loaded.'); return; }

  const stateLocal = {
    rows: [],
    registry: new Map(),
    bank: [],
    questionsByFingerprint: new Map(),
    rowsByFingerprint: new Map(),
    loading: false,
    loaded: false,
    observer: null,
    decorateTimer: 0
  };

  function role(){
    try{
      const value = typeof currentUser === 'function' ? currentUser()?.role : '';
      return typeof normalizeRole === 'function' ? normalizeRole(value) : String(value || '').trim().toLowerCase();
    }catch(error){ return ''; }
  }
  function isAdmin(){ return role() === 'admin'; }
  function client(){
    try{ return global.sovremennikSupabase || (typeof supa !== 'undefined' ? supa : null); }
    catch(error){ return null; }
  }
  function userId(){
    try{ return typeof currentUser === 'function' ? currentUser()?.id || '' : ''; }
    catch(error){ return ''; }
  }
  function text(value){ return String(value == null ? '' : value).trim(); }
  function escapeHtml(value){
    if(typeof esc === 'function') return esc(value);
    return String(value ?? '').replace(/[&<>\"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));
  }
  function safeArray(value){ return Array.isArray(value) ? value : []; }
  function sourceIdentity(source){ return `${source.type}:${source.key}`; }
  function rowIdentity(question){ return `${text(question.prompt)}\u0000${text(question.sourceTitle)}\u0000${text(question.type)}`; }

  async function refreshData(){
    if(!isAdmin() || stateLocal.loading || typeof state === 'undefined' || !state?.menu) return;
    const db = client();
    if(!db) return;
    stateLocal.loading = true;
    try{
      const response = await db.from('attestation_questions').select('*').order('created_at', {ascending:false});
      if(response.error) throw response.error;
      stateLocal.rows = response.data || [];
      stateLocal.rowsByFingerprint = new Map(stateLocal.rows.map(row => [row.fingerprint, row]));
      const built = Core.generateQuestionBank(state.menu || {});
      stateLocal.registry = built.registry;
      stateLocal.bank = Core.mergeQuestionBank(built.questions, stateLocal.rows, built.registry);
      stateLocal.questionsByFingerprint = new Map(stateLocal.bank.map(question => [question.fingerprint, question]));
      stateLocal.loaded = true;
      scheduleDecorate();
    }catch(error){
      console.warn('Не удалось загрузить данные для управления вопросами.', error);
    }finally{
      stateLocal.loading = false;
    }
  }

  function questionBuckets(){
    const buckets = new Map();
    stateLocal.bank.forEach(question => {
      const key = rowIdentity(question);
      if(!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(question);
    });
    return buckets;
  }

  function decorateRows(){
    clearTimeout(stateLocal.decorateTimer);
    if(!isAdmin() || !stateLocal.loaded) return;
    const rows = Array.from(document.querySelectorAll('#top-attestations .att-bank-list .att-question-row'));
    if(!rows.length) return;
    const buckets = questionBuckets();

    rows.forEach(article => {
      const prompt = text(article.querySelector('h4')?.textContent);
      const meta = text(article.querySelector('p')?.textContent);
      const pieces = meta.split(' · ');
      const sourceTitle = text(pieces[0]);
      const type = text(pieces[pieces.length - 1]);
      const candidates = buckets.get(`${prompt}\u0000${sourceTitle}\u0000${type}`) || [];
      const question = candidates.shift();
      if(!question) return;

      article.dataset.attQmFingerprint = question.fingerprint;
      const tags = article.querySelectorAll('.att-row-tags span');
      if(tags[1] && question.origin === 'override') tags[1].textContent = 'изменён администратором';

      article.querySelector('.att-qm-actions')?.remove();
      const actions = document.createElement('div');
      actions.className = 'att-qm-actions';
      actions.innerHTML = `<button class="mini-admin-btn" type="button" data-att-qm-edit="${escapeHtml(question.fingerprint)}">Редактировать</button><button class="mini-admin-btn danger" type="button" data-att-qm-delete="${escapeHtml(question.fingerprint)}">Удалить</button>`;
      article.appendChild(actions);
    });
  }

  function scheduleDecorate(){
    clearTimeout(stateLocal.decorateTimer);
    stateLocal.decorateTimer = setTimeout(decorateRows, 40);
  }

  function sourceOptions(topic, selectedIdentity = ''){
    return Array.from(stateLocal.registry.values())
      .filter(source => !topic || source.topic === topic)
      .sort((left, right) => left.title.localeCompare(right.title, 'ru'))
      .map(source => {
        const identity = sourceIdentity(source);
        return `<option value="${escapeHtml(identity)}" ${identity === selectedIdentity ? 'selected' : ''}>${escapeHtml(source.title)}</option>`;
      }).join('');
  }

  function ensureModal(){
    let modal = document.querySelector('[data-att-qm-modal]');
    if(modal) return modal;
    modal = document.createElement('div');
    modal.className = 'att-qm-modal';
    modal.dataset.attQmModal = '';
    modal.hidden = true;
    modal.innerHTML = `<section class="att-qm-dialog" role="dialog" aria-modal="true" aria-labelledby="att-qm-title">
      <div class="card-head"><div><p class="att-qm-kicker">Банк вопросов</p><h3 id="att-qm-title">Редактировать вопрос</h3></div><button class="small-action secondary" type="button" data-att-qm-close>Закрыть</button></div>
      <form data-att-qm-form>
        <input type="hidden" name="fingerprint">
        <label>Тема<select name="topic" required>${Object.entries(Core.TOPICS).map(([topic,label]) => `<option value="${escapeHtml(topic)}">${escapeHtml(label)}</option>`).join('')}</select></label>
        <label>Источник<select name="source" required></select></label>
        <label>Тип вопроса<select name="type"><option value="single">Один правильный ответ</option><option value="multiple">Несколько правильных ответов</option><option value="number">Числовой ответ</option></select></label>
        <label>Вопрос<textarea name="prompt" rows="3" required></textarea></label>
        <label data-att-qm-options>Варианты ответа<textarea name="options" rows="6" placeholder="Каждый вариант с новой строки"></textarea></label>
        <label>Правильный ответ<textarea name="correct" rows="3" required placeholder="Для нескольких ответов — каждый с новой строки"></textarea></label>
        <label data-att-qm-tolerance hidden>Допустимое отклонение<input name="tolerance" type="number" min="0" step="0.01" value="0"></label>
        <label>Пояснение после теста<textarea name="explanation" rows="2"></textarea></label>
        <div class="att-qm-footer"><button class="small-action" type="submit">Сохранить изменения</button><p class="submit-status" data-att-qm-status aria-live="polite"></p></div>
      </form>
    </section>`;
    document.body.appendChild(modal);

    modal.querySelector('[data-att-qm-close]')?.addEventListener('click', closeModal);
    modal.addEventListener('click', event => { if(event.target === modal) closeModal(); });
    const form = modal.querySelector('[data-att-qm-form]');
    form?.elements.topic.addEventListener('change', () => {
      form.elements.source.innerHTML = sourceOptions(form.elements.topic.value);
    });
    form?.elements.type.addEventListener('change', () => updateTypeFields(form));
    form?.addEventListener('submit', saveQuestion);
    return modal;
  }

  function updateTypeFields(form){
    const numeric = form.elements.type.value === 'number';
    form.querySelector('[data-att-qm-options]').hidden = numeric;
    form.querySelector('[data-att-qm-tolerance]').hidden = !numeric;
  }

  function openEditor(fingerprint){
    const question = stateLocal.questionsByFingerprint.get(fingerprint);
    if(!question) return;
    const modal = ensureModal();
    const form = modal.querySelector('[data-att-qm-form]');
    form.reset();
    form.elements.fingerprint.value = question.fingerprint;
    form.elements.topic.value = question.topic;
    form.elements.source.innerHTML = sourceOptions(question.topic, `${question.sourceType}:${question.sourceKey}`);
    form.elements.type.value = question.type;
    form.elements.prompt.value = question.prompt;
    form.elements.options.value = safeArray(question.options).join('\n');
    form.elements.correct.value = question.type === 'multiple' ? safeArray(question.correctAnswer).join('\n') : String(question.correctAnswer ?? '');
    form.elements.tolerance.value = Number(question.tolerance || 0);
    form.elements.explanation.value = question.explanation || '';
    modal.querySelector('[data-att-qm-status]').textContent = '';
    updateTypeFields(form);
    modal.hidden = false;
    document.body.classList.add('att-qm-open');
    setTimeout(() => form.elements.prompt.focus(), 0);
  }

  function closeModal(){
    const modal = document.querySelector('[data-att-qm-modal]');
    if(modal) modal.hidden = true;
    document.body.classList.remove('att-qm-open');
  }

  function parsedQuestion(form){
    const rawSource = text(form.elements.source.value);
    const separator = rawSource.indexOf(':');
    const source = separator >= 0 ? stateLocal.registry.get(rawSource) : null;
    if(!source) throw new Error('Выберите актуальный источник.');

    const questionType = form.elements.type.value;
    const prompt = text(form.elements.prompt.value);
    if(prompt.length < 3) throw new Error('Введите текст вопроса.');
    const options = String(form.elements.options.value || '').split('\n').map(text).filter(Boolean);
    let correctAnswer;
    if(questionType === 'multiple') correctAnswer = String(form.elements.correct.value || '').split('\n').map(text).filter(Boolean);
    else if(questionType === 'number') correctAnswer = Number(String(form.elements.correct.value || '').replace(',', '.'));
    else correctAnswer = text(form.elements.correct.value);

    if(questionType !== 'number' && options.length < 3) throw new Error('Добавьте минимум три варианта ответа.');
    if(questionType === 'number' && !Number.isFinite(correctAnswer)) throw new Error('Введите корректный числовой ответ.');
    if(questionType === 'single' && !options.includes(correctAnswer)) throw new Error('Правильный ответ должен быть среди вариантов.');
    if(questionType === 'multiple' && (!correctAnswer.length || correctAnswer.some(value => !options.includes(value)))) throw new Error('Все правильные ответы должны быть среди вариантов.');

    return {
      topic: source.topic,
      source_type: source.type,
      source_key: source.key,
      source_title: source.title,
      source_version: source.version,
      question_type: questionType,
      prompt,
      options: questionType === 'number' ? [] : options,
      correct_answer: correctAnswer,
      tolerance: questionType === 'number' ? Number(form.elements.tolerance.value || 0) : 0,
      explanation: text(form.elements.explanation.value),
      is_active: true,
      deleted_at: null,
      deleted_by: null,
      updated_by: userId(),
      updated_at: new Date().toISOString()
    };
  }

  async function saveQuestion(event){
    event.preventDefault();
    if(!isAdmin()) return;
    const form = event.currentTarget;
    const status = form.querySelector('[data-att-qm-status]');
    const fingerprint = text(form.elements.fingerprint.value);
    const existing = stateLocal.rowsByFingerprint.get(fingerprint);
    try{
      const payload = parsedQuestion(form);
      status.textContent = 'Сохраняю…';
      status.className = 'submit-status';
      const db = client();
      let response;
      if(existing?.id){
        response = await db.from('attestation_questions').update(payload).eq('id', existing.id).select().single();
      }else{
        response = await db.from('attestation_questions').insert({...payload, fingerprint, created_by:userId()}).select().single();
      }
      if(response.error) throw response.error;
      closeModal();
      await reloadFeature();
    }catch(error){
      console.error(error);
      status.textContent = error.message || 'Не удалось сохранить вопрос.';
      status.className = 'submit-status error';
    }
  }

  function questionRowPayload(question){
    return {
      topic: question.topic,
      source_type: question.sourceType,
      source_key: question.sourceKey,
      source_title: question.sourceTitle,
      source_version: question.sourceVersion,
      question_type: question.type,
      prompt: question.prompt,
      options: safeArray(question.options),
      correct_answer: question.correctAnswer,
      tolerance: Number(question.tolerance || 0),
      explanation: question.explanation || '',
      fingerprint: question.fingerprint,
      is_active: false,
      deleted_at: new Date().toISOString(),
      deleted_by: userId(),
      updated_by: userId(),
      updated_at: new Date().toISOString()
    };
  }

  async function deleteQuestion(fingerprint, button){
    if(!isAdmin()) return;
    const question = stateLocal.questionsByFingerprint.get(fingerprint);
    if(!question) return;
    if(!confirm(`Удалить вопрос «${question.prompt}»? Он перестанет использоваться при создании новых тестов.`)) return;
    const existing = stateLocal.rowsByFingerprint.get(fingerprint);
    button.disabled = true;
    try{
      const db = client();
      const payload = questionRowPayload(question);
      let response;
      if(existing?.id){
        response = await db.from('attestation_questions').update({
          is_active:false,
          deleted_at:payload.deleted_at,
          deleted_by:payload.deleted_by,
          updated_by:payload.updated_by,
          updated_at:payload.updated_at
        }).eq('id', existing.id);
      }else{
        response = await db.from('attestation_questions').insert({...payload, created_by:userId()});
      }
      if(response.error) throw response.error;
      closeModal();
      await reloadFeature();
    }catch(error){
      console.error(error);
      alert('Не удалось удалить вопрос: ' + (error.message || 'ошибка доступа.'));
      button.disabled = false;
    }
  }

  async function reloadFeature(){
    await refreshData();
    const refresh = document.querySelector('#top-attestations [data-att-refresh]');
    if(refresh) refresh.click();
    setTimeout(refreshData, 700);
  }

  function bindGlobalEvents(){
    document.addEventListener('click', event => {
      const edit = event.target.closest('[data-att-qm-edit]');
      if(edit){ event.preventDefault(); openEditor(edit.dataset.attQmEdit); return; }
      const remove = event.target.closest('[data-att-qm-delete]');
      if(remove){ event.preventDefault(); deleteQuestion(remove.dataset.attQmDelete, remove); return; }
      if(event.target.closest('[data-att-open-question]') || event.target.closest('[data-att-refresh]')) setTimeout(refreshData, 700);
    });
    document.addEventListener('submit', event => {
      if(event.target?.id === 'att-question-form') setTimeout(refreshData, 900);
    }, true);
    document.addEventListener('keydown', event => { if(event.key === 'Escape') closeModal(); });
  }

  function boot(){
    if(!isAdmin()) return;
    bindGlobalEvents();
    stateLocal.observer = new MutationObserver(scheduleDecorate);
    stateLocal.observer.observe(document.documentElement, {childList:true, subtree:true});
    refreshData().then(() => {
      document.querySelector('#top-attestations [data-att-refresh]')?.click();
      scheduleDecorate();
    });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})(window);