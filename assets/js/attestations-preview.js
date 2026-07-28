/* Аттестации preview: source-bound question bank, automatic test assembly and protected results. */
(function(){
  'use strict';

  const Core = window.SovAttestationsCore;
  if(!Core){ console.error('Attestations core is not loaded.'); return; }

  const STORE_KEY = 'sovremennikAttestationAttemptDraftV1';
  const ui = {
    patched: false,
    loading: false,
    loaded: false,
    error: '',
    generated: [],
    registry: new Map(),
    manualQuestions: [],
    bank: [],
    tests: [],
    assignments: [],
    results: [],
    activeAdminTab: 'create',
    activeEmployeeTab: 'assigned',
    activeAttempt: null,
    attemptAnswers: {},
    currentQuestion: 0,
    timerHandle: null,
    bankFilter: 'all'
  };

  const topicEntries = () => Object.entries(Core.TOPICS);
  const role = () => typeof normalizeRole === 'function' ? normalizeRole(currentUser()?.role) : String(currentUser()?.role || '').toLowerCase();
  const canTakeTests = () => ['barista','waiter'].includes(role());
  const canSeeResults = () => ['admin','manager'].includes(role());
  const isAttestationAdmin = () => role() === 'admin';
  const e = value => typeof esc === 'function' ? esc(value) : String(value ?? '').replace(/[&<>\"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));
  const fmtDate = value => {
    if(!value) return 'без срока';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'});
  };
  const asArray = value => Array.isArray(value) ? value : [];

  function sourceKey(source){ return `${source.type}:${source.key}`; }

  function ensureAccessModel(){
    try{
      if(Array.isArray(ALL_SECTIONS) && !ALL_SECTIONS.includes('attestations')) ALL_SECTIONS.splice(Math.max(ALL_SECTIONS.indexOf('control'), 0), 0, 'attestations');
      ['barista','waiter'].forEach(targetRole => {
        const defaults = DEFAULT_ACCESS_BY_ROLE?.[targetRole];
        if(Array.isArray(defaults) && !defaults.includes('attestations')){
          const before = defaults.indexOf('reportError');
          defaults.splice(before >= 0 ? before : defaults.length, 0, 'attestations');
        }
        const active = state.rolePermissions?.[targetRole];
        if(Array.isArray(active) && !active.includes('attestations')) active.push('attestations');
      });
      if(state.menu?.site?.mainTabs && !state.menu.site.mainTabs.some(tab => tab.id === 'attestations')){
        const tabs = state.menu.site.mainTabs;
        const before = tabs.findIndex(tab => tab.id === 'reportError');
        tabs.splice(before >= 0 ? before : tabs.length, 0, {id:'attestations', title:'Аттестации'});
      }
    }catch(error){ console.warn('Attestation access model was not extended.', error); }
  }

  function patchApplication(){
    if(ui.patched) return;
    ui.patched = true;

    const originalHasAccess = hasAccess;
    hasAccess = function(target){
      if(target === 'attestations') return isAttestationAdmin() || canTakeTests();
      return originalHasAccess(target);
    };

    const originalRenderApp = renderApp;
    renderApp = function(){
      ensureAccessModel();
      const result = originalRenderApp.apply(this, arguments);
      injectAttestationPanel();
      injectControlResults();
      return result;
    };

    const originalSetTop = setTop;
    setTop = function(target){
      const result = originalSetTop.apply(this, arguments);
      if(target === 'attestations') loadAll(false);
      return result;
    };

    const originalSetControlTab = setControlTab;
    setControlTab = function(target){
      const result = originalSetControlTab.apply(this, arguments);
      if(target === 'attestations') loadResults(false);
      return result;
    };

    const originalRefreshControl = refreshControl;
    refreshControl = function(){
      const result = originalRefreshControl.apply(this, arguments);
      injectControlResults();
      return result;
    };
  }

  function buildLocalBank(){
    const built = Core.generateQuestionBank(state.menu || {});
    ui.registry = built.registry;
    ui.generated = built.questions;
    ui.bank = Core.mergeQuestionBank(ui.generated, ui.manualQuestions, ui.registry);
  }

  async function loadManualQuestions(){
    if(!isAttestationAdmin()){ ui.manualQuestions = []; return; }
    const res = await supa.from('attestation_questions').select('*').order('created_at', {ascending:false});
    if(res.error) throw res.error;
    ui.manualQuestions = res.data || [];
  }

  async function loadAdminTests(){
    if(!isAttestationAdmin()){ ui.tests = []; return; }
    const res = await supa.rpc('list_admin_attestation_tests');
    if(res.error) throw res.error;
    ui.tests = Array.isArray(res.data) ? res.data : [];
  }

  async function loadAssignments(){
    if(!canTakeTests()){ ui.assignments = []; return; }
    const res = await supa.rpc('list_my_attestations');
    if(res.error) throw res.error;
    ui.assignments = Array.isArray(res.data) ? res.data : [];
  }

  async function loadResults(rerender = true){
    if(!canSeeResults()){ ui.results = []; return; }
    try{
      const res = await supa.rpc('list_attestation_results');
      if(res.error) throw res.error;
      ui.results = Array.isArray(res.data) ? res.data : [];
      if(rerender) renderControlResults();
    }catch(error){
      console.warn(error);
      ui.error = error.message || 'Не удалось загрузить результаты аттестаций.';
      if(rerender) renderControlResults();
    }
  }

  async function loadAll(force = false){
    if(ui.loading || (ui.loaded && !force)) return;
    ui.loading = true;
    ui.error = '';
    renderAttestationBody();
    try{
      buildLocalBank();
      await Promise.all([loadManualQuestions(), loadAdminTests(), loadAssignments(), loadResults(false)]);
      buildLocalBank();
      ui.loaded = true;
    }catch(error){
      console.error(error);
      ui.error = error.message || 'Не удалось загрузить раздел аттестаций. Проверьте миграцию Supabase.';
    }finally{
      ui.loading = false;
      renderAttestationBody();
      renderControlResults();
    }
  }

  function injectAttestationPanel(){
    if(!isAuthenticated() || !(isAttestationAdmin() || canTakeTests())) return;
    ensureAccessModel();
    const panels = document.querySelector('#panels');
    if(!panels) return;
    let panel = document.querySelector('#top-attestations');
    if(!panel){
      panel = document.createElement('section');
      panel.id = 'top-attestations';
      panel.className = `top-panel ${state.activeTop === 'attestations' ? 'active' : ''}`;
      panels.appendChild(panel);
    }
    panel.classList.toggle('active', state.activeTop === 'attestations');
    renderAttestationBody();
    if(state.activeTop === 'attestations') loadAll(false);
  }

  function renderAttestationBody(){
    const panel = document.querySelector('#top-attestations');
    if(!panel) return;
    panel.innerHTML = `<div class="section-heading method-heading"><div><p>Проверка знаний</p><h2>Аттестации</h2></div><button class="small-action secondary" type="button" data-att-refresh>Обновить</button></div>
      ${ui.error ? `<div class="att-alert error">${e(ui.error)}</div>` : ''}
      ${ui.loading ? '<div class="att-loading">Загружаю тесты и банк вопросов…</div>' : (isAttestationAdmin() ? renderAdminWorkspace() : renderEmployeeWorkspace())}`;
    bindAttestationEvents();
  }

  function renderAdminWorkspace(){
    const validCounts = topicEntries().map(([topic, label]) => {
      const available = ui.bank.filter(question => question.topic === topic && question.validity?.valid).length;
      return `<div class="att-stat"><span>${e(label)}</span><b>${available}</b><small>доступно для сборки</small></div>`;
    }).join('');
    return `<div class="att-stats">${validCounts}</div>
      <div class="subtabs att-subtabs">
        <button class="subtab ${ui.activeAdminTab === 'create' ? 'active' : ''}" data-att-admin-tab="create" type="button">Создать тест</button>
        <button class="subtab ${ui.activeAdminTab === 'bank' ? 'active' : ''}" data-att-admin-tab="bank" type="button">Банк вопросов</button>
        <button class="subtab ${ui.activeAdminTab === 'tests' ? 'active' : ''}" data-att-admin-tab="tests" type="button">Созданные тесты</button>
      </div>
      <div class="att-folder ${ui.activeAdminTab === 'create' ? 'active' : ''}" data-att-folder="create">${renderTestBuilder()}</div>
      <div class="att-folder ${ui.activeAdminTab === 'bank' ? 'active' : ''}" data-att-folder="bank">${renderBank()}</div>
      <div class="att-folder ${ui.activeAdminTab === 'tests' ? 'active' : ''}" data-att-folder="tests">${renderTests()}</div>`;
  }

  function renderEmployeeWorkspace(){
    if(ui.activeAttempt) return renderAttempt();
    const assignments = ui.assignments;
    if(!assignments.length){
      return `<div class="att-empty"><h3>Назначенных аттестаций пока нет</h3><p>Когда администратор назначит тест, он появится здесь.</p></div>`;
    }
    return `<div class="att-assignment-grid">${assignments.map(renderAssignmentCard).join('')}</div>`;
  }

  function assignmentStatus(row){
    if(row.passed) return {className:'passed', label:'Пройдена'};
    if(row.due_at && new Date(row.due_at).getTime() < Date.now()) return {className:'overdue', label:'Просрочена'};
    if(Number(row.attempt_count || 0) >= Number(row.max_attempts || 1)) return {className:'failed', label:'Попытки закончились'};
    if(Number(row.attempt_count || 0) > 0) return {className:'retry', label:'Можно повторить'};
    return {className:'new', label:'Не начата'};
  }

  function renderAssignmentCard(row){
    const status = assignmentStatus(row);
    const attemptsLeft = Math.max(0, Number(row.max_attempts || 1) - Number(row.attempt_count || 0));
    const disabled = row.passed || attemptsLeft <= 0 || (row.due_at && new Date(row.due_at).getTime() < Date.now());
    return `<article class="att-card">
      <div class="card-head"><div><span class="att-status ${status.className}">${e(status.label)}</span><h3>${e(row.title)}</h3></div><span class="source-badge">${e(row.question_count)} вопросов</span></div>
      <p class="description">${e(row.description || 'Обязательная проверка знаний.')}</p>
      <div class="att-meta"><span>Проходной балл: <b>${e(row.pass_percent)}%</b></span><span>Попыток осталось: <b>${attemptsLeft}</b></span><span>Срок: <b>${e(fmtDate(row.due_at))}</b></span>${row.best_score != null ? `<span>Лучший результат: <b>${e(row.best_score)}%</b></span>` : ''}</div>
      <button class="small-action" type="button" data-att-start="${e(row.assignment_id)}" ${disabled ? 'disabled' : ''}>${Number(row.attempt_count || 0) ? 'Пройти ещё раз' : 'Начать аттестацию'}</button>
    </article>`;
  }

  function employeesForAssignment(){
    return asArray(state.employees).filter(person => person?.id && ['barista','waiter'].includes(typeof normalizeRole === 'function' ? normalizeRole(person.role) : person.role));
  }

  function renderTestBuilder(){
    const employeeRows = employeesForAssignment();
    const availability = Object.fromEntries(topicEntries().map(([topic]) => [topic, ui.bank.filter(question => question.topic === topic && question.validity?.valid).length]));
    return `<div class="att-layout">
      <form class="att-card att-builder" id="att-test-form">
        <div class="card-head"><h3>Автоматически собрать и назначить тест</h3><span class="source-badge">только актуальные источники</span></div>
        <p class="description">Выберите темы и количество вопросов. Система случайно соберёт тест из актуального банка и сохранит снимок используемых материалов.</p>
        <div class="form-grid">
          <label>Название теста<input name="title" type="text" required placeholder="Например, Аттестация бариста · август"></label>
          <label>Срок прохождения<input name="dueAt" type="datetime-local" required></label>
          <label>Проходной балл, %<input name="passPercent" type="number" min="1" max="100" value="85" required></label>
          <label>Количество попыток<input name="maxAttempts" type="number" min="1" max="10" value="2" required></label>
          <label>Ограничение времени, мин.<input name="timeLimit" type="number" min="0" max="240" value="0"><small>0 — без ограничения</small></label>
        </div>
        <label>Описание<textarea name="description" rows="3" placeholder="Что проверяется и к какому сроку"></textarea></label>
        <fieldset class="att-fieldset"><legend>Вопросы по темам</legend><div class="att-topic-plan">${topicEntries().map(([topic, label]) => `<label><span>${e(label)}<small>в банке: ${availability[topic]}</small></span><input name="topic-${e(topic)}" type="number" min="0" max="${availability[topic]}" value="0"></label>`).join('')}</div><p class="att-total" data-att-total>Всего вопросов: 0</p></fieldset>
        <fieldset class="att-fieldset"><legend>Правила прохождения</legend><label class="permission-check"><input name="shuffleQuestions" type="checkbox" checked> <span>Перемешивать вопросы для каждой попытки</span></label><label class="permission-check"><input name="shuffleOptions" type="checkbox" checked> <span>Перемешивать варианты ответов</span></label><label class="permission-check"><input name="showAnswers" type="checkbox"> <span>Показать правильные ответы после завершения</span></label></fieldset>
        <fieldset class="att-fieldset"><legend>Кому назначить</legend>${employeeRows.length ? `<div class="att-employees">${employeeRows.map(person => `<label class="permission-check"><input name="employees" type="checkbox" value="${e(person.id)}"> <span>${e(person.name)} · ${e(typeof roleLabel === 'function' ? roleLabel(person.role) : person.role)}</span></label>`).join('')}</div>` : '<p class="description">Список сотрудников ещё загружается. Нажмите «Обновить» через несколько секунд.</p>'}</fieldset>
        <div class="task-form-actions"><button class="small-action" type="submit">Собрать и назначить</button></div><p class="submit-status att-test-status" aria-live="polite"></p>
      </form>
      <aside class="att-card att-rules"><h3>Что попадёт в тест</h3><ul><li>Только напитки из действующих техкарт — заготовки исключены.</li><li>Только вопросы, связанные с текущей техкартой или материалом раздела «Теория».</li><li>Вопросы с изменённым или удалённым источником автоматически исключаются.</li><li>Все параметры задаются здесь при создании теста.</li></ul></aside>
    </div>`;
  }

  function renderBank(){
    const counts = {all:ui.bank.length};
    topicEntries().forEach(([topic]) => { counts[topic] = ui.bank.filter(question => question.topic === topic).length; });
    const visible = ui.bank.filter(question => ui.bankFilter === 'all' || question.topic === ui.bankFilter).slice(0, 120);
    return `<div class="att-layout bank-layout">
      <div class="att-card">
        <div class="card-head"><h3>Банк вопросов</h3><button class="small-action" type="button" data-att-open-question>Добавить вопрос</button></div>
        <div class="att-filter-row"><button class="att-filter ${ui.bankFilter === 'all' ? 'active' : ''}" data-att-bank-filter="all" type="button">Все · ${counts.all}</button>${topicEntries().map(([topic,label]) => `<button class="att-filter ${ui.bankFilter === topic ? 'active' : ''}" data-att-bank-filter="${e(topic)}" type="button">${e(label)} · ${counts[topic]}</button>`).join('')}</div>
        <div class="att-bank-list">${visible.length ? visible.map(renderBankQuestion).join('') : '<div class="att-empty"><p>Вопросов по выбранной теме пока нет.</p></div>'}</div>
      </div>
      ${renderQuestionForm()}
    </div>`;
  }

  function renderBankQuestion(question){
    const valid = question.validity?.valid;
    return `<article class="att-question-row ${valid ? '' : 'invalid'}"><div><div class="att-row-tags"><span>${e(Core.TOPICS[question.topic] || question.topic)}</span><span>${question.origin === 'generated' ? 'автоматический' : 'ручной'}</span><span class="${valid ? 'valid' : 'invalid'}">${valid ? 'актуален' : e(question.validity?.reason || 'недоступен')}</span></div><h4>${e(question.prompt)}</h4><p>${e(question.sourceTitle)} · ${e(question.type)}</p></div>${question.origin === 'manual' ? `<button class="mini-admin-btn" type="button" data-att-question-toggle="${e(question.id)}" data-active="${question.active ? 'true' : 'false'}">${question.active ? 'Выключить' : 'Включить'}</button>` : ''}</article>`;
  }

  function sourceOptions(topic = ''){
    return Array.from(ui.registry.values()).filter(source => !topic || source.topic === topic).sort((a,b) => a.title.localeCompare(b.title, 'ru')).map(source => `<option value="${e(sourceKey(source))}">${e(Core.TOPICS[source.topic])} · ${e(source.title)}</option>`).join('');
  }

  function renderQuestionForm(){
    return `<form class="att-card att-question-form" id="att-question-form" hidden>
      <div class="card-head"><h3>Новый вопрос</h3><button class="small-action secondary" type="button" data-att-close-question>Закрыть</button></div>
      <p class="description">Вопрос нельзя сохранить без ссылки на материал, который уже существует в приложении.</p>
      <label>Тема<select name="topic" required>${topicEntries().map(([topic,label]) => `<option value="${e(topic)}">${e(label)}</option>`).join('')}</select></label>
      <label>Источник<select name="source" required>${sourceOptions('techcards')}</select></label>
      <label>Тип вопроса<select name="type"><option value="single">Один правильный ответ</option><option value="multiple">Несколько правильных ответов</option><option value="number">Числовой ответ</option></select></label>
      <label>Вопрос<textarea name="prompt" rows="3" required></textarea></label>
      <label data-att-options-wrap>Варианты ответа<textarea name="options" rows="6" placeholder="Каждый вариант с новой строки"></textarea></label>
      <label>Правильный ответ<textarea name="correct" rows="3" required placeholder="Для нескольких ответов — каждый с новой строки"></textarea></label>
      <label data-att-tolerance-wrap hidden>Допустимое отклонение<input name="tolerance" type="number" min="0" step="0.01" value="0"></label>
      <label>Пояснение после теста<textarea name="explanation" rows="2"></textarea></label>
      <button class="small-action" type="submit">Добавить в банк</button><p class="submit-status att-question-status" aria-live="polite"></p>
    </form>`;
  }

  function renderTests(){
    if(!ui.tests.length) return `<div class="att-empty"><h3>Созданных тестов пока нет</h3><p>Соберите первый тест во вкладке «Создать тест».</p></div>`;
    return `<div class="att-test-list">${ui.tests.map(test => `<article class="att-card"><div class="card-head"><div><span class="att-status ${Number(test.passed_count || 0) === Number(test.assignment_count || 0) && Number(test.assignment_count || 0) ? 'passed' : 'new'}">${e(test.status || 'published')}</span><h3>${e(test.title)}</h3></div><span class="source-badge">${e(test.question_count)} вопросов</span></div><div class="att-meta"><span>Назначено: <b>${e(test.assignment_count || 0)}</b></span><span>Прошли: <b>${e(test.passed_count || 0)}</b></span><span>Средний балл: <b>${test.average_score == null ? '—' : `${e(test.average_score)}%`}</b></span><span>Создан: <b>${e(fmtDate(test.created_at))}</b></span></div></article>`).join('')}</div>`;
  }

  function injectControlResults(){
    if(!isAuthenticated() || !canSeeResults()) return;
    const panel = document.querySelector('#top-control');
    if(!panel) return;
    const tabs = panel.querySelector('.control-subtabs');
    if(tabs && !tabs.querySelector('[data-control-target="attestations"]')){
      const button = document.createElement('button');
      button.className = `subtab ${state.activeControl === 'attestations' ? 'active' : ''}`;
      button.type = 'button';
      button.dataset.controlTarget = 'attestations';
      button.textContent = 'Аттестации';
      button.addEventListener('click', () => setControlTab('attestations'));
      tabs.appendChild(button);
    }
    if(!panel.querySelector('#control-attestations')){
      const folder = document.createElement('div');
      folder.id = 'control-attestations';
      folder.className = `control-folder ${state.activeControl === 'attestations' ? 'active' : ''}`;
      folder.innerHTML = `<div class="control-note"><p>Результаты аттестаций сотрудников. Руководитель может только просматривать данные; управление тестами доступно администратору в разделе «Аттестации».</p><div class="doc-actions"><button type="button" class="refresh-attestation-results">Обновить данные</button></div></div><div id="attestation-results"></div>`;
      panel.appendChild(folder);
      folder.querySelector('.refresh-attestation-results')?.addEventListener('click', () => loadResults(true));
    }
    renderControlResults();
    if(state.activeControl === 'attestations') loadResults(false);
  }

  function renderControlResults(){
    const target = document.querySelector('#attestation-results');
    if(!target) return;
    if(!ui.results.length){ target.innerHTML = '<div class="empty-control"><h3>Результатов пока нет</h3><p>Здесь появятся отправленные попытки сотрудников.</p></div>'; return; }
    target.innerHTML = `<div class="employee-table-wrap"><table class="employee-table att-results-table"><thead><tr><th>Сотрудник</th><th>Роль</th><th>Тест</th><th>Результат</th><th>Попытка</th><th>Дата</th><th>Статус</th></tr></thead><tbody>${ui.results.map(row => `<tr><td>${e(row.employee_name)}</td><td>${e(typeof roleLabel === 'function' ? roleLabel(row.employee_role) : row.employee_role)}</td><td>${e(row.test_title)}</td><td><b>${e(row.score_percent)}%</b></td><td>${e(row.attempt_no)}</td><td>${e(fmtDate(row.submitted_at))}</td><td><span class="att-status ${row.passed ? 'passed' : 'failed'}">${row.passed ? 'Пройдена' : 'Не пройдена'}</span></td></tr>`).join('')}</tbody></table></div>`;
  }

  function readDraft(attemptId){
    try{
      const value = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return value.attemptId === attemptId ? value : null;
    }catch(error){ return null; }
  }

  function saveDraft(){
    if(!ui.activeAttempt) return;
    try{ localStorage.setItem(STORE_KEY, JSON.stringify({attemptId:ui.activeAttempt.attemptId, answers:ui.attemptAnswers, currentQuestion:ui.currentQuestion, savedAt:new Date().toISOString()})); }catch(error){}
  }

  function clearDraft(){ try{ localStorage.removeItem(STORE_KEY); }catch(error){} }

  async function startAttempt(assignmentId, button){
    if(button){ button.disabled = true; button.textContent = 'Открываю…'; }
    try{
      const res = await supa.rpc('start_attestation_attempt', {p_assignment_id:assignmentId});
      if(res.error) throw res.error;
      ui.activeAttempt = res.data;
      const draft = readDraft(ui.activeAttempt.attemptId);
      ui.attemptAnswers = draft?.answers || {};
      ui.currentQuestion = Math.min(Number(draft?.currentQuestion || 0), Math.max(0, asArray(ui.activeAttempt.questions).length - 1));
      startTimer();
      renderAttestationBody();
    }catch(error){
      console.error(error);
      alert('Не удалось начать аттестацию: ' + (error.message || 'проверьте срок и количество попыток.'));
      if(button){ button.disabled = false; button.textContent = 'Начать аттестацию'; }
    }
  }

  function renderAttempt(){
    const attempt = ui.activeAttempt;
    const questions = asArray(attempt.questions);
    const question = questions[ui.currentQuestion];
    if(!question) return '<div class="att-empty"><p>В тесте нет вопросов.</p></div>';
    const key = question.testQuestionId;
    const answer = ui.attemptAnswers[key];
    const answered = Object.keys(ui.attemptAnswers).filter(id => {
      const value = ui.attemptAnswers[id];
      return Array.isArray(value) ? value.length : String(value ?? '').trim() !== '';
    }).length;
    return `<div class="att-attempt">
      <div class="att-attempt-head"><button class="small-action secondary" type="button" data-att-exit>Выйти и продолжить позже</button><div><span>Вопрос ${ui.currentQuestion + 1} из ${questions.length}</span><b data-att-timer>${timerLabel()}</b></div></div>
      <div class="att-progress"><span style="width:${Math.round((ui.currentQuestion + 1) / questions.length * 100)}%"></span></div>
      <article class="att-card att-question-screen"><div class="att-row-tags"><span>${e(Core.TOPICS[question.topic] || question.topic)}</span><span>${e(question.sourceTitle || 'Материал приложения')}</span></div><h3>${e(question.prompt)}</h3>${renderAnswerInput(question, answer)}</article>
      <div class="att-attempt-actions"><button class="small-action secondary" type="button" data-att-prev ${ui.currentQuestion === 0 ? 'disabled' : ''}>Назад</button><span>Отвечено: ${answered}/${questions.length}</span>${ui.currentQuestion < questions.length - 1 ? '<button class="small-action" type="button" data-att-next>Далее</button>' : '<button class="small-action" type="button" data-att-submit>Завершить тест</button>'}</div>
    </div>`;
  }

  function renderAnswerInput(question, answer){
    const key = question.testQuestionId;
    if(question.type === 'number') return `<label class="att-number-answer">Введите число<input type="number" step="0.01" data-att-number="${e(key)}" value="${e(answer ?? '')}"></label>`;
    if(question.type === 'multiple'){
      const selected = asArray(answer);
      return `<div class="att-options">${asArray(question.options).map(option => `<label><input type="checkbox" data-att-multiple="${e(key)}" value="${e(option)}" ${selected.includes(option) ? 'checked' : ''}><span>${e(option)}</span></label>`).join('')}</div>`;
    }
    return `<div class="att-options">${asArray(question.options).map(option => `<label><input type="radio" name="att-answer-${e(key)}" data-att-single="${e(key)}" value="${e(option)}" ${String(answer ?? '') === String(option) ? 'checked' : ''}><span>${e(option)}</span></label>`).join('')}</div>`;
  }

  function timerRemainingMs(){
    const minutes = Number(ui.activeAttempt?.settings?.timeLimitMinutes || 0);
    if(!minutes) return null;
    const deadline = new Date(ui.activeAttempt.startedAt).getTime() + minutes * 60000;
    return deadline - Date.now();
  }

  function timerLabel(){
    const remaining = timerRemainingMs();
    if(remaining == null) return 'Без ограничения времени';
    const safe = Math.max(0, remaining);
    const minutes = Math.floor(safe / 60000);
    const seconds = Math.floor((safe % 60000) / 1000);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function startTimer(){
    if(ui.timerHandle) clearInterval(ui.timerHandle);
    if(timerRemainingMs() == null) return;
    ui.timerHandle = setInterval(() => {
      const label = document.querySelector('[data-att-timer]');
      if(label) label.textContent = timerLabel();
      if(timerRemainingMs() <= 0){ clearInterval(ui.timerHandle); ui.timerHandle = null; submitAttempt(true); }
    }, 1000);
  }

  async function submitAttempt(auto = false){
    const questions = asArray(ui.activeAttempt?.questions);
    const answered = questions.filter(question => {
      const value = ui.attemptAnswers[question.testQuestionId];
      return Array.isArray(value) ? value.length : String(value ?? '').trim() !== '';
    }).length;
    if(!auto && answered < questions.length && !confirm(`Без ответа осталось: ${questions.length - answered}. Завершить тест?`)) return;
    if(!auto && !confirm('Отправить ответы? После отправки изменить их нельзя.')) return;
    const button = document.querySelector('[data-att-submit]');
    if(button){ button.disabled = true; button.textContent = 'Проверяю…'; }
    try{
      const res = await supa.rpc('submit_attestation_attempt', {p_attempt_id:ui.activeAttempt.attemptId, p_answers:ui.attemptAnswers});
      if(res.error) throw res.error;
      if(ui.timerHandle) clearInterval(ui.timerHandle);
      ui.timerHandle = null;
      clearDraft();
      const result = res.data;
      ui.activeAttempt = null;
      ui.attemptAnswers = {};
      ui.currentQuestion = 0;
      await loadAssignments();
      renderAttestationBody();
      alert(`${result.passed ? 'Аттестация пройдена' : 'Аттестация не пройдена'}\nРезультат: ${result.scorePercent}% (${result.correctCount} из ${result.totalCount})`);
    }catch(error){
      console.error(error);
      alert('Не удалось отправить тест: ' + (error.message || 'проверьте подключение.'));
      if(button){ button.disabled = false; button.textContent = 'Завершить тест'; }
    }
  }

  async function submitQuestion(event){
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector('.att-question-status');
    const rawSource = String(form.elements.source.value || '');
    const separatorIndex = rawSource.indexOf(':');
    const type = separatorIndex >= 0 ? rawSource.slice(0, separatorIndex) : '';
    const key = separatorIndex >= 0 ? rawSource.slice(separatorIndex + 1) : '';
    const source = ui.registry.get(`${type}:${key}`);
    if(!source){ status.textContent = 'Выберите актуальный источник.'; status.className = 'submit-status error'; return; }
    const questionType = form.elements.type.value;
    const options = String(form.elements.options.value || '').split('\n').map(value => value.trim()).filter(Boolean);
    let correctAnswer;
    if(questionType === 'multiple') correctAnswer = String(form.elements.correct.value || '').split('\n').map(value => value.trim()).filter(Boolean);
    else if(questionType === 'number') correctAnswer = Number(String(form.elements.correct.value || '').replace(',', '.'));
    else correctAnswer = String(form.elements.correct.value || '').trim();
    if(questionType !== 'number' && options.length < 3){ status.textContent = 'Добавьте минимум три варианта ответа.'; status.className = 'submit-status error'; return; }
    if(questionType === 'single' && !options.includes(correctAnswer)){ status.textContent = 'Правильный ответ должен быть среди вариантов.'; status.className = 'submit-status error'; return; }
    if(questionType === 'multiple' && (!correctAnswer.length || correctAnswer.some(value => !options.includes(value)))){ status.textContent = 'Все правильные ответы должны быть среди вариантов.'; status.className = 'submit-status error'; return; }
    const row = {
      topic: source.topic,
      source_type: source.type,
      source_key: source.key,
      source_title: source.title,
      source_version: source.version,
      question_type: questionType,
      prompt: String(form.elements.prompt.value || '').trim(),
      options,
      correct_answer: correctAnswer,
      tolerance: Number(form.elements.tolerance.value || 0),
      explanation: String(form.elements.explanation.value || '').trim(),
      fingerprint: Core.stableHash({topic:source.topic, source:type + ':' + key, version:source.version, prompt:form.elements.prompt.value, options, correctAnswer}),
      is_active: true,
      created_by: currentUser().id
    };
    try{
      status.textContent = 'Сохраняю…'; status.className = 'submit-status';
      const res = await supa.from('attestation_questions').insert(row).select().single();
      if(res.error) throw res.error;
      form.reset();
      form.hidden = true;
      await loadManualQuestions();
      buildLocalBank();
      renderAttestationBody();
    }catch(error){
      console.error(error);
      status.textContent = error.message || 'Не удалось сохранить вопрос.'; status.className = 'submit-status error';
    }
  }

  async function toggleQuestion(id, active, button){
    button.disabled = true;
    try{
      const res = await supa.from('attestation_questions').update({is_active:!active, updated_at:new Date().toISOString()}).eq('id', id);
      if(res.error) throw res.error;
      await loadManualQuestions();
      buildLocalBank();
      renderAttestationBody();
    }catch(error){ alert('Не удалось изменить вопрос: ' + (error.message || 'ошибка доступа.')); button.disabled = false; }
  }

  function toIso(localValue){
    if(!localValue) return null;
    const date = new Date(localValue);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  async function submitTest(event){
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector('.att-test-status');
    const plan = Object.fromEntries(topicEntries().map(([topic]) => [topic, Number(form.elements[`topic-${topic}`].value || 0)]));
    const employeeIds = Array.from(form.querySelectorAll('input[name="employees"]:checked')).map(input => input.value);
    if(!Object.values(plan).some(Boolean)){ status.textContent = 'Добавьте хотя бы один вопрос.'; status.className = 'submit-status error'; return; }
    if(!employeeIds.length){ status.textContent = 'Выберите хотя бы одного сотрудника.'; status.className = 'submit-status error'; return; }
    let selected;
    try{ selected = Core.autoAssemble(ui.bank, plan); }
    catch(error){ status.textContent = `Не хватает вопросов: ${error.message}`; status.className = 'submit-status error'; return; }
    const settings = {
      passPercent:Number(form.elements.passPercent.value),
      maxAttempts:Number(form.elements.maxAttempts.value),
      timeLimitMinutes:Number(form.elements.timeLimit.value || 0),
      shuffleQuestions:form.elements.shuffleQuestions.checked,
      shuffleOptions:form.elements.shuffleOptions.checked,
      showAnswers:form.elements.showAnswers.checked
    };
    try{
      status.textContent = 'Собираю тест и назначаю сотрудникам…'; status.className = 'submit-status';
      const res = await supa.rpc('create_attestation_test', {
        p_title:String(form.elements.title.value || '').trim(),
        p_description:String(form.elements.description.value || '').trim(),
        p_settings:settings,
        p_topic_plan:plan,
        p_questions:selected.map(Core.questionSnapshot),
        p_employee_ids:employeeIds,
        p_due_at:toIso(form.elements.dueAt.value)
      });
      if(res.error) throw res.error;
      form.reset();
      ui.activeAdminTab = 'tests';
      await loadAdminTests();
      renderAttestationBody();
      alert(`Тест создан. Назначено сотрудникам: ${employeeIds.length}.`);
    }catch(error){
      console.error(error);
      status.textContent = error.message || 'Не удалось создать тест.'; status.className = 'submit-status error';
    }
  }

  function updateQuestionSourceOptions(form){
    const topic = form.elements.topic.value;
    form.elements.source.innerHTML = sourceOptions(topic);
  }

  function updateQuestionType(form){
    const numeric = form.elements.type.value === 'number';
    form.querySelector('[data-att-options-wrap]').hidden = numeric;
    form.querySelector('[data-att-tolerance-wrap]').hidden = !numeric;
  }

  function updatePlanTotal(form){
    const total = topicEntries().reduce((sum, [topic]) => sum + Number(form.elements[`topic-${topic}`]?.value || 0), 0);
    const target = form.querySelector('[data-att-total]');
    if(target) target.textContent = `Всего вопросов: ${total}`;
  }

  function bindAttestationEvents(){
    document.querySelector('[data-att-refresh]')?.addEventListener('click', () => loadAll(true));
    document.querySelectorAll('[data-att-admin-tab]').forEach(button => button.addEventListener('click', () => { ui.activeAdminTab = button.dataset.attAdminTab; renderAttestationBody(); }));
    document.querySelectorAll('[data-att-bank-filter]').forEach(button => button.addEventListener('click', () => { ui.bankFilter = button.dataset.attBankFilter; renderAttestationBody(); }));
    document.querySelector('[data-att-open-question]')?.addEventListener('click', () => { const form = document.querySelector('#att-question-form'); if(form){ form.hidden = false; form.scrollIntoView({behavior:'smooth', block:'start'}); } });
    document.querySelector('[data-att-close-question]')?.addEventListener('click', () => { const form = document.querySelector('#att-question-form'); if(form) form.hidden = true; });
    const questionForm = document.querySelector('#att-question-form');
    if(questionForm){
      questionForm.addEventListener('submit', submitQuestion);
      questionForm.elements.topic.addEventListener('change', () => updateQuestionSourceOptions(questionForm));
      questionForm.elements.type.addEventListener('change', () => updateQuestionType(questionForm));
      updateQuestionType(questionForm);
    }
    document.querySelectorAll('[data-att-question-toggle]').forEach(button => button.addEventListener('click', () => toggleQuestion(button.dataset.attQuestionToggle, button.dataset.active === 'true', button)));
    const testForm = document.querySelector('#att-test-form');
    if(testForm){
      testForm.addEventListener('submit', submitTest);
      topicEntries().forEach(([topic]) => testForm.elements[`topic-${topic}`]?.addEventListener('input', () => updatePlanTotal(testForm)));
      updatePlanTotal(testForm);
    }
    document.querySelectorAll('[data-att-start]').forEach(button => button.addEventListener('click', () => startAttempt(button.dataset.attStart, button)));
    document.querySelector('[data-att-exit]')?.addEventListener('click', () => { saveDraft(); if(ui.timerHandle) clearInterval(ui.timerHandle); ui.timerHandle = null; ui.activeAttempt = null; renderAttestationBody(); loadAssignments(); });
    document.querySelector('[data-att-prev]')?.addEventListener('click', () => { saveDraft(); ui.currentQuestion = Math.max(0, ui.currentQuestion - 1); renderAttestationBody(); startTimer(); });
    document.querySelector('[data-att-next]')?.addEventListener('click', () => { saveDraft(); ui.currentQuestion = Math.min(asArray(ui.activeAttempt?.questions).length - 1, ui.currentQuestion + 1); renderAttestationBody(); startTimer(); });
    document.querySelector('[data-att-submit]')?.addEventListener('click', () => submitAttempt(false));
    document.querySelectorAll('[data-att-single]').forEach(input => input.addEventListener('change', () => { ui.attemptAnswers[input.dataset.attSingle] = input.value; saveDraft(); }));
    document.querySelectorAll('[data-att-multiple]').forEach(input => input.addEventListener('change', () => { const key = input.dataset.attMultiple; const selected = Array.from(document.querySelectorAll(`[data-att-multiple="${CSS.escape(key)}"]:checked`)).map(item => item.value); ui.attemptAnswers[key] = selected; saveDraft(); }));
    document.querySelectorAll('[data-att-number]').forEach(input => input.addEventListener('input', () => { ui.attemptAnswers[input.dataset.attNumber] = input.value; saveDraft(); }));
  }

  function boot(){
    if(typeof state === 'undefined' || typeof renderApp !== 'function' || typeof hasAccess !== 'function') return false;
    patchApplication();
    ensureAccessModel();
    if(state.menu && isAuthenticated()) renderApp();
    return true;
  }

  if(!boot()){
    const timer = setInterval(() => { if(boot()) clearInterval(timer); }, 50);
    setTimeout(() => clearInterval(timer), 10000);
  }
})();
