/* Современник: надёжная привязка кнопок управления к карточкам банка вопросов. */
(function(global){
  'use strict';

  const Core = global.SovAttestationsCore;
  if(!Core) return;

  let bank = [];
  let rowsLoaded = false;
  let loading = false;
  let timer = 0;

  function role(){
    try{
      const value = typeof currentUser === 'function' ? currentUser()?.role : '';
      return typeof normalizeRole === 'function' ? normalizeRole(value) : String(value || '').trim().toLowerCase();
    }catch(error){ return ''; }
  }
  function authenticated(){
    try{ return typeof isAuthenticated === 'function' && isAuthenticated(); }
    catch(error){ return false; }
  }
  function isAdmin(){ return authenticated() && role() === 'admin'; }
  function db(){
    try{ return global.sovremennikSupabase || (typeof supa !== 'undefined' ? supa : null); }
    catch(error){ return null; }
  }
  function escapeHtml(value){
    if(typeof esc === 'function') return esc(value);
    return String(value ?? '').replace(/[&<>\"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));
  }

  async function loadBank(){
    if(!isAdmin() || loading || typeof state === 'undefined' || !state?.menu) return;
    const client = db();
    if(!client) return;
    loading = true;
    try{
      const response = await client.from('attestation_questions').select('*').order('created_at', {ascending:false});
      if(response.error) throw response.error;
      const built = Core.generateQuestionBank(state.menu || {});
      bank = Core.mergeQuestionBank(built.questions, response.data || [], built.registry);
      rowsLoaded = true;
      decorate();
    }catch(error){
      console.warn('Не удалось подготовить кнопки управления вопросами.', error);
    }finally{
      loading = false;
      publishDiagnostics();
    }
  }

  function filteredBank(){
    const active = document.querySelector('#top-attestations [data-att-bank-filter].active');
    const filter = active?.dataset.attBankFilter || 'all';
    return bank.filter(question => filter === 'all' || question.topic === filter).slice(0, 120);
  }

  function decorate(){
    clearTimeout(timer);
    if(!isAdmin()) return;
    if(!rowsLoaded){ loadBank(); return; }
    const cards = Array.from(document.querySelectorAll('#top-attestations .att-bank-list .att-question-row'));
    const visible = filteredBank();
    cards.forEach((card, index) => {
      const question = visible[index];
      if(!question) return;
      card.dataset.attQmFingerprint = question.fingerprint;
      const tags = card.querySelectorAll('.att-row-tags span');
      if(tags[1] && question.origin === 'override') tags[1].textContent = 'изменён администратором';
      card.querySelector('.att-qm-actions')?.remove();
      const actions = document.createElement('div');
      actions.className = 'att-qm-actions';
      actions.innerHTML = `<button class="mini-admin-btn" type="button" data-att-qm-edit="${escapeHtml(question.fingerprint)}">Редактировать</button><button class="mini-admin-btn danger" type="button" data-att-qm-delete="${escapeHtml(question.fingerprint)}">Удалить</button>`;
      card.appendChild(actions);
    });
    publishDiagnostics();
  }

  function publishDiagnostics(){
    global.SovAttestationsQuestionManagementButtons = {
      authenticated:authenticated(),
      role:role(),
      bankCount:bank.length,
      rowsLoaded,
      cardCount:document.querySelectorAll('#top-attestations .att-bank-list .att-question-row').length,
      actionCount:document.querySelectorAll('#top-attestations [data-att-qm-edit]').length
    };
  }

  function schedule(){
    clearTimeout(timer);
    timer = setTimeout(decorate, 80);
  }

  document.addEventListener('click', event => {
    if(event.target.closest('[data-att-bank-filter]') || event.target.closest('[data-att-admin-tab="bank"]') || event.target.closest('[data-att-refresh]')){
      setTimeout(loadBank, 250);
      setTimeout(schedule, 600);
    }
  }, true);
  document.addEventListener('submit', event => {
    if(event.target?.id === 'login-form' || event.target?.id === 'att-question-form' || event.target?.matches?.('[data-att-qm-form]')){
      setTimeout(loadBank, 500);
      setTimeout(schedule, 1000);
    }
  }, true);
  new MutationObserver(schedule).observe(document.documentElement, {childList:true, subtree:true});
  setInterval(() => {
    if(isAdmin() && !rowsLoaded) loadBank();
    else schedule();
  }, 1500);
  setTimeout(loadBank, 250);
  schedule();
})(window);